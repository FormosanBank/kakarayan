"""Safe, loss-aware projection of FormosanBank XML into relational records."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from lxml import etree

from corpus.ingestion.normalize import normalize_gloss, normalize_surface, tokenize
from publisher.identifiers import dimension_id, record_id
from publisher.languages import resolve_language

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
OWNER_TAGS = {"S": "sentence", "W": "word", "M": "morpheme"}
TIER_TAGS = {"FORM", "PHON", "TRANSL", "AUDIO"}
TABLES = (
    "texts",
    "sentences",
    "words",
    "morphemes",
    "forms",
    "phonology",
    "translations",
    "audio",
    "tokens",
)


class SourceError(ValueError):
    """Raised when a source file cannot be projected safely."""


@dataclass
class Projection:
    """All rows derived from a single canonical XML file."""

    source_path: str
    source_sha256: str
    rows: dict[str, list[dict[str, object]]] = field(
        default_factory=lambda: {name: [] for name in TABLES}
    )
    warnings: list[str] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        return {name: len(rows) for name, rows in self.rows.items()}


def discover_xml(repo: Path) -> Iterator[Path]:
    """Yield canonical public XML in deterministic source-path order."""
    corpora = (repo / "Corpora").resolve()
    if not corpora.is_dir():
        raise SourceError(f"Missing canonical corpora directory: {corpora}")
    candidates = [
        path for path in corpora.glob("*/XML/**/*.xml") if path.is_file() and not path.is_symlink()
    ]
    yield from sorted(candidates, key=lambda item: item.relative_to(repo).as_posix())


def _safe_root(path: Path) -> etree._Element:
    parser = etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        huge_tree=False,
        remove_comments=False,
    )
    try:
        tree = etree.parse(path, parser)
    except (OSError, etree.XMLSyntaxError) as exc:
        raise SourceError(f"Cannot parse {path}: {exc}") from exc
    dtd = tree.docinfo.internalDTD
    if tree.docinfo.doctype and dtd is not None and any(dtd.iterentities()):
        raise SourceError(f"Entity declarations are not allowed: {path}")
    root = tree.getroot()
    if root.tag != "TEXT":
        raise SourceError(f"Expected TEXT root in {path}, found {root.tag!r}")
    return root


def _mixed_text(element: etree._Element) -> tuple[str, bool]:
    parts: list[str] = []
    unclear = False
    if element.text:
        parts.append(element.text)
    for child in element:
        if child.tag == "UNCLEAR":
            unclear = True
        else:
            parts.extend(child.itertext())
        if child.tail:
            parts.append(child.tail)
    return "".join(parts).strip(), unclear


def _attributes_json(element: etree._Element) -> str:
    return json.dumps(
        dict(sorted(element.attrib.items())),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _inline_markup_json(element: etree._Element) -> str:
    children = []
    for child in element:
        qualified = etree.QName(child)
        children.append(
            {
                "name": qualified.localname,
                "namespace": qualified.namespace,
                "attributes": dict(sorted(child.attrib.items())),
                "text": child.text or "",
                "tail": child.tail or "",
            }
        )
    return json.dumps(
        children,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _number(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    assert value is not None
    try:
        parsed = Decimal(value)
    except (InvalidOperation, ValueError):
        return None
    if not parsed.is_finite() or parsed < 0:
        return None
    return float(parsed)


def _tier_row(
    element: etree._Element,
    *,
    owner_type: str,
    owner_id: str,
    corpus: str,
    source_path: str,
    ordinal: int,
) -> tuple[str, dict[str, object]]:
    tag = element.tag
    table = {
        "FORM": "forms",
        "PHON": "phonology",
        "TRANSL": "translations",
        "AUDIO": "audio",
    }[tag]
    row_id = record_id(
        table.rstrip("s"),
        corpus=corpus,
        source_path=source_path,
        local_id=owner_id,
        ordinal=ordinal,
    )
    base: dict[str, object] = {
        "id": row_id,
        "owner_type": owner_type,
        "owner_id": owner_id,
        "position": ordinal,
    }
    if tag == "AUDIO":
        start = _number(element.get("start"))
        end = _number(element.get("end"))
        base.update(
            {
                "file": element.get("file", ""),
                "url": element.get("url", ""),
                "start": start,
                "end": end,
                "start_raw": element.get("start", ""),
                "end_raw": element.get("end", ""),
                "source": element.get("source", ""),
                "duration": (
                    end - start if start is not None and end is not None and end >= start else None
                ),
                "availability_status": (
                    "referenced"
                    if element.get("file") or element.get("url") or element.get("source")
                    else "unresolved"
                ),
                "attributes_json": _attributes_json(element),
            }
        )
    else:
        text, unclear = _mixed_text(element)
        base.update({"text": text, "unclear": unclear})
        if tag == "FORM":
            base.update(
                {
                    "kind": element.get("kindOf", ""),
                    "notes": element.get("notes", ""),
                    "normalized": normalize_surface(text),
                    "attributes_json": _attributes_json(element),
                    "inline_markup_json": _inline_markup_json(element),
                }
            )
        elif tag == "PHON":
            base.update(
                {
                    "kind": element.get("kindOf", ""),
                    "attributes_json": _attributes_json(element),
                    "inline_markup_json": _inline_markup_json(element),
                }
            )
        else:
            base.update(
                {
                    "xml_lang": element.get(XML_LANG, ""),
                    "kind": element.get("kindOf", ""),
                    "version": element.get("ver", ""),
                    "notes": element.get("notes", ""),
                    "normalized": normalize_gloss(text),
                    "attributes_json": _attributes_json(element),
                    "inline_markup_json": _inline_markup_json(element),
                }
            )
    return table, base


def _selected_form(owner: etree._Element) -> str:
    forms: dict[str, str] = {}
    for child in owner:
        if child.tag != "FORM":
            continue
        text, _ = _mixed_text(child)
        if text:
            forms.setdefault(child.get("kindOf", ""), text)
    return forms.get("standard") or forms.get("original") or forms.get("alternate") or ""


def _append_owner(
    projection: Projection,
    element: etree._Element,
    *,
    kind: str,
    parent_id: str,
    corpus: str,
    source_path: str,
    position: int,
) -> str:
    local_id = element.get("id", "")
    owner_id = record_id(
        kind,
        corpus=corpus,
        source_path=source_path,
        local_id=local_id,
        ordinal=position,
    )
    row: dict[str, object] = {
        "id": owner_id,
        "parent_id": parent_id,
        "xml_id": local_id,
        "position": position,
        "metadata_json": _attributes_json(element),
    }
    if kind in {"word", "morpheme"}:
        row.update({"class": element.get("class", ""), "sclass": element.get("sclass", "")})
    if kind == "sentence":
        row.update(
            {
                "audio_url": element.get("audio_url", ""),
                "source": element.get("source", ""),
                "token_count": len(tokenize(_selected_form(element))),
            }
        )
    projection.rows[f"{kind}s"].append(row)

    tier_position = 0
    child_counts = {"W": 0, "M": 0}
    for child in element:
        if child.tag in TIER_TAGS:
            table, tier = _tier_row(
                child,
                owner_type=kind,
                owner_id=owner_id,
                corpus=corpus,
                source_path=source_path,
                ordinal=tier_position,
            )
            projection.rows[table].append(tier)
            tier_position += 1
        elif kind == "sentence" and child.tag == "W":
            word_id = _append_owner(
                projection,
                child,
                kind="word",
                parent_id=owner_id,
                corpus=corpus,
                source_path=source_path,
                position=child_counts["W"],
            )
            child_counts["W"] += 1
            surface = _selected_form(child)
            if surface:
                projection.rows["tokens"].append(
                    {
                        "id": record_id(
                            "token",
                            corpus=corpus,
                            source_path=source_path,
                            local_id=word_id,
                            ordinal=0,
                        ),
                        "sentence_id": owner_id,
                        "word_id": word_id,
                        "position": child_counts["W"] - 1,
                        "surface": surface,
                        "normalized": normalize_surface(surface),
                    }
                )
        elif kind == "word" and child.tag == "M":
            _append_owner(
                projection,
                child,
                kind="morpheme",
                parent_id=owner_id,
                corpus=corpus,
                source_path=source_path,
                position=child_counts["M"],
            )
            child_counts["M"] += 1

    if kind == "sentence" and child_counts["W"] == 0:
        for token_position, surface in enumerate(tokenize(_selected_form(element))):
            projection.rows["tokens"].append(
                {
                    "id": record_id(
                        "token",
                        corpus=corpus,
                        source_path=source_path,
                        local_id=owner_id,
                        ordinal=token_position,
                    ),
                    "sentence_id": owner_id,
                    "word_id": None,
                    "position": token_position,
                    "surface": surface,
                    "normalized": normalize_surface(surface),
                }
            )
    return owner_id


def project_xml(path: Path, repo: Path) -> Projection:
    """Project one canonical XML file while retaining its stable source locator."""
    source_path = path.resolve().relative_to(repo.resolve()).as_posix()
    parts = Path(source_path).parts
    if len(parts) < 4 or parts[0] != "Corpora" or parts[2] != "XML":
        raise SourceError(f"Not a canonical corpus XML path: {source_path}")
    corpus = parts[1]
    root = _safe_root(path)
    source_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    projection = Projection(source_path=source_path, source_sha256=source_sha256)

    xml_lang = root.get(XML_LANG, "").strip().casefold()
    dialect = root.get("dialect", "").strip()
    language = resolve_language(xml_lang, dialect)
    text_id = record_id(
        "text",
        corpus=corpus,
        source_path=source_path,
        local_id=root.get("id", ""),
        ordinal=0,
    )
    projection.rows["texts"].append(
        {
            "id": text_id,
            "corpus_id": dimension_id("corpus", corpus),
            "language_id": dimension_id("lang", language or f"unknown-{xml_lang or 'missing'}"),
            "language": language or "",
            "xml_lang": xml_lang,
            "dialect": dialect,
            "xml_id": root.get("id", ""),
            "source_path": source_path,
            "source_sha256": source_sha256,
            "citation": root.get("citation", ""),
            "bibtex_citation": root.get("BibTeX_citation", ""),
            "copyright": root.get("copyright", ""),
            "source": root.get("source", ""),
            "audio_mode": root.get("audio", ""),
            "glottocode": root.get("glottocode", ""),
            "metadata_json": _attributes_json(root),
        }
    )
    if language is None:
        projection.warnings.append(f"Unresolved language code {xml_lang!r}")

    top_audio_position = 0
    sentence_position = 0
    for child in root:
        if child.tag == "AUDIO":
            table, row = _tier_row(
                child,
                owner_type="text",
                owner_id=text_id,
                corpus=corpus,
                source_path=source_path,
                ordinal=top_audio_position,
            )
            projection.rows[table].append(row)
            top_audio_position += 1
        elif child.tag == "S":
            _append_owner(
                projection,
                child,
                kind="sentence",
                parent_id=text_id,
                corpus=corpus,
                source_path=source_path,
                position=sentence_position,
            )
            sentence_position += 1
    return projection
