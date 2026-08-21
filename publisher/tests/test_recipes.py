from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient
from jsonschema import ValidationError

from api.app import create_app
from api.config import Settings
from publisher.build import build_release, validate_document
from publisher.recipes import execute_recipe, load_recipe


def _schema() -> Path:
    return Path(__file__).resolve().parents[2] / "schemas" / "export-recipe.schema.json"


def _recipe(release_id: str, export_format: str = "csv") -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "release_id": release_id,
        "selection": {
            "query": "lima",
            "match": "exact",
            "query_field": "formosan",
            "translation_language": "",
            "language_ids": ["lang_amis"],
            "corpus_ids": [],
            "dialects": [],
            "requirements": [],
            "record_ids": [],
            "max_rows": 100,
            "record_units": ["sentence"],
            "complete_fields": False,
        },
        "fields": {
            "sentence": [
                "id",
                "standard",
                "original",
                "translations",
                "language_id",
                "corpus_id",
                "dialect",
                "source_path",
            ]
        },
        "format": export_format,
        "spreadsheet_safe": True,
    }


def _settings(release: Path) -> Settings:
    return Settings(
        manifest_path=release / "release-manifest.json",
        database_path=release / "formosanbank.sqlite",
        expected_sha256=None,
        cors_origins=(),
    )


def test_frontend_recipe_fixture_validates() -> None:
    root = Path(__file__).resolve().parents[2]
    recipe = json.loads((root / "tests" / "fixtures" / "export-recipe.json").read_text())
    validate_document(recipe, _schema())


def test_recipe_and_api_exports_have_golden_parity(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release")
    root = Path(__file__).resolve().parents[2]
    recipe = json.loads((root / "tests" / "fixtures" / "export-recipe.json").read_text())
    recipe["release_id"] = release.release_id

    output = tmp_path / "xml-levels.zip"
    assert execute_recipe(release.output, recipe, output) == 3
    with zipfile.ZipFile(output) as recipe_archive:
        assert recipe_archive.namelist() == [
            "sentences.csv",
            "words.csv",
            "morphemes.csv",
            "recipe.json",
        ]
        assert recipe_archive.read("words.csv").decode().startswith("id,sentence_id,form\n")
        recipe_tables = {
            name: recipe_archive.read(name)
            for name in ("sentences.csv", "words.csv", "morphemes.csv")
        }

    with TestClient(create_app(_settings(release.output))) as client:
        response = client.get(
            f"/v1/releases/{release.release_id}/datasets/export-package",
            params=[
                ("language_id", "lang_amis"),
                ("corpus_id", "corpus_testcorpus"),
                ("dialect", "Xiuguluan"),
                ("q", "five"),
                ("direction", "translation"),
                ("translation_language", "eng"),
                ("match", "contains"),
                ("record_level", "sentence"),
                ("record_level", "word"),
                ("record_level", "morpheme"),
                ("sentence_field", "id"),
                ("sentence_field", "standard"),
                ("sentence_field", "translations"),
                ("word_field", "id"),
                ("word_field", "sentence_id"),
                ("word_field", "form"),
                ("morpheme_field", "id"),
                ("morpheme_field", "word_id"),
                ("morpheme_field", "form"),
                ("morpheme_field", "translations"),
                ("complete_fields", "true"),
                ("max_rows", "250"),
                ("format", "csv"),
            ],
        )
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as api_archive:
        for name, body in recipe_tables.items():
            assert api_archive.read(name) == body

    second = tmp_path / "xml-levels-again.zip"
    execute_recipe(release.output, recipe, second)
    assert output.read_bytes() == second.read_bytes()


def test_documented_recipe_module_command_runs(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release")
    recipe = _recipe(release.release_id)
    recipe_path = tmp_path / "recipe.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")
    output = tmp_path / "selection.csv"

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "publisher.recipes",
            "--release",
            str(release.output),
            "--recipe",
            str(recipe_path),
            "--output",
            str(output),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.startswith("Wrote 1 records")
    assert (
        list(csv.DictReader(output.read_text(encoding="utf-8-sig").splitlines()))[0]["standard"]
        == "lima waco"
    )


def test_recipe_activates_a_compressed_release(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        compress_database=True,
        release_only=True,
    )
    output = tmp_path / "selection.jsonl"
    recipe = _recipe(release.release_id, "jsonl")

    assert execute_recipe(release.output, recipe, output) == 1
    row = json.loads(output.read_text())
    assert row["standard"] == "lima waco"
    assert row["translations"] == "eng:A fictional translated line."


def test_recipe_matches_from_translation_back_to_formosan(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    release = build_release(public_repo, tmp_path / "release")
    document = _recipe(release.release_id, "jsonl")
    selection = cast(dict[str, object], document["selection"])
    selection.update(
        {
            "query": "fictional",
            "match": "contains",
            "query_field": "translation",
            "translation_language": "eng",
        }
    )
    output = tmp_path / "translated.jsonl"
    assert execute_recipe(release.output, document, output) == 1
    assert json.loads(output.read_text())["standard"] == "lima waco"

    selection["translation_language"] = "zho"
    assert execute_recipe(release.output, document, output) == 0
    assert output.read_text() == ""


def test_recipe_schema_rejects_unknown_and_legacy_fields(tmp_path: Path) -> None:
    document = _recipe("fb-20240102-deadbeef")
    document["executable"] = "print('no')"
    path = tmp_path / "recipe.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_recipe(path, _schema())

    document.pop("executable")
    cast(dict[str, list[str]], document["fields"])["sentence"].append("glosses")
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_recipe(path, _schema())
