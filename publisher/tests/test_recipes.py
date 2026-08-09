from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest
from jsonschema import ValidationError

from publisher.build import build_release
from publisher.recipes import load_recipe, resolve_recipe, write_recipe_export


def _recipe(release_id: str, export_format: str = "csv") -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "release_id": release_id,
        "selection": {
            "query": "lima",
            "match": "exact",
            "language_ids": ["lang_amis"],
            "corpus_ids": [],
            "record_ids": [],
            "max_rows": 100,
            "record_unit": "sentence",
        },
        "fields": [
            "id",
            "standard",
            "original",
            "translations",
            "language_id",
            "corpus_id",
            "dialect",
            "source_path",
        ],
        "format": export_format,
        "spreadsheet_safe": True,
    }


def test_recipe_resolves_and_exports(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    document = _recipe(release.release_id)
    path = tmp_path / "recipe.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    schema = Path(__file__).resolve().parents[2] / "schemas" / "export-recipe.schema.json"

    loaded = load_recipe(path, schema)
    records = resolve_recipe(release.output, loaded)
    assert [record["xml_id"] for record in records] == ["s-one"]
    assert records[0]["audio"][0]["file"] == "sentence.wav"

    output = tmp_path / "selection.csv"
    write_recipe_export(records, loaded, output)
    assert "sentence.wav" not in output.read_text(encoding="utf-8-sig")
    assert output.read_text(encoding="utf-8-sig").endswith("\n")

    parquet_recipe = _recipe(release.release_id, "parquet")
    parquet_output = tmp_path / "selection.parquet"
    write_recipe_export(records, parquet_recipe, parquet_output)
    assert parquet_output.read_bytes()[:4] == b"PAR1"

    word_recipe = _recipe(release.release_id)
    cast(dict[str, object], word_recipe["selection"])["record_unit"] = "word"
    word_records = resolve_recipe(release.output, word_recipe)
    assert [record["xml_id"] for record in word_records] == ["w-one", "w-two"]
    assert word_records[0]["standard"] == "lima"


def test_recipe_runs_against_release_only_hierarchical_packages(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        compress_database=True,
        release_only=True,
    )
    records = resolve_recipe(release.output, _recipe(release.release_id))
    assert [record["xml_id"] for record in records] == ["s-one"]
    assert records[0]["translations"][0]["text"] == "A fictional translated line."


def test_recipe_matches_from_translation_back_to_formosan(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    document = _recipe(release.release_id)
    selection = cast(dict[str, object], document["selection"])
    selection.update(
        {
            "query": "fictional",
            "match": "exact",
            "query_field": "translation",
            "translation_language": "eng",
        }
    )
    records = resolve_recipe(release.output, document)
    assert [record["xml_id"] for record in records] == ["s-one"]

    selection["query"] = "fictional!"
    records = resolve_recipe(release.output, document)
    assert [record["xml_id"] for record in records] == ["s-one"]

    selection["query"] = "fictonal"
    selection["match"] = "fuzzy"
    records = resolve_recipe(release.output, document)
    assert [record["xml_id"] for record in records] == ["s-one"]

    selection["translation_language"] = "zho"
    assert resolve_recipe(release.output, document) == []


def test_recipe_rejects_unknown_fields(tmp_path: Path) -> None:
    document = _recipe("fb-20240102-deadbeef")
    document["executable"] = "print('no')"
    path = tmp_path / "recipe.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    schema = Path(__file__).resolve().parents[2] / "schemas" / "export-recipe.schema.json"
    with pytest.raises(ValidationError):
        load_recipe(path, schema)
