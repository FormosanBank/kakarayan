from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import subprocess
import zipfile
from contextlib import closing
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from jsonschema import ValidationError
from openpyxl import load_workbook

from publisher import PUBLIC_DOWNLOAD_PATHS
from publisher.build import BuildError, build_release
from publisher.cldf_export import write_cldf_package
from publisher.verify_release import verify_release


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
    assert catalog["corpora"][0]["citation_count"] == 1
    amis = next(row for row in catalog["languages"] if row["name"] == "Amis")
    assert amis["counts"]["sentences"] == 2
    assert amis["dialects"] == ["Xiuguluan"]
    assert "audio" in amis["capabilities"]
    search_response = json.loads(
        (first.output / "api" / "v1" / "search" / "manifest.json").read_text(encoding="utf-8")
    )
    search_manifest = search_response["data"]
    assert search_response["api_version"] == "v1"
    assert search_response["kakarayan"]["commit"]
    assert search_response["source"]["commit"] == first.source.commit
    assert search_response["canonical_url"].endswith("/api/v1/search/manifest.json")
    assert search_manifest["shards"][0]["records"] == 2
    assert search_manifest["shards"][0]["unit_counts"] == {
        "audio": 1,
        "morphemes": 1,
        "sentences": 2,
        "texts": 1,
        "tokens": 4,
        "words": 2,
    }
    assert search_manifest["shards"][0]["language_id"] == "lang_amis"
    assert search_manifest["shards"][0]["path"].endswith(".json.gz")
    assert (
        search_manifest["shards"][0]["uncompressed_bytes"] > search_manifest["shards"][0]["bytes"]
    )
    assert len(search_manifest["shards"][0]["uncompressed_sha256"]) == 64
    assert search_manifest["shards"][0]["part"] == 0
    assert search_manifest["translation_targets"] == [
        {
            "corpus_ids": ["corpus_testcorpus"],
            "language_ids": ["lang_amis"],
            "lexical_records": 1,
            "records": 1,
            "scopes": [
                {
                    "corpus_id": "corpus_testcorpus",
                    "language_id": "lang_amis",
                    "lexical_records": 1,
                    "records": 1,
                    "sentence_records": 1,
                }
            ],
            "sentence_records": 1,
            "xml_lang": "eng",
        },
        {
            "corpus_ids": ["corpus_testcorpus"],
            "language_ids": ["lang_amis"],
            "lexical_records": 0,
            "records": 1,
            "scopes": [
                {
                    "corpus_id": "corpus_testcorpus",
                    "language_id": "lang_amis",
                    "lexical_records": 0,
                    "records": 1,
                    "sentence_records": 1,
                }
            ],
            "sentence_records": 1,
            "xml_lang": "zho",
        },
    ]
    assert len(search_manifest["indexes"]) == 1
    search_records = json.loads(
        gzip.decompress(first.output.joinpath(search_manifest["shards"][0]["path"]).read_bytes())
    )
    search_index = json.loads(
        gzip.decompress(first.output.joinpath(search_manifest["indexes"][0]["path"]).read_bytes())
    )
    assert search_index["terms"]["source"]["lima waco"] == [0]
    assert search_index["terms"]["gloss"]["five"] == [0]
    first_sentence = search_records[0]
    assert first_sentence["phonology"][0]["text"] == "lima watso"
    assert first_sentence["tier_translations"][1]["kind"] == "gloss"
    assert first_sentence["tier_translations"][1]["owner_type"] == "morpheme"
    assert first_sentence["words"][0]["class"] == "noun"
    assert first_sentence["words"][0]["morphemes"][0]["class"] == "root"
    orthography = json.loads(
        (first.output / "api" / "v1" / "orthography.json").read_text(encoding="utf-8")
    )["data"]
    assert orthography["tables"][0]["language"] == "Amis"
    assert orthography["tables"][0]["rules"][1]["outputs"]["Xiuguluan"] == "o"
    content = json.loads(
        (first.output / "api" / "v1" / "content.json").read_text(encoding="utf-8")
    )["data"]
    assert content == {"schema_version": "1.0.0", "entries": []}
    downloads = json.loads(
        (first.output / "api" / "v1" / "downloads.json").read_text(encoding="utf-8")
    )["data"]
    assert downloads["release_id"] == first.release_id
    assert {item["path"] for item in downloads["artifacts"]} == (
        set(PUBLIC_DOWNLOAD_PATHS) - {"formosanbank.sqlite.gz"}
    )
    assert all(item["publishable"] for item in downloads["artifacts"])
    assert all(not item["blocked_reasons"] for item in downloads["artifacts"])
    assert all(item["format"] for item in downloads["artifacts"])
    assert all(item["language_ids"] == ["lang_amis"] for item in downloads["artifacts"])
    assert all(item["corpus_ids"] == ["corpus_testcorpus"] for item in downloads["artifacts"])
    assert all(item["tiers"] for item in downloads["artifacts"])
    assert all("/canonical/" not in item["path"] for item in downloads["artifacts"])
    assert all("/jsonl/" not in item["path"] for item in downloads["artifacts"])

    with zipfile.ZipFile(first.output / "prepared" / "parquet-tables.zip") as archive:
        assert pq.read_table(pa.BufferReader(archive.read("tokens.parquet"))).num_rows == 4
    workbook = load_workbook(
        first.output / "prepared" / "formosanbank.xlsx",
        read_only=True,
    )
    assert "README" in workbook.sheetnames
    assert "RIGHTS" in workbook.sheetnames
    workbook.close()
    canonical = next((first.output / "prepared" / "canonical").glob("*.zip"))
    with zipfile.ZipFile(canonical) as archive:
        source_path = "Corpora/TestCorpus/XML/fixture.xml"
        assert archive.read(source_path) == (public_repo / source_path).read_bytes()
        assert "rights.json" in archive.namelist()
    with zipfile.ZipFile(first.output / "prepared" / "time-aligned.zip") as archive:
        assert any(name.endswith(".eaf") for name in archive.namelist())
        assert any(name.endswith(".TextGrid") for name in archive.namelist())
        assert "README.txt" in archive.namelist()
        assert "rights.json" in archive.namelist()
    with zipfile.ZipFile(first.output / "prepared" / "formosanbank-cldf.zip") as archive:
        assert "Generic-metadata.json" in archive.namelist()
        assert "README.txt" in archive.namelist()
        assert "rights.json" in archive.namelist()
    jsonl_packages = list((first.output / "prepared" / "jsonl").glob("*.zip"))
    assert len(jsonl_packages) == 1
    with zipfile.ZipFile(jsonl_packages[0]) as archive:
        assert archive.namelist() == [
            "README.txt",
            "data-dictionary.json",
            "part-0000.jsonl",
            "rights.json",
        ]

    with closing(sqlite3.connect(first.output / "formosanbank.sqlite")) as database:
        assert database.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert database.execute("SELECT COUNT(*) FROM translations").fetchone() == (3,)
        embedded_meta = json.loads(
            database.execute(
                "SELECT value_json FROM publication_metadata WHERE key = 'meta'"
            ).fetchone()[0]
        )
        assert embedded_meta["release_id"] == first.release_id
        assert embedded_meta["kakarayan"]["commit"]


