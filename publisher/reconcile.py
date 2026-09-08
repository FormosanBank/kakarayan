"""Reconcile complete relational values and documented hierarchical projections."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import shutil
import sqlite3
import tempfile
import zipfile
from collections.abc import Iterator, Mapping
from contextlib import closing
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
from openpyxl import load_workbook

from publisher.format_tabular import _safe_spreadsheet
from publisher.profiling import StageProfile
from publisher.tables import INTEGER_COLUMNS, REAL_COLUMNS, TABLE_COLUMNS
from publisher.verify_release import VerificationError, verify_release

_DELIMITED_FIELD_LIMIT = 64 * 1024 * 1024


class ReconciliationError(RuntimeError):
    """Raised when two generated representations disagree."""


def _require_equal(label: str, actual: object, expected: object) -> None:
    if actual != expected:
        raise ReconciliationError(f"{label} differs: expected {expected!r}, received {actual!r}")


def _database_state(
    database: Path,
) -> tuple[
    dict[str, int],
    dict[str, dict[str, Any]],
    float,
    dict[str, int],
    float,
    dict[str, str],
]:
    counts: dict[str, int] = {}
    samples: dict[str, dict[str, Any]] = {}
    digests: dict[str, str] = {}
    uri = f"file:{database}?mode=ro&immutable=1"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        # The caller has just validated these exact bytes, including integrity and
        # embedded identity. Do not repeat the expensive integrity pass here.
        for table, columns in TABLE_COLUMNS.items():
            row = connection.execute(
                f'SELECT {", ".join(columns)} FROM "{table}" ORDER BY id LIMIT 1'
            ).fetchone()
            if row is not None:
                samples[table] = dict(row)
            rows = (
                dict(row)
                for row in connection.execute(
                    f'SELECT {", ".join(columns)} FROM "{table}" ORDER BY rowid'
                )
            )
            counts[table], digests[table], _, _ = _scan(
                table, rows, samples.get(table, {}).get("id")
            )
        duration = math.fsum(
            float(row[0])
            for row in connection.execute("SELECT duration FROM audio WHERE duration IS NOT NULL")
        )
        hierarchical_counts = dict(counts)
        hierarchical_counts["texts"] = int(
            connection.execute("SELECT COUNT(DISTINCT parent_id) FROM sentences").fetchone()[0]
        )
        for table in ("forms", "phonology", "translations", "audio"):
            hierarchical_counts[table] = int(
                connection.execute(
                    f'SELECT COUNT(*) FROM "{table}" WHERE owner_type != ?',
                    ("text",),
                ).fetchone()[0]
            )
        hierarchical_duration = math.fsum(
            float(row[0])
            for row in connection.execute(
                "SELECT duration FROM audio WHERE duration IS NOT NULL AND owner_type != ?",
                ("text",),
            )
        )
    return counts, samples, duration, hierarchical_counts, hierarchical_duration, digests


def _coerce_row(table: str, row: Mapping[str, Any], *, delimited: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for column in TABLE_COLUMNS[table]:
        value = row.get(column)
        if delimited and value == r"\N":
            value = None
        elif delimited and isinstance(value, str) and value.startswith("\\\\"):
            value = value[1:]
        elif value is not None and column in INTEGER_COLUMNS:
            value = (
                1
                if value is True or value == "True"
                else 0
                if value is False or value == "False"
                else int(value)
            )
        elif value is not None and column in REAL_COLUMNS:
            value = float(value)
        result[column] = value
    return result


def _scan(
    table: str, rows: Iterator[Mapping[str, Any]], sample_id: str | None, *, delimited: bool = False
) -> tuple[int, str, dict[str, Any] | None, float]:
    digest = hashlib.sha256()
    count, sample = 0, None

    def durations() -> Iterator[float]:
        nonlocal count, sample
        for raw in rows:
            row = _coerce_row(table, raw, delimited=delimited)
            digest.update(
                json.dumps(
                    list(row.values()), ensure_ascii=False, allow_nan=False, separators=(",", ":")
                ).encode()
                + b"\n"
            )
            count += 1
            if row["id"] == sample_id:
                sample = row
            if table == "audio" and row["duration"] is not None:
                yield float(row["duration"])

    duration = math.fsum(durations())
    return count, digest.hexdigest(), sample, duration


def _delimited_archive(
    path: Path,
    suffix: str,
    *,
    delimiter: str,
    samples: Mapping[str, Mapping[str, Any]],
) -> tuple[dict[str, int], dict[str, dict[str, Any]], float, dict[str, str]]:
    counts: dict[str, int] = {}
    found: dict[str, dict[str, Any]] = {}
    duration = 0.0
    digests: dict[str, str] = {}
    previous_limit = csv.field_size_limit()
    csv.field_size_limit(max(previous_limit, _DELIMITED_FIELD_LIMIT))
    try:
        with zipfile.ZipFile(path) as archive:
            for table in TABLE_COLUMNS:
                name = f"{table}.{suffix}"
                if name not in archive.namelist():
                    raise ReconciliationError(f"{path.name} has no {name}")
                with (
                    archive.open(name) as raw,
                    io.TextIOWrapper(raw, encoding="utf-8", newline="") as stream,
                ):
                    reader = csv.DictReader(stream, delimiter=delimiter)
                    _require_equal(
                        f"{path.name}:{name} header",
                        tuple(reader.fieldnames or ()),
                        TABLE_COLUMNS[table],
                    )
                    sample_id = samples.get(table, {}).get("id")
                    counts[table], digests[table], sample, total = _scan(
                        table, reader, sample_id, delimited=True
                    )
                    if sample is not None:
                        found[table] = sample
                    duration += total
    except csv.Error as error:
        raise ReconciliationError(
            f"{path.name} has a delimited field above {_DELIMITED_FIELD_LIMIT} characters"
        ) from error
    finally:
        csv.field_size_limit(previous_limit)
    return counts, found, duration, digests


def _jsonl_archive(
    path: Path,
    samples: Mapping[str, Mapping[str, Any]],
) -> tuple[dict[str, int], dict[str, dict[str, Any]], float, dict[str, str]]:
    counts: dict[str, int] = {}
    found: dict[str, dict[str, Any]] = {}
    duration = 0.0
    digests: dict[str, str] = {}
    with zipfile.ZipFile(path) as archive:
        for table in TABLE_COLUMNS:
            name = f"{table}.jsonl"
            if name not in archive.namelist():
                raise ReconciliationError(f"{path.name} has no {name}")
            sample_id = samples.get(table, {}).get("id")
            with archive.open(name) as stream:
                counts[table], digests[table], sample, total = _scan(
                    table, (json.loads(line) for line in stream), sample_id
                )
            if sample is not None:
                found[table] = sample
            duration += total
    return counts, found, duration, digests


def _parquet_archive(
    path: Path,
    samples: Mapping[str, Mapping[str, Any]],
) -> tuple[dict[str, int], dict[str, dict[str, Any]], float, dict[str, str]]:
    counts: dict[str, int] = {}
    found: dict[str, dict[str, Any]] = {}
    duration = 0.0
    digests: dict[str, str] = {}
    with (
        zipfile.ZipFile(path) as archive,
        tempfile.TemporaryDirectory(prefix="kakarayan-parquet-") as temporary,
    ):
        member_path = Path(temporary) / "member.parquet"
        names = set(archive.namelist())
        for table, columns in TABLE_COLUMNS.items():
            name = f"{table}.parquet"
            if name not in names:
                raise ReconciliationError(f"{path.name} has no {name}")
            with archive.open(name) as source, member_path.open("wb") as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)
            parquet = pq.ParquetFile(member_path)
            counts[table] = parquet.metadata.num_rows
            _require_equal(
                f"{path.name}:{name} fields",
                tuple(parquet.schema_arrow.names),
                columns,
            )
            sample_id = samples.get(table, {}).get("id")
            rows = (
                row for batch in parquet.iter_batches(batch_size=4096) for row in batch.to_pylist()
            )
            scanned, digests[table], sample, total = _scan(table, rows, sample_id)
            _require_equal(f"{table} Parquet rows", scanned, counts[table])
            if sample is not None:
                found[table] = sample
            duration += total
            member_path.unlink()
    return counts, found, duration, digests


def _xlsx_samples(database: Path) -> dict[str, dict[str, tuple[object, ...]]]:
    samples: dict[str, dict[str, tuple[object, ...]]] = {}
    with closing(sqlite3.connect(f"file:{database}?mode=ro&immutable=1", uri=True)) as connection:
        for table, columns in TABLE_COLUMNS.items():
            maximum = connection.execute(f'SELECT MAX(rowid) FROM "{table}"').fetchone()[0] or 0
            positions = (
                sorted({1 + (maximum - 1) * index // 31 for index in range(32)}) if maximum else []
            )
            rows = connection.execute(
                f'SELECT {", ".join(columns)} FROM "{table}" '
                "WHERE rowid IN (SELECT value FROM json_each(?))",
                (json.dumps(positions),),
            )
            samples[table] = {}
            for row in rows:
                cells = [_safe_spreadsheet(value) for value in row]
                samples[table][row[0]] = tuple(
                    None
                    if value == ""
                    else value[:32767]
                    if isinstance(value, str)
                    else float(format(value, ".16g"))
                    if isinstance(value, float)
                    else value
                    for value in cells
                )
    return samples


def _xlsx_counts(path: Path, samples: dict[str, dict[str, tuple[object, ...]]]) -> dict[str, int]:
    counts = {table: 0 for table in TABLE_COLUMNS}
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        for table in TABLE_COLUMNS:
            sheets = [
                sheet
                for sheet in workbook.worksheets
                if sheet.title == table or sheet.title.startswith(f"{table}_")
            ]
            if not sheets:
                raise ReconciliationError(f"{path.name} has no {table} sheet")
            for sheet in sheets:
                rows = sheet.iter_rows(values_only=True)
                _require_equal(f"xlsx {sheet.title} header", next(rows), TABLE_COLUMNS[table])
                for row in rows:
                    counts[table] += 1
                    if row[0] in samples[table]:
                        expected = samples[table].pop(str(row[0]))
                        _require_equal(f"xlsx {table} {row[0]}", row, expected)
            if samples[table]:
                raise ReconciliationError(f"XLSX lost sampled {table} identifiers")
    finally:
        workbook.close()
    return counts


def _hierarchical_counts(root: Path) -> tuple[dict[str, int], float]:
    counts = {table: 0 for table in TABLE_COLUMNS}
    text_ids: set[str] = set()
    durations: list[float] = []

    def add_tiers(tiers: Mapping[str, list[dict[str, Any]]]) -> None:
        for table in ("forms", "phonology", "translations", "audio"):
            rows = tiers.get(table, [])
            counts[table] += len(rows)
            if table == "audio":
                durations.extend(
                    float(row["duration"]) for row in rows if row.get("duration") is not None
                )

    def add_archive(archive: zipfile.ZipFile) -> None:
        for name in sorted(item for item in archive.namelist() if item.endswith(".jsonl")):
            with archive.open(name) as stream:
                for line in stream:
                    sentence = json.loads(line)
                    counts["sentences"] += 1
                    text_ids.add(str(sentence["text_id"]))
                    counts["tokens"] += len(sentence["tokens"])
                    add_tiers(sentence["tiers"])
                    for word in sentence["words"]:
                        counts["words"] += 1
                        add_tiers(word["tiers"])
                        for morpheme in word["morphemes"]:
                            counts["morphemes"] += 1
                            add_tiers(morpheme["tiers"])

    packages = sorted((root / "prepared" / "jsonl").glob("*.zip"))
    for path in packages:
        with zipfile.ZipFile(path) as archive:
            add_archive(archive)
    if not packages:
        with zipfile.ZipFile(root / "prepared" / "hierarchical-jsonl.zip") as outer:
            for name in sorted(item for item in outer.namelist() if item.endswith(".zip")):
                with (
                    outer.open(name) as stream,
                    tempfile.TemporaryFile() as temporary,
                ):
                    shutil.copyfileobj(stream, temporary, length=1024 * 1024)
                    temporary.seek(0)
                    with zipfile.ZipFile(temporary) as inner:
                        add_archive(inner)
    counts["texts"] = len(text_ids)
    return counts, math.fsum(durations)


def _canonical_xml(root: Path, source_repo: Path) -> int:
    verified = 0
    for path in sorted((root / "prepared" / "canonical").glob("*.zip")):
        with zipfile.ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            for entry in manifest["files"]:
                relative = str(entry["path"])
                source = source_repo / relative
                if not source.is_file():
                    raise ReconciliationError(f"Canonical source is missing: {relative}")
                with source.open("rb") as original, archive.open(relative) as packaged:
                    source_digest = hashlib.file_digest(original, "sha256").hexdigest()
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: packaged.read(1024 * 1024), b""):
                        digest.update(chunk)
                    archive_digest = digest.hexdigest()
                _require_equal(f"canonical manifest {relative}", source_digest, entry["sha256"])
                _require_equal(f"canonical package {relative}", archive_digest, source_digest)
                verified += 1
    return verified


def reconcile_release(
    root: Path,
    *,
    source_repo: Path | None = None,
    database_output: Path | None = None,
    required_scopes: set[str] | None = None,
    max_artifact_bytes: int | None = None,
    profile: StageProfile | None = None,
) -> dict[str, object]:
    """Validate all primary projections and return a machine-readable report."""
    root = root.resolve()
    profile = profile or StageProfile()
    with tempfile.TemporaryDirectory(prefix="kakarayan-reconcile-") as temporary:
        database = database_output or Path(temporary) / "verified.sqlite"
        try:
            manifest = verify_release(
                root,
                database_output=database,
                required_scopes=required_scopes,
                max_artifact_bytes=max_artifact_bytes,
            )
        except VerificationError as error:
            raise ReconciliationError(str(error)) from error
        profile.mark("checksums_expansion_identity_integrity")
        (
            database_counts,
            samples,
            database_duration,
            hierarchical_expected,
            hierarchical_expected_duration,
            database_digests,
        ) = _database_state(database)
        spreadsheet_samples = _xlsx_samples(database)
        profile.mark("sqlite_semantic_scan")
    _require_equal("release manifest counts", manifest["counts"], database_counts)

    representations: dict[str, dict[str, int]] = {"sqlite": database_counts}
    sample_sets: dict[str, dict[str, dict[str, Any]]] = {}
    duration_totals: dict[str, float] = {"sqlite": database_duration}
    digests: dict[str, dict[str, str]] = {"sqlite": database_digests}
    for name, path, suffix, delimiter in (
        ("csv", root / "prepared" / "csv-tables.zip", "csv", ","),
        ("tsv", root / "prepared" / "tsv-tables.zip", "tsv", "\t"),
    ):
        counts, found, duration, digests[name] = _delimited_archive(
            path,
            suffix,
            delimiter=delimiter,
            samples=samples,
        )
        representations[name] = counts
        sample_sets[name] = found
        duration_totals[name] = duration
        profile.mark(f"reconcile_{name}")
    jsonl_counts, jsonl_samples, jsonl_duration, digests["flat_jsonl"] = _jsonl_archive(
        root / "prepared" / "flat-jsonl-tables.zip",
        samples,
    )
    representations["flat_jsonl"] = jsonl_counts
    sample_sets["flat_jsonl"] = jsonl_samples
    duration_totals["flat_jsonl"] = jsonl_duration
    profile.mark("reconcile_flat_jsonl")
    parquet_counts, parquet_samples, parquet_duration, digests["parquet"] = _parquet_archive(
        root / "prepared" / "parquet-tables.zip",
        samples,
    )
    representations["parquet"] = parquet_counts
    sample_sets["parquet"] = parquet_samples
    duration_totals["parquet"] = parquet_duration
    profile.mark("reconcile_parquet")
    representations["xlsx"] = _xlsx_counts(
        root / "prepared" / "formosanbank.xlsx", spreadsheet_samples
    )
    profile.mark("reconcile_xlsx")
    hierarchical_counts, hierarchical_duration = _hierarchical_counts(root)
    representations["hierarchical_jsonl"] = hierarchical_counts
    duration_totals["hierarchical_jsonl"] = hierarchical_duration
    profile.mark("reconcile_hierarchy")

    for name, values in digests.items():
        _require_equal(f"{name} all-row semantic digests", values, database_digests)

    for name, counts in representations.items():
        if name == "hierarchical_jsonl":
            continue
        _require_equal(f"{name} counts", counts, database_counts)
    _require_equal(
        "hierarchical_jsonl counts",
        representations["hierarchical_jsonl"],
        hierarchical_expected,
    )
    for representation, found in sample_sets.items():
        _require_equal(f"{representation} sampled tables", set(found), set(samples))
        for table, row in found.items():
            _require_equal(f"{representation} sample {table}", row, samples[table])
    for name, value in duration_totals.items():
        expected_duration = (
            hierarchical_expected_duration if name == "hierarchical_jsonl" else database_duration
        )
        if not math.isclose(value, expected_duration, rel_tol=1e-12, abs_tol=1e-6):
            raise ReconciliationError(
                f"{name} duration total differs: expected {expected_duration}, received {value}"
            )

    canonical_files = _canonical_xml(root, source_repo.resolve()) if source_repo else None
    return {
        "release_id": manifest["release_id"],
        "counts": database_counts,
        "duration_seconds": database_duration,
        "representations": sorted(representations),
        "hierarchical_exclusions": [
            "texts with no sentences",
            "text-owned forms",
            "text-owned phonology",
            "text-owned translations",
            "text-owned audio",
        ],
        "sample_ids": {table: row["id"] for table, row in samples.items()},
        "semantic_sha256": database_digests,
        "semantic_formats": sorted(digests),
        "xlsx_samples": "up to 32 evenly spaced rows per table, including first and last",
        "canonical_files_verified": canonical_files,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--source-repo", type=Path)
    parser.add_argument(
        "--database-output", type=Path, help="Retain the verified database for a same-job benchmark"
    )
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--max-artifact-mib", type=int)
    parser.add_argument("--require-publishable-scope", action="append", default=[])
    args = parser.parse_args(argv)
    profile = StageProfile()
    if args.profile and args.profile.resolve().is_relative_to(args.release.resolve()):
        raise ReconciliationError("The profile must be outside the immutable release")
    result = reconcile_release(
        args.release,
        source_repo=args.source_repo,
        database_output=args.database_output,
        required_scopes=set(args.require_publishable_scope),
        max_artifact_bytes=args.max_artifact_mib * 1024**2 if args.max_artifact_mib else None,
        profile=profile,
    )
    if args.profile:
        profile.write(args.profile, release_id=result["release_id"])
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReconciliationError as error:
        raise SystemExit(f"reconciliation failed: {error}") from error
