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


def _text_units(value: str) -> list[str]:
    normalized = regex.sub(r"^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$", "", _normalize(value))
    if not normalized:
        return []
    units = [item for item in regex.split(r"[^\p{L}\p{M}\p{N}'’ʼ-]+", normalized) if item]
    return list(dict.fromkeys([normalized, *units]))


def _translation_matches(
    value: str,
    query: str,
    match: str,
    pattern: regex.Pattern[str] | None,
) -> bool:
    query_units = _text_units(query)
    needle = query_units[0] if query_units else ""
    units = _text_units(value)
    if match == "regex":
        if pattern is None:
            raise BuildError("Recipe regular expression was not compiled")
        try:
            return pattern.search(value, timeout=0.05) is not None
        except TimeoutError as error:
            raise BuildError("Recipe regular expression exceeded its work limit") from error
    if match == "exact":
        return needle in units
    if match == "prefix":
        return any(unit.startswith(needle) for unit in units)
    if match == "fuzzy":
        maximum = 1 if len(needle) <= 4 else 2
        return any(
            len(unit) <= 80 and _edit_distance(unit, needle, maximum) <= maximum for unit in units
        )
    return needle in _normalize(value)


def _matches(
    record: dict[str, Any],
    query: str,
    match: str,
    pattern: regex.Pattern[str] | None = None,
    query_field: str = "formosan",
    translation_language: str = "",
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
    if query_field == "translation":
        translations = [
            item
            for item in record["translations"]
            if not translation_language or item["xml_lang"] == translation_language
        ]
        return any(
            _translation_matches(str(item["text"]), query, match, pattern) for item in translations
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


def _owner_record(
    record: dict[str, Any],
    owner_type: str,
    owner_id: str,
) -> dict[str, Any]:
    forms = [
        item
        for item in record["forms"]
        if item["owner_type"] == owner_type and item["owner_id"] == owner_id
    ]
    standard = next(
        (str(item["text"]) for item in forms if item["kind"] == "standard"),
        "",
    )
    original = next(
        (str(item["text"]) for item in forms if item["kind"] == "original"),
        "",
    )
    return {
        **record,
        "id": owner_id,
        "source_xml_id": "",
        "xml_id": "",
        "standard": standard,
        "original": original,
        "forms": forms,
        "phonology": [
            item
            for item in record["phonology"]
            if item["owner_type"] == owner_type and item["owner_id"] == owner_id
        ],
        "tier_translations": [
            item
            for item in record["tier_translations"]
            if item["owner_type"] == owner_type and item["owner_id"] == owner_id
        ],
        "audio": [
            item
            for item in record["audio"]
            if item["owner_type"] == owner_type and item["owner_id"] == owner_id
        ],
    }


def _project_record(record: dict[str, Any], unit: str) -> list[dict[str, Any]]:
    if unit == "sentence":
        return [record]
    if unit == "word":
        result = []
        for word in record["words"]:
            projected = _owner_record(record, "word", str(word["id"]))
            tokens = [item for item in record["tokens"] if item["word_id"] == word["id"]]
            token = tokens[0] if tokens else None
            projected.update(
                {
                    "xml_id": word["xml_id"],
                    "standard": projected["standard"]
                    or (str(token["normalized"]) if token else ""),
                    "original": projected["original"] or (str(token["surface"]) if token else ""),
                    "tokens": tokens,
                    "words": [word],
                }
            )
            result.append(projected)
        return result
    if unit == "morpheme":
        result = []
        for word in record["words"]:
            for morpheme in word["morphemes"]:
                projected = _owner_record(record, "morpheme", str(morpheme["id"]))
                projected.update(
                    {
                        "xml_id": morpheme["xml_id"],
                        "tokens": [
                            item for item in record["tokens"] if item["word_id"] == word["id"]
                        ],
                        "words": [{**word, "morphemes": [morpheme]}],
                    }
                )
                result.append(projected)
        return result
    if unit == "token":
        return [
            {
                **record,
                "id": f"{record['id']}--token-{token['position']}",
                "source_xml_id": "",
                "xml_id": "",
                "standard": token["normalized"],
                "original": token["surface"],
                "translations": [],
                "tokens": [token],
                "forms": [
                    item
                    for item in record["forms"]
                    if item["owner_type"] == "word" and item["owner_id"] == token["word_id"]
                ],
                "phonology": [
                    item
                    for item in record["phonology"]
                    if item["owner_type"] == "word" and item["owner_id"] == token["word_id"]
                ],
                "tier_translations": [
                    item
                    for item in record["tier_translations"]
                    if item["owner_type"] == "word" and item["owner_id"] == token["word_id"]
                ],
                "words": [word for word in record["words"] if word["id"] == token["word_id"]],
                "audio": [
                    item
                    for item in record["audio"]
                    if item["owner_type"] == "word" and item["owner_id"] == token["word_id"]
                ],
            }
            for token in record["tokens"]
        ]
    if unit == "audio":
        return [
            {
                **record,
                "id": (
                    f"{record['id']}--audio-{audio['owner_type']}-"
                    f"{audio['owner_id']}-{audio['position']}"
                ),
                "audio": [audio],
            }
            for audio in record["audio"]
        ]
    raise BuildError(f"Unsupported recipe record unit: {unit}")


def _append_text(target: dict[str, Any], record: dict[str, Any]) -> None:
    target["standard"] = "\n".join(
        value for value in (target["standard"], record["standard"]) if value
    )
    target["original"] = "\n".join(
        value for value in (target["original"], record["original"]) if value
    )
    for field in (
        "translations",
        "tokens",
        "forms",
        "phonology",
        "tier_translations",
        "words",
        "audio",
    ):
        target[field].extend(record[field])


def resolve_recipe(release: Path, recipe: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    if manifest["release_id"] != recipe["release_id"]:
        raise BuildError(f"Recipe pins {recipe['release_id']}, release is {manifest['release_id']}")
    selection = recipe["selection"]
    record_ids = set(selection["record_ids"])
    languages = set(selection["language_ids"])
    corpora = set(selection["corpus_ids"])
    match = str(selection["match"])
    query_field = str(selection.get("query_field", "formosan"))
    translation_language = str(selection.get("translation_language", ""))
    record_unit = str(selection.get("record_unit", "sentence"))
    pattern: regex.Pattern[str] | None = None
    if match == "regex":
        try:
            pattern = regex.compile(
                unicodedata.normalize("NFC", str(selection["query"])),
                regex.VERSION1,
            )
        except regex.error as error:
            raise BuildError(f"Invalid recipe regular expression: {error}") from error
    result: list[dict[str, Any]] = []
    texts: dict[str, dict[str, Any]] = {}
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
        if record_unit == "text":
            text_id = str(record["text_id"])
            selected = (
                text_id in record_ids
                if record_ids
                else _matches(
                    record,
                    selection["query"],
                    match,
                    pattern,
                    query_field,
                    translation_language,
                )
            )
            if not selected:
                continue
            if text_id not in texts:
                texts[text_id] = {
                    **record,
                    "id": text_id,
                    "source_xml_id": "",
                    "xml_id": "",
                    "translations": list(record["translations"]),
                    "tokens": list(record["tokens"]),
                    "forms": list(record["forms"]),
                    "phonology": list(record["phonology"]),
                    "tier_translations": list(record["tier_translations"]),
                    "words": list(record["words"]),
                    "audio": list(record["audio"]),
                }
            else:
                _append_text(texts[text_id], record)
            continue
        projected = _project_record(record, record_unit)
        if record_ids:
            result.extend(item for item in projected if item["id"] in record_ids)
        elif _matches(
            record,
            selection["query"],
            match,
            pattern,
            query_field,
            translation_language,
        ):
            result.extend(projected)
        if len(result) >= selection["max_rows"] or (
            record_ids and {item["id"] for item in result} == record_ids
        ):
            break
    if record_unit == "text":
        result = list(texts.values())
    result = result[: selection["max_rows"]]
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
