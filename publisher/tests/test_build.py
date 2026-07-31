from __future__ import annotations

import hashlib
import json
import sqlite3
import zipfile
from contextlib import closing
from pathlib import Path

import pyarrow.parquet as pq
import pytest
from openpyxl import load_workbook

from publisher.build import BuildError, build_release


def _tree_checksums(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


def test_fixture_release_is_valid_and_deterministic(public_repo: Path, tmp_path: Path) -> None:
    first = build_release(public_repo, tmp_path / "one")
    second = build_release(public_repo, tmp_path / "two")

    assert first.release_id.startswith("fb-20240102-")
    assert first.counts["texts"] == 1
    assert first.counts["tokens"] == 4
    assert first.warnings == ()
    assert _tree_checksums(first.output) == _tree_checksums(second.output)

    catalog = json.loads((first.output / "catalog.json").read_text(encoding="utf-8"))
    assert catalog["source"]["commit"] == first.source.commit
    assert catalog["corpora"][0]["name"] == "TestCorpus"
    assert catalog["corpora"][0]["rights_id"] == "rights_testcorpus"
    amis = next(row for row in catalog["languages"] if row["name"] == "Amis")
    assert amis["counts"]["sentences"] == 2
    assert "audio" in amis["capabilities"]
    search_manifest = json.loads(
        (first.output / "api" / "v1" / "search" / "manifest.json").read_text(encoding="utf-8")
    )
    assert search_manifest["shards"][0]["records"] == 2
    assert search_manifest["shards"][0]["language_id"] == "lang_amis"
    orthography = json.loads(
        (first.output / "api" / "v1" / "orthography.json").read_text(encoding="utf-8")
    )
    assert orthography["tables"][0]["language"] == "Amis"
    assert orthography["tables"][0]["rules"][1]["outputs"]["Xiuguluan"] == "o"
    downloads = json.loads(
        (first.output / "api" / "v1" / "downloads.json").read_text(encoding="utf-8")
    )
    assert downloads["release_id"] == first.release_id
    assert any(item["path"].endswith("csv-tables.zip") for item in downloads["artifacts"])
    assert all(not item["publishable"] for item in downloads["artifacts"])
    assert all(item["blocked_reasons"] for item in downloads["artifacts"])

    token_parquet = first.output / "prepared" / "parquet" / "tokens.parquet"
    assert pq.read_table(token_parquet).num_rows == 4
    workbook = load_workbook(
        first.output / "prepared" / "formosanbank.xlsx",
        read_only=True,
    )
    assert "README" in workbook.sheetnames
    workbook.close()
    canonical = next((first.output / "prepared" / "canonical").glob("*.zip"))
    with zipfile.ZipFile(canonical) as archive:
        source_path = "Corpora/TestCorpus/XML/fixture.xml"
        assert archive.read(source_path) == (public_repo / source_path).read_bytes()
        assert "rights.json" in archive.namelist()
    with zipfile.ZipFile(first.output / "prepared" / "time-aligned.zip") as archive:
        assert any(name.endswith(".eaf") for name in archive.namelist())
        assert any(name.endswith(".TextGrid") for name in archive.namelist())
    with zipfile.ZipFile(first.output / "prepared" / "formosanbank-cldf.zip") as archive:
        assert "Generic-metadata.json" in archive.namelist()
    jsonl_packages = list((first.output / "prepared" / "jsonl").glob("*.zip"))
    assert len(jsonl_packages) == 1
    with zipfile.ZipFile(jsonl_packages[0]) as archive:
        assert archive.namelist() == ["part-0000.jsonl"]

    with closing(sqlite3.connect(first.output / "formosanbank.sqlite")) as database:
        assert database.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert database.execute("SELECT COUNT(*) FROM translations").fetchone() == (3,)
        embedded_meta = json.loads(
            database.execute(
                "SELECT value_json FROM publication_metadata WHERE key = 'meta'"
            ).fetchone()[0]
        )
        assert embedded_meta["release_id"] == first.release_id


def test_output_directory_must_be_empty(public_repo: Path, tmp_path: Path) -> None:
    output = tmp_path / "output"
    output.mkdir()
    (output / "keep.txt").write_text("do not overwrite", encoding="utf-8")
    with pytest.raises(BuildError, match="absent or empty"):
        build_release(public_repo, output)


def test_source_commit_must_match(public_repo: Path, tmp_path: Path) -> None:
    with pytest.raises(BuildError, match="expected"):
        build_release(public_repo, tmp_path / "output", expected_commit="0" * 40)
