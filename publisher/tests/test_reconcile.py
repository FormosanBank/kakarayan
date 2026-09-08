from __future__ import annotations

import csv
import io
import json
import sqlite3
import zipfile
from contextlib import closing
from typing import cast

from publisher.build import build_release
from publisher.reconcile import (
    _database_state,
    _delimited_archive,
    _parquet_archive,
    _scan,
    reconcile_release,
)
from publisher.tables import TABLE_COLUMNS, delimited_cell


def test_fixture_reconciles_across_primary_representations(
    public_repo,
    tmp_path,
    monkeypatch,
) -> None:
    release = build_release(public_repo, tmp_path / "release")
    result = reconcile_release(release.output, source_repo=public_repo)
    counts = cast(dict[str, int], result["counts"])

    assert counts["sentences"] == 2
    assert counts["tokens"] == 4
    assert result["representations"] == [
        "csv",
        "flat_jsonl",
        "hierarchical_jsonl",
        "parquet",
        "sqlite",
        "tsv",
        "xlsx",
    ]
    assert result["canonical_files_verified"] == 1
    assert result["semantic_formats"] == ["csv", "flat_jsonl", "parquet", "sqlite", "tsv"]

    database_counts, samples, duration, _, _, digests = _database_state(
        release.output / "formosanbank.sqlite"
    )
    zip_read = zipfile.ZipFile.read

    def reject_whole_parquet_read(archive, name, *args, **kwargs):
        if str(name).endswith(".parquet"):
            raise AssertionError("Parquet members must be streamed to a temporary file")
        return zip_read(archive, name, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "read", reject_whole_parquet_read)
    parquet_counts, parquet_samples, parquet_duration, parquet_digests = _parquet_archive(
        release.output / "prepared" / "parquet-tables.zip",
        samples,
    )
    assert parquet_counts == database_counts
    assert parquet_samples == samples
    assert parquet_duration == duration
    assert parquet_digests == digests


def test_delimited_reconciliation_accepts_preserved_large_fields(tmp_path) -> None:
    package = tmp_path / "tables.zip"
    with zipfile.ZipFile(package, "w") as archive:
        for table, columns in TABLE_COLUMNS.items():
            stream = io.StringIO(newline="")
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            if table == "texts":
                row = {column: r"\N" for column in columns}
                row["id"] = "text_large"
                row["citation"] = "x" * (128 * 1024)
                writer.writerow(row)
            archive.writestr(f"{table}.csv", stream.getvalue())

    counts, samples, duration, _ = _delimited_archive(
        package,
        "csv",
        delimiter=",",
        samples={},
    )

    assert counts == {table: int(table == "texts") for table in TABLE_COLUMNS}
    assert samples == {}
    assert duration == 0.0


def test_hierarchical_text_count_excludes_texts_without_sentences(
    public_repo,
    tmp_path,
) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    database = release.output / "formosanbank.sqlite"
    text_columns = TABLE_COLUMNS["texts"]
    retained_columns = ", ".join(f'"{column}"' for column in text_columns[1:])
    with closing(sqlite3.connect(database)) as connection:
        connection.execute(
            f"INSERT INTO texts SELECT ?, {retained_columns} FROM texts LIMIT 1",
            ("text_without_sentences",),
        )
        connection.commit()

    counts, _, _, hierarchical_counts, _, _ = _database_state(database)

    assert counts["texts"] == 2
    assert hierarchical_counts["texts"] == 1


def test_semantic_digest_covers_late_changes_and_preserved_null_lookalikes():
    rows = [{column: "" for column in TABLE_COLUMNS["texts"]} for _ in range(100)]
    for index, row in enumerate(rows):
        row.update(
            id=f"text_{index}", citation=[None, "", r"\N", r"\\N", "父親,\n=word"][index % 5]
        )
    encoded = [{column: delimited_cell(value) for column, value in row.items()} for row in rows]
    original = _scan("texts", iter(rows), "text_0")
    assert _scan("texts", iter(encoded), "text_0", delimited=True) == original
    copied = json.loads(json.dumps(rows))
    copied[99]["citation"] = "changed after the first sample"
    changed = _scan("texts", iter(copied), "text_0")
    assert changed[0] == original[0] and changed[2] == original[2]
    assert changed[1] != original[1]


def test_reconciliation_retains_one_verified_database(public_repo, tmp_path, monkeypatch):
    from publisher import verify_release as verification

    release = build_release(
        public_repo, tmp_path / "release", compress_database=True, release_only=True
    )
    original = verification._verify_database
    verified = []

    def inspect(path, manifest):
        verified.append(path)
        return original(path, manifest)

    monkeypatch.setattr(verification, "_verify_database", inspect)
    database = tmp_path / "validated.sqlite"
    result = reconcile_release(release.output, source_repo=public_repo, database_output=database)
    assert verified == [database.resolve()]
    assert database.is_file()
    assert result["counts"]["sentences"] == 2
