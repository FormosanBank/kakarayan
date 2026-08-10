from __future__ import annotations

import csv
import io
import sqlite3
import zipfile
from contextlib import closing
from typing import cast

from publisher.assemble_site import assemble
from publisher.build import build_release
from publisher.reconcile import _database_state, _delimited_archive, reconcile_release
from publisher.tables import TABLE_COLUMNS


def test_fixture_reconciles_across_primary_representations(public_repo, tmp_path) -> None:
    release = build_release(public_repo, tmp_path / "release")
    site = tmp_path / "site"
    assemble(release.output, site)
    result = reconcile_release(release.output, source_repo=public_repo, site=site)
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
    assert result["browser"] == {"sentences": 2, "tokens": 4}


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

    counts, samples, duration = _delimited_archive(
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

    counts, _, _, hierarchical_counts, _ = _database_state(database)

    assert counts["texts"] == 2
    assert hierarchical_counts["texts"] == 1
