"""Validate and execute finite, sentence-level export recipes."""

from __future__ import annotations

import csv
import json
import zipfile
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any, cast

from jsonschema import Draft202012Validator

from api.search import MatchMode, matches
from publisher.build import BuildError


def load_recipe(path: Path, schema_path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(value)
    return value


def _recipe_record(record: dict[str, Any]) -> dict[str, Any]:
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


def _matches(record: dict[str, Any], selection: dict[str, Any]) -> bool:
    query = str(selection["query"])
    if not query:
        return True
    match = cast(MatchMode, selection["match"])
    if selection["query_field"] == "translation":
        language = str(selection["translation_language"])
        return any(
            (not language or item["xml_lang"] == language)
            and matches(str(item["text"]), query, match)
            for item in record["tier_translations"]
        )
    values = [
        record["standard"],
        record["original"],
        *(item["surface"] for item in record["tokens"]),
        *(item["text"] for item in record["forms"]),
    ]
    return any(matches(str(value), query, match, surface=True) for value in values)


def _has_requirements(record: dict[str, Any], requirements: Sequence[str]) -> bool:
    for requirement in requirements:
        if requirement == "translation" and not record["tier_translations"]:
            return False
        if requirement == "audio" and not record["audio"]:
            return False
        if requirement == "phonology" and not record["phonology"]:
            return False
        if requirement == "interlinear" and not record["words"]:
            return False
        if requirement == "unclear" and not any(
            int(item.get("unclear", 0)) > 0
            for item in [*record["forms"], *record["phonology"], *record["tier_translations"]]
        ):
            return False
    return True


def resolve_recipe(release: Path, recipe: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    if manifest["release_id"] != recipe["release_id"]:
        raise BuildError(f"Recipe pins {recipe['release_id']}, release is {manifest['release_id']}")
    selection = recipe["selection"]
    record_ids = set(selection["record_ids"])
    languages = set(selection["language_ids"])
    corpora = set(selection["corpus_ids"])
    dialects = set(selection["dialects"])
    requirements = list(selection["requirements"])
    result: list[dict[str, Any]] = []
    for line in _record_lines(release):
        record = _recipe_record(json.loads(line))
        if record["language_id"] not in languages:
            continue
        if corpora and record["corpus_id"] not in corpora:
            continue
        if dialects and record["dialect"] not in dialects:
            continue
        if not _has_requirements(record, requirements):
            continue
        if record_ids and record["id"] not in record_ids:
            continue
        if not record_ids and not _matches(record, selection):
            continue
        result.append(record)
        if len(result) >= selection["max_rows"]:
            break
    if record_ids and {record["id"] for record in result} != record_ids:
        raise BuildError("Recipe record_ids are not all present in the pinned release and scope")
    return result


def _record_lines(release: Path) -> Iterator[str]:
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
    if field == "tokens":
        return " ".join(item["surface"] for item in record["tokens"])
    if field == "phonology":
        return " | ".join(item["text"] for item in record["phonology"])
    if field == "glosses":
        return " | ".join(
            item["text"] for item in record["tier_translations"] if item["owner_type"] != "sentence"
        )
    if field == "audio":
        return " | ".join(item["url"] or item["file"] or item["source"] for item in record["audio"])
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
    fields = recipe["fields"]
    delimiter = "\t" if export_format == "tsv" else ","
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter=delimiter, lineterminator="\n")
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    field: _spreadsheet_safe(
                        _value(record, field), bool(recipe["spreadsheet_safe"])
                    )
                    for field in fields
                }
            )
