"""Validate and execute declarative browser export recipes."""

from __future__ import annotations

import csv
import json
import unicodedata
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from publisher.build import BuildError


def load_recipe(path: Path, schema_path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(value)
    return value


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip().casefold()


def _matches(record: dict[str, Any], query: str, match: str) -> bool:
    needle = _normalize(query)
    if match == "translation":
        return any(needle in _normalize(item["text"]) for item in record["translations"])
    forms = [
        _normalize(record["standard"]),
        _normalize(record["original"]),
        *(_normalize(item["normalized"]) for item in record["tokens"]),
    ]
    forms = [value for value in forms if value]
    if match == "exact":
        return any(value == needle for value in forms)
    if match == "prefix":
        return any(value.startswith(needle) for value in forms)
    return any(needle in value for value in forms)


def resolve_recipe(release: Path, recipe: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    if manifest["release_id"] != recipe["release_id"]:
        raise BuildError(f"Recipe pins {recipe['release_id']}, release is {manifest['release_id']}")
    selection = recipe["selection"]
    record_ids = set(selection["record_ids"])
    languages = set(selection["language_ids"])
    corpora = set(selection["corpus_ids"])
    result = []
    source = release / "search" / "sentences.jsonl"
    with source.open(encoding="utf-8") as stream:
        for line in stream:
            record = json.loads(line)
            if record["language_id"] not in languages:
                continue
            if corpora and record["corpus_id"] not in corpora:
                continue
            if record_ids:
                selected = record["id"] in record_ids
            else:
                selected = _matches(record, selection["query"], selection["match"])
            if selected:
                result.append(record)
                if len(result) >= selection["max_rows"]:
                    break
    if record_ids and {record["id"] for record in result} != record_ids:
        raise BuildError("Recipe record_ids are not all present in the pinned release and scope")
    return result


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
