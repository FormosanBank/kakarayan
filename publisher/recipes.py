"""Validate and execute declarative browser export recipes."""

from __future__ import annotations

import csv
import json
import unicodedata
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
import regex
from jsonschema import Draft202012Validator

from publisher.build import BuildError


def load_recipe(path: Path, schema_path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(value)
    return value


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip().casefold()


def _edit_distance(left: str, right: str, maximum: int) -> int:
    if abs(len(left) - len(right)) > maximum:
        return maximum + 1
    previous = list(range(len(right) + 1))
    for row, left_character in enumerate(left, 1):
        current = [row]
        row_minimum = row
        for column, right_character in enumerate(right, 1):
            value = min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left_character != right_character),
            )
            current.append(value)
            row_minimum = min(row_minimum, value)
        if row_minimum > maximum:
            return maximum + 1
        previous = current
    return previous[-1]


def _matches(
    record: dict[str, Any],
    query: str,
    match: str,
    pattern: regex.Pattern[str] | None = None,
) -> bool:
    needle = _normalize(query)
    if match == "translation":
        return any(needle in _normalize(item["text"]) for item in record["translations"])
    if match == "phonology":
        return any(needle in _normalize(item["text"]) for item in record["phonology"])
    if match == "gloss":
        return any(
            item["owner_type"] != "sentence" and needle in _normalize(item["text"])
            for item in record["tier_translations"]
        )
    source_forms = [
        record["standard"],
        record["original"],
        *(item["surface"] for item in record["tokens"]),
        *(item["text"] for item in record["forms"]),
    ]
    if match == "source":
        source = unicodedata.normalize("NFC", query).strip()
        return any(unicodedata.normalize("NFC", value) == source for value in source_forms)
    forms = [
        *(_normalize(value) for value in source_forms),
        *(_normalize(item["normalized"]) for item in record["tokens"]),
    ]
    forms = [value for value in forms if value]
    if match == "regex":
        if pattern is None:
            raise BuildError("Recipe regular expression was not compiled")
        try:
            values = [
                *source_forms,
                *(item["text"] for item in record["translations"]),
                *(item["text"] for item in record["tier_translations"]),
                *(item["text"] for item in record["phonology"]),
            ]
            return any(pattern.search(value, timeout=0.05) is not None for value in values)
        except TimeoutError as error:
            raise BuildError("Recipe regular expression exceeded its work limit") from error
    if match == "fuzzy":
        maximum = 1 if len(needle) <= 4 else 2
        return any(
            len(value) <= 80 and _edit_distance(value, needle, maximum) <= maximum
            for value in forms
        )
    if match == "exact":
        return any(value == needle for value in forms)
    if match == "prefix":
        return any(value.startswith(needle) for value in forms)
    return any(needle in value for value in forms)


