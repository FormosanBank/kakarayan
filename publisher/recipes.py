"""Validate and execute finite, release-pinned export recipes."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from jsonschema import Draft202012Validator

from api.dataset_fields import DatasetField, RecordLevel, project_record
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


def _level_owners(
    record: dict[str, Any], level: RecordLevel
) -> Iterator[tuple[dict[str, Any], dict[str, str]]]:
    if level == "sentence":
        yield record, {}
        return
    for word in record["words"]:
        if level == "word":
            yield word, {"sentence_id": record["id"]}
            continue
        for morpheme in word["morphemes"]:
            yield morpheme, {"sentence_id": record["id"], "word_id": word["id"]}


def _owner_tiers(record: dict[str, Any], owner: dict[str, Any], level: RecordLevel) -> dict:
    return record["tiers"] if level == "sentence" else owner["tiers"]


def _owner_matches(
    record: dict[str, Any], owner: dict[str, Any], level: RecordLevel, selection: dict[str, Any]
) -> bool:
    if level == "sentence":
        return _matches(record, selection)
    query = str(selection["query"])
    if not query:
        return True
    tiers = _owner_tiers(record, owner, level)
    match = cast(MatchMode, selection["match"])
    if selection["query_field"] == "translation":
        language = str(selection["translation_language"])
        return any(
            (not language or item["xml_lang"] == language)
            and matches(str(item["text"]), query, match)
            for item in tiers["translations"]
        )
    return any(matches(str(item["text"]), query, match, surface=True) for item in tiers["forms"])


def _selected_owner_form(forms: Sequence[Mapping[str, Any]]) -> str:
    values = {str(item["kind"]): str(item["text"]) for item in forms if item["text"]}
    return values.get("standard") or values.get("original") or values.get("alternate") or ""


def _owner_field(
    record: dict[str, Any],
    owner: dict[str, Any],
    ancestry: dict[str, str],
    level: RecordLevel,
    field: DatasetField,
) -> object:
    tiers = _owner_tiers(record, owner, level)
    forms = tiers["forms"]
    if field == "id":
        return record["id"] if level == "sentence" else owner["id"]
    if field == "xml_id":
        return record["xml_id"] if level == "sentence" else owner["xml_id"]
    if field == "parent_id":
        return owner["parent_id"]
    if field == "text_id":
        return record["text_id"]
    if field in {"sentence_id", "word_id"}:
        return ancestry[field]
    if field == "position":
        return record["source_ordinal"] if level == "sentence" else owner["position"]
    if field == "form":
        return _selected_owner_form(forms)
    if field in {"standard", "original"}:
        return next((item["text"] for item in forms if item["kind"] == field), "")
    if field == "alternate_forms":
        return " | ".join(item["text"] for item in forms if item["kind"] == "alternate")
    if field == "translations":
        return " | ".join(
            f"{item['xml_lang'] or 'und'}:{item['text']}" for item in tiers["translations"]
        )
    if field == "tokens":
        return " ".join(item["surface"] for item in record["tokens"])
    if field == "token_count":
        return record["token_count"]
    if field == "phonology":
        return " | ".join(item["text"] for item in tiers["phonology"])
    if field in {"class", "sclass"}:
        return owner[field]
    if field == "source":
        return record["source"]
    if field == "unclear":
        return int(
            any(
                int(item.get("unclear", 0)) > 0
                for item in [*forms, *tiers["phonology"], *tiers["translations"]]
            )
        )
    if field in {"language_id", "corpus_id", "dialect", "source_path"}:
        return record[field]
    if field == "audio":
        values = [
            {
                key: item[key]
                for key in ("file", "url", "start", "end", "source", "availability_status")
            }
            for item in tiers["audio"]
        ]
        return json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    raise BuildError(f"Unsupported {level} recipe field: {field}")


def _field_present(
    record: dict[str, Any], owner: dict[str, Any], level: RecordLevel, field: DatasetField
) -> bool:
    tiers = _owner_tiers(record, owner, level)
    if field == "form":
        return bool(tiers["forms"])
    if field in {"standard", "original"}:
        return any(item["kind"] == field for item in tiers["forms"])
    if field == "alternate_forms":
        return any(item["kind"] == "alternate" for item in tiers["forms"])
    if field in {"translations", "phonology", "audio"}:
        return bool(tiers[field])
    if field == "unclear":
        return any(
            int(item.get("unclear", 0)) > 0
            for item in [*tiers["forms"], *tiers["phonology"], *tiers["translations"]]
        )
    if field in {"class", "sclass"}:
        return bool(owner[field])
    if field == "source":
        return bool(record["source"])
    if field == "tokens":
        return bool(record["tokens"])
    return True


def _resolve_level_recipe(
    release: Path, recipe: dict[str, Any]
) -> dict[RecordLevel, list[dict[str, object]]]:
    selection = recipe["selection"]
    levels = cast(list[RecordLevel], selection["record_units"])
    fields = cast(dict[RecordLevel, list[DatasetField]], recipe["fields"])
    if set(levels) != set(fields):
        raise BuildError("Recipe fields must match its selected record_units")
    maximum = int(selection["max_rows"])
    complete = bool(selection["complete_fields"])
    record_ids = set(selection["record_ids"])
    languages = set(selection["language_ids"])
    corpora = set(selection["corpus_ids"])
    dialects = set(selection["dialects"])
    requirements = list(selection["requirements"])
    result: dict[RecordLevel, list[dict[str, object]]] = {level: [] for level in levels}
    found_ids: set[str] = set()
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
        for level in levels:
            if len(result[level]) >= maximum:
                continue
            for owner, ancestry in _level_owners(record, level):
                owner_id = str(record["id"] if level == "sentence" else owner["id"])
                if record_ids and owner_id not in record_ids:
                    continue
                if not record_ids and not _owner_matches(record, owner, level, selection):
                    continue
                if complete and any(
                    not _field_present(record, owner, level, field) for field in fields[level]
                ):
                    continue
                result[level].append(
                    {
                        field: _owner_field(record, owner, ancestry, level, field)
                        for field in fields[level]
                    }
                )
                found_ids.add(owner_id)
                if len(result[level]) >= maximum:
                    break
        if all(len(result[level]) >= maximum for level in levels):
            break
    if record_ids and found_ids != record_ids:
        raise BuildError("Recipe record_ids are not all present in the pinned release and scope")
    return result


def resolve_recipe(
    release: Path, recipe: dict[str, Any]
) -> list[dict[str, Any]] | dict[RecordLevel, list[dict[str, object]]]:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    if manifest["release_id"] != recipe["release_id"]:
        raise BuildError(f"Recipe pins {recipe['release_id']}, release is {manifest['release_id']}")
    selection = recipe["selection"]
    if "record_units" in selection:
        return _resolve_level_recipe(release, recipe)
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
    if packages:
        for package in packages:
            yield from _archive_record_lines(package)
        return
    bundled = release / "prepared" / "hierarchical-jsonl.zip"
    if not bundled.is_file():
        raise BuildError("Release contains no executable recipe record source")
    with zipfile.ZipFile(bundled) as outer:
        for name in sorted(item for item in outer.namelist() if item.endswith(".zip")):
            with outer.open(name) as stream, zipfile.ZipFile(io.BytesIO(stream.read())) as inner:
                yield from _archive_record_lines(inner)


def _archive_record_lines(package: Path | zipfile.ZipFile) -> Iterator[str]:
    if isinstance(package, zipfile.ZipFile):
        for name in sorted(package.namelist()):
            if name.endswith(".jsonl"):
                with package.open(name) as stream:
                    for line in stream:
                        yield line.decode("utf-8")
        return
    with zipfile.ZipFile(package) as archive:
        yield from _archive_record_lines(archive)


def _spreadsheet_safe(value: object, enabled: bool) -> object:
    if enabled and isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value}"
    return value


def write_recipe_export(
    records: list[dict[str, Any]] | dict[RecordLevel, list[dict[str, object]]],
    recipe: dict[str, Any],
    output: Path,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    export_format = recipe["format"]
    if isinstance(records, dict):
        fields_by_level = cast(dict[RecordLevel, list[DatasetField]], recipe["fields"])
        bodies = {
            level: _tabular_bytes(
                rows,
                fields_by_level[level],
                export_format,
                bool(recipe["spreadsheet_safe"]),
            )
            for level, rows in records.items()
        }
        if len(bodies) == 1:
            output.write_bytes(next(iter(bodies.values())))
            return
        with zipfile.ZipFile(output, "w") as archive:
            for level, body in bodies.items():
                info = zipfile.ZipInfo(f"{level}s.{export_format}", (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, body)
            info = zipfile.ZipInfo("recipe.json", (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(
                info,
                (json.dumps(recipe, ensure_ascii=False, indent=2) + "\n").encode(),
            )
        return
    fields = cast(list[DatasetField], recipe["fields"])
    if export_format == "jsonl":
        output.write_text(
            "".join(
                json.dumps(
                    project_record(record, fields),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n"
                for record in records
            ),
            encoding="utf-8",
            newline="\n",
        )
        return
    delimiter = "\t" if export_format == "tsv" else ","
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter=delimiter, lineterminator="\n")
        writer.writeheader()
        for record in records:
            projected = project_record(record, fields)
            writer.writerow(
                {
                    field: _spreadsheet_safe(
                        projected[field],
                        bool(recipe["spreadsheet_safe"]),
                    )
                    for field in fields
                }
            )


def _tabular_bytes(
    rows: list[dict[str, object]],
    fields: list[DatasetField],
    export_format: str,
    spreadsheet_safe: bool,
) -> bytes:
    output = io.StringIO(newline="")
    if export_format == "jsonl":
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        return output.getvalue().encode()
    delimiter = "\t" if export_format == "tsv" else ","
    writer = csv.DictWriter(output, fieldnames=fields, delimiter=delimiter, lineterminator="\n")
    writer.writeheader()
    writer.writerows(
        {field: _spreadsheet_safe(row[field], spreadsheet_safe) for field in fields} for row in rows
    )
    return output.getvalue().encode()
