"""Time-aligned ELAN, Praat, WebVTT, and SRT exports."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from lxml import etree

from publisher.archive import write_zip
from publisher.release_db import open_release


def _milliseconds(value: float) -> int:
    return int((Decimal(str(value)) * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _clock(milliseconds: int, *, srt: bool = False) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    separator = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{millis:03d}"


def _escape_textgrid(value: str) -> str:
    return value.replace('"', '""').replace("\r", " ").replace("\n", " ")


def _vtt(cues: list[dict[str, Any]], field: str) -> bytes:
    lines = ["WEBVTT", "", "NOTE Generated from pinned FormosanBank timing tiers.", ""]
    for cue in cues:
        value = cue[field]
        if not value:
            continue
        lines.extend(
            [
                str(cue["sentence_id"]),
                f"{_clock(cue['start_ms'])} --> {_clock(cue['end_ms'])}",
                str(value),
                "",
            ]
        )
    return ("\n".join(lines) + "\n").encode()


def _srt(cues: list[dict[str, Any]], field: str) -> bytes:
    lines: list[str] = []
    index = 1
    for cue in cues:
        value = cue[field]
        if not value:
            continue
        lines.extend(
            [
                str(index),
                f"{_clock(cue['start_ms'], srt=True)} --> {_clock(cue['end_ms'], srt=True)}",
                str(value),
                "",
            ]
        )
        index += 1
    return ("\n".join(lines) + "\n").encode()


def _textgrid(cues: list[dict[str, Any]]) -> bytes | None:
    previous = 0
    for cue in cues:
        if cue["start_ms"] < previous:
            return None
        previous = cue["end_ms"]
    xmax = max((cue["end_ms"] for cue in cues), default=0) / 1000
    lines = [
        'File type = "ooTextFile"',
        'Object class = "TextGrid"',
        "",
        "xmin = 0",
        f"xmax = {xmax:.3f}",
        "tiers? <exists>",
        "size = 2",
        "item []:",
    ]
    for tier_index, (name, field) in enumerate(
        (("source", "source_form"), ("translation", "translation")),
        1,
    ):
        intervals = [cue for cue in cues if cue[field]]
        lines.extend(
            [
                f"    item [{tier_index}]:",
                '        class = "IntervalTier"',
                f'        name = "{name}"',
                "        xmin = 0",
                f"        xmax = {xmax:.3f}",
                f"        intervals: size = {len(intervals)}",
            ]
        )
        for index, cue in enumerate(intervals, 1):
            lines.extend(
                [
                    f"        intervals [{index}]:",
                    f"            xmin = {cue['start_ms'] / 1000:.3f}",
                    f"            xmax = {cue['end_ms'] / 1000:.3f}",
                    f'            text = "{_escape_textgrid(str(cue[field]))}"',
                ]
            )
    return ("\n".join(lines) + "\n").encode()


def _eaf(cues: list[dict[str, Any]], media: str) -> bytes:
    root = etree.Element(
        "ANNOTATION_DOCUMENT",
        AUTHOR="",
        DATE="1980-01-01T00:00:00+00:00",
        FORMAT="3.0",
        VERSION="3.0",
    )
    header = etree.SubElement(root, "HEADER", MEDIA_FILE="", TIME_UNITS="milliseconds")
    etree.SubElement(
        header,
        "MEDIA_DESCRIPTOR",
        MEDIA_URL=media,
        MIME_TYPE="application/octet-stream",
        RELATIVE_MEDIA_URL=media,
    )
    order = etree.SubElement(root, "TIME_ORDER")
    for index, cue in enumerate(cues, 1):
        etree.SubElement(
            order,
            "TIME_SLOT",
            TIME_SLOT_ID=f"ts{index * 2 - 1}",
            TIME_VALUE=str(cue["start_ms"]),
        )
        etree.SubElement(
            order,
            "TIME_SLOT",
            TIME_SLOT_ID=f"ts{index * 2}",
            TIME_VALUE=str(cue["end_ms"]),
        )
    source_tier = etree.SubElement(
        root,
        "TIER",
        LINGUISTIC_TYPE_REF="source",
        TIER_ID="source",
    )
    translation_tier = etree.SubElement(
        root,
        "TIER",
        LINGUISTIC_TYPE_REF="translation",
        PARENT_REF="source",
        TIER_ID="translation",
    )
    for index, cue in enumerate(cues, 1):
        annotation = etree.SubElement(source_tier, "ANNOTATION")
        aligned = etree.SubElement(
            annotation,
            "ALIGNABLE_ANNOTATION",
            ANNOTATION_ID=f"a{index}",
            TIME_SLOT_REF1=f"ts{index * 2 - 1}",
            TIME_SLOT_REF2=f"ts{index * 2}",
        )
        etree.SubElement(aligned, "ANNOTATION_VALUE").text = str(cue["source_form"])
        if cue["translation"]:
            translation = etree.SubElement(translation_tier, "ANNOTATION")
            reference = etree.SubElement(
                translation,
                "REF_ANNOTATION",
                ANNOTATION_ID=f"tr{index}",
                ANNOTATION_REF=f"a{index}",
            )
            etree.SubElement(reference, "ANNOTATION_VALUE").text = str(cue["translation"])
    etree.SubElement(
        root,
        "LINGUISTIC_TYPE",
        GRAPHIC_REFERENCES="false",
        LINGUISTIC_TYPE_ID="source",
        TIME_ALIGNABLE="true",
    )
    etree.SubElement(
        root,
        "LINGUISTIC_TYPE",
        CONSTRAINTS="Symbolic_Association",
        GRAPHIC_REFERENCES="false",
        LINGUISTIC_TYPE_ID="translation",
        TIME_ALIGNABLE="false",
    )
    etree.SubElement(
        root,
        "CONSTRAINT",
        DESCRIPTION="1-1 association with a parent annotation",
        STEREOTYPE="Symbolic_Association",
    )
    return etree.tostring(root, encoding="UTF-8", xml_declaration=True, pretty_print=True)


def write_aligned_package(
    database: Path,
    path: Path,
    release_id: str,
    rights: dict[str, object],
) -> dict[str, int]:
    query = """
        SELECT sv.text_id, sv.sentence_id, sv.corpus_id, sv.language_id, sv.source_path,
               COALESCE(sv.standard_form, sv.original_form, '') AS source_form,
               a.file, a.url, a.source, a.start, a.end,
               COALESCE((
                 SELECT group_concat(text, ' | ')
                 FROM (
                   SELECT text FROM translations
                   WHERE owner_type = 'sentence' AND owner_id = sv.sentence_id
                   ORDER BY position
                 )
               ), '') AS translation
        FROM sentence_view sv
        JOIN audio a ON a.owner_type = 'sentence' AND a.owner_id = sv.sentence_id
        WHERE a.start IS NOT NULL AND a.end IS NOT NULL AND a.end >= a.start
        ORDER BY sv.source_path, COALESCE(a.file, a.url, a.source), a.start, a.end,
                 sv.sentence_id
    """
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    with open_release(database) as connection:
        for row in connection.execute(query):
            value = dict(row)
            media = value["file"] or value["url"] or value["source"]
            if not media:
                continue
            value["start_ms"] = _milliseconds(value["start"])
            value["end_ms"] = _milliseconds(value["end"])
            groups[(value["text_id"], media)].append(value)

    entries: list[tuple[str, bytes]] = []
    manifest_groups = []
    textgrid_count = 0
    for (text_id, media), cues in sorted(groups.items()):
        media_id = hashlib.sha256(media.encode()).hexdigest()[:10]
        stem = f"{cues[0]['corpus_id']}/{text_id}-{media_id}"
        entries.extend(
            [
                (f"{stem}.source.vtt", _vtt(cues, "source_form")),
                (f"{stem}.source.srt", _srt(cues, "source_form")),
                (f"{stem}.translation.vtt", _vtt(cues, "translation")),
                (f"{stem}.translation.srt", _srt(cues, "translation")),
                (f"{stem}.eaf", _eaf(cues, media)),
            ]
        )
        textgrid = _textgrid(cues)
        if textgrid is not None:
            entries.append((f"{stem}.TextGrid", textgrid))
            textgrid_count += 1
        manifest_groups.append(
            {
                "text_id": text_id,
                "corpus_id": cues[0]["corpus_id"],
                "language_id": cues[0]["language_id"],
                "source_path": cues[0]["source_path"],
                "media_reference": media,
                "cue_count": len(cues),
                "textgrid_included": textgrid is not None,
            }
        )
    mapping = {
        "release_id": release_id,
        "timing": "Source seconds rounded to milliseconds with decimal ROUND_HALF_UP.",
        "media": "References only. No audio bytes are redistributed.",
        "textgrid": "Excluded for a media group when intervals overlap.",
        "groups": manifest_groups,
    }
    entries.append(
        (
            "manifest.json",
            (json.dumps(mapping, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(),
        )
    )
    entries.append(
        (
            "README.txt",
            (
                "Kakarayan time-aligned derivatives\n\n"
                f"Release: {release_id}\n"
                "EAF, TextGrid, WebVTT, and SRT are generated only from valid sentence "
                "timings. Media is referenced, never copied. Canonical XML remains the "
                "authoritative representation.\n"
            ).encode(),
        )
    )
    entries.append(
        (
            "rights.json",
            (json.dumps(rights, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(),
        )
    )
    write_zip(path, entries)
    for name, data in entries:
        if name.endswith(".eaf"):
            etree.fromstring(data)
    return {
        "media_groups": len(groups),
        "textgrids": textgrid_count,
        "files": len(entries),
    }
