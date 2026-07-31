from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

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
    assert any(item["path"] == "formosanbank.sqlite" for item in downloads["artifacts"])

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