def test_output_directory_must_be_empty(public_repo: Path, tmp_path: Path) -> None:
    output = tmp_path / "output"
    output.mkdir()
    (output / "keep.txt").write_text("do not overwrite", encoding="utf-8")
    with pytest.raises(BuildError, match="absent or empty"):
        build_release(public_repo, output)


def test_source_commit_must_match(public_repo: Path, tmp_path: Path) -> None:
    with pytest.raises(BuildError, match="expected"):
        build_release(public_repo, tmp_path / "output", expected_commit="0" * 40)


def test_application_commit_must_match(public_repo: Path, tmp_path: Path) -> None:
    with pytest.raises(BuildError, match="Kakarayan HEAD"):
        build_release(public_repo, tmp_path / "output", application_commit="0" * 40)


def test_model_catalog_is_validated_before_corpus_projection(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    output = tmp_path / "output"
    incomplete_catalog: dict[str, object] = {
        "schema_version": "1.0.0",
        "generated_at": "2024-01-02T03:04:05Z",
        "provider": "Hugging Face",
        "models": [
            {
                "id": "model_formosanbank_example",
                "repository": "FormosanBank/example",
                "task": "translation",
                "url": "https://huggingface.co/FormosanBank/example",
                "license": "unknown",
                "languages": ["ami"],
                "limitations": "Machine output.",
            }
        ],
        "services": [],
    }

    with pytest.raises(ValidationError, match="framework"):
        build_release(public_repo, output, model_catalog=incomplete_catalog)

    assert not (output / "tables").exists()


def test_database_can_be_packaged_for_github_releases(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        compress_database=True,
        release_only=True,
    )
    assert not (release.output / "formosanbank.sqlite").exists()
    compressed = release.output / "formosanbank.sqlite.gz"
    assert compressed.read_bytes()[:2] == b"\x1f\x8b"
    manifest = verify_release(release.output, max_artifact_bytes=2 * 1024**3)
    artifact = next(
        item for item in manifest["artifacts"] if item["path"] == "formosanbank.sqlite.gz"
    )
    assert artifact["compression"] == "gzip"
    assert artifact["content_media_type"] == "application/vnd.sqlite3"
    assert artifact["asset_name"] == "formosanbank.sqlite.gz"
    assert artifact["download_url"].endswith(f"/data-{release.release_id}/formosanbank.sqlite.gz")
    assert not (release.output / "api").exists()
    assert not (release.output / "search").exists()
    assert not (release.output / "tables").exists()
    asset_names = [item["asset_name"] for item in manifest["artifacts"]]
    assert len(asset_names) == len(set(asset_names))


def test_cldf_streams_and_validates_large_source_fields(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        include_prepared=False,
    )
    database = release.output / "formosanbank.sqlite"
    large_translation = "large field " * 15_000
    with closing(sqlite3.connect(database)) as connection:
        connection.execute(
            """
            UPDATE translations
            SET text = ?
            WHERE rowid = (SELECT MIN(rowid) FROM translations)
            """,
            (large_translation,),
        )
        connection.commit()
    rights = json.loads((release.output / "rights.json").read_text(encoding="utf-8"))
    counts = write_cldf_package(
        database,
        tmp_path / "large-cldf.zip",
        release_id=release.release_id,
        source_commit=release.source.commit,
        rights=rights,
    )
    assert counts["examples"] == 2
    with zipfile.ZipFile(tmp_path / "large-cldf.zip") as archive:
        assert large_translation.encode() in archive.read("examples.csv")


def test_cldf_includes_babuza_favorlang_language_reference(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    [source] = public_repo.glob("Corpora/*/XML/*.xml")
    xml = source.read_text(encoding="utf-8")
    source.write_text(
        xml.replace('xml:lang="ami"', 'xml:lang="bzg"').replace(
            'dialect="Xiuguluan"', 'dialect="Favorlang"'
        ),
        encoding="utf-8",
    )
    subprocess.run(
        ["git", "-C", str(public_repo), "commit", "-am", "Use Babuza-Favorlang fixture"],
        check=True,
        capture_output=True,
    )
    release = build_release(
        public_repo,
        tmp_path / "release",
        include_prepared=False,
    )
    rights = json.loads((release.output / "rights.json").read_text(encoding="utf-8"))
    output = tmp_path / "babuza-favorlang-cldf.zip"
    counts = write_cldf_package(
        release.output / "formosanbank.sqlite",
        output,
        release_id=release.release_id,
        source_commit=release.source.commit,
        rights=rights,
    )

    assert counts["languages"] == 1
    with zipfile.ZipFile(output) as archive:
        languages = archive.read("languages.csv").decode("utf-8")
        examples = archive.read("examples.csv").decode("utf-8")
    assert "lang_babuza_favorlang,Babuza-Favorlang,,,,,bzg" in languages
    assert "lang_babuza_favorlang" in examples