def _recipe_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normalize hierarchical prepared records to the browser search contract."""
    if "tiers" not in record:
        return record
    forms = list(record["tiers"]["forms"])
    phonology = list(record["tiers"]["phonology"])
    tier_translations = list(record["tiers"]["translations"])
    audio = list(record["tiers"]["audio"])
    words = record.get("words", [])
    for word in words:
        forms.extend(word["tiers"]["forms"])
        phonology.extend(word["tiers"]["phonology"])
        tier_translations.extend(word["tiers"]["translations"])
        audio.extend(word["tiers"]["audio"])
        for morpheme in word["morphemes"]:
            forms.extend(morpheme["tiers"]["forms"])
            phonology.extend(morpheme["tiers"]["phonology"])
            tier_translations.extend(morpheme["tiers"]["translations"])
            audio.extend(morpheme["tiers"]["audio"])
    return {
        **record,
        "id": record["sentence_id"],
        "xml_id": record["source_xml_id"],
        "standard": record["standard_form"] or "",
        "original": record["original_form"] or "",
        "translations": [
            item for item in record["tiers"]["translations"] if item["owner_type"] == "sentence"
        ],
        "forms": forms,
        "phonology": phonology,
        "tier_translations": tier_translations,
        "audio": audio,
    }


def resolve_recipe(release: Path, recipe: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    if manifest["release_id"] != recipe["release_id"]:
        raise BuildError(f"Recipe pins {recipe['release_id']}, release is {manifest['release_id']}")
    selection = recipe["selection"]
    record_ids = set(selection["record_ids"])
    languages = set(selection["language_ids"])
    corpora = set(selection["corpus_ids"])
    match = str(selection["match"])
    pattern: regex.Pattern[str] | None = None
    if match == "regex":
        try:
            pattern = regex.compile(
                unicodedata.normalize("NFC", str(selection["query"])),
                regex.VERSION1,
            )
        except regex.error as error:
            raise BuildError(f"Invalid recipe regular expression: {error}") from error
    result = []
    scanned = 0
    for line in _record_lines(release):
        record = _recipe_record(json.loads(line))
        if record["language_id"] not in languages:
            continue
        if corpora and record["corpus_id"] not in corpora:
            continue
        scanned += 1
        if match in {"regex", "fuzzy"} and scanned > 200_000:
            raise BuildError(
                "Recipe regex and fuzzy searches are limited to 200,000 scoped records"
            )
        if record_ids:
            selected = record["id"] in record_ids
        else:
            selected = _matches(record, selection["query"], match, pattern)
        if selected:
            result.append(record)
            if len(result) >= selection["max_rows"]:
                break
    if record_ids and {record["id"] for record in result} != record_ids:
        raise BuildError("Recipe record_ids are not all present in the pinned release and scope")
    return result


def _record_lines(release: Path) -> Iterator[str]:
    flat = release / "search" / "sentences.jsonl"
    if flat.is_file():
        with flat.open(encoding="utf-8") as stream:
            yield from stream
        return
    packages = sorted((release / "prepared" / "jsonl").glob("*.zip"))
    if not packages:
        raise BuildError("Release contains no executable recipe record source")
    for package in packages:
        with zipfile.ZipFile(package) as archive:
            for name in sorted(archive.namelist()):
                if not name.endswith(".jsonl"):
                    continue
                with archive.open(name) as stream:
                    for line in stream:
                        yield line.decode("utf-8")


def _value(record: dict[str, Any], field: str) -> object:
    if field == "translations":
        return " | ".join(f"{item['xml_lang']}:{item['text']}" for item in record["translations"])
    if field in {"tokens", "audio"}:
        return json.dumps(
            record[field],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    return record[field]


def _spreadsheet_safe(value: object, enabled: bool) -> object:
    if enabled and isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value}"
    return value


def write_recipe_export(
    records: list[dict[str, Any]],
    recipe: dict[str, Any],
    output: Path,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    export_format = recipe["format"]
    if export_format == "recipe":
        output.write_text(
            json.dumps(recipe, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return
    if export_format == "json":
        output.write_text(
            json.dumps(records, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return
    if export_format == "jsonl":
        output.write_text(
            "".join(
                json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
                for record in records
            ),
            encoding="utf-8",
            newline="\n",
        )
        return
    if export_format == "parquet":
        fields = recipe["fields"]
        table = pa.Table.from_pylist(
            [
                {
                    field: (
                        _value(record, field)
                        if isinstance(_value(record, field), (str, int, float, bool, type(None)))
                        else json.dumps(
                            _value(record, field),
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                        )
                    )
                    for field in fields
                }
                for record in records
            ]
        )
        pq.write_table(table, output, compression="zstd")
        return
    if export_format == "plain":
        output.write_text(
            "".join(f"{record['standard'] or record['original']}\n" for record in records),
            encoding="utf-8",
            newline="\n",
        )
        return
    if export_format == "interlinear":
        blocks = []
        for record in records:
            blocks.append(
                "\n".join(
                    [
                        f"\\id {record['id']}",
                        f"\\tx {record['standard'] or record['original']}",
                        "\\mb " + " ".join(item["surface"] for item in record["tokens"]),
                        "\\ft " + " | ".join(item["text"] for item in record["translations"]),
                    ]
                )
            )
        output.write_text("\n\n".join(blocks) + "\n", encoding="utf-8", newline="\n")
        return
    fields = recipe["fields"]
    if export_format == "audio":
        fields = [
            "id",
            "language_id",
            "corpus_id",
            "source_path",
            "file",
            "url",
            "source",
            "start",
            "end",
        ]
        rows = [
            {
                "id": record["id"],
                "language_id": record["language_id"],
                "corpus_id": record["corpus_id"],
                "source_path": record["source_path"],
                **audio,
            }
            for record in records
            for audio in record["audio"]
        ]
    else:
        rows = [{field: _value(record, field) for field in fields} for record in records]
    delimiter = "\t" if export_format in {"tsv", "audio"} else ","
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=fields,
            delimiter=delimiter,
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    field: _spreadsheet_safe(
                        row.get(field, ""),
                        bool(recipe["spreadsheet_safe"]),
                    )
                    for field in fields
                }
            )
