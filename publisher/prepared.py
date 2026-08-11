"""Build validated prepared packages for common linguistic workflows."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from itertools import chain
from pathlib import Path
from typing import Any, cast

from publisher.archive import directory_entries, write_zip
from publisher.cldf_export import write_cldf_package
from publisher.format_aligned import write_aligned_package
from publisher.format_tabular import (
    data_dictionary,
    write_audio_manifest,
    write_hierarchical_jsonl,
    write_parquet,
    write_plain_text,
    write_tsv,
    write_xlsx,
)
from publisher.release_db import open_release


def _bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def _slug(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "corpus"
    return f"{base}-{hashlib.sha256(value.encode()).hexdigest()[:8]}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_packages(
    repo: Path,
    output: Path,
    *,
    source_commit: str,
    rights: dict[str, object],
) -> dict[str, list[str]]:
    rights_entries = cast(list[dict[str, Any]], rights["entries"])
    rights_by_corpus = {entry["corpus"]: entry for entry in rights_entries}
    assignments: dict[str, list[str]] = {}
    for corpus_dir in sorted((repo / "Corpora").iterdir(), key=lambda item: item.name):
        xml_dir = corpus_dir / "XML"
        if not xml_dir.is_dir():
            continue
        files = sorted(
            (path for path in xml_dir.rglob("*.xml") if path.is_file() and not path.is_symlink()),
            key=lambda item: item.relative_to(repo).as_posix(),
        )
        if not files:
            continue
        entry = rights_by_corpus[corpus_dir.name]
        file_manifest = [
            {
                "path": path.relative_to(repo).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
            for path in files
        ]
        relative = Path("prepared") / "canonical" / f"{_slug(corpus_dir.name)}.zip"
        readme = (
            "Kakarayan canonical FormosanBank XML package\n\n"
            f"Corpus: {corpus_dir.name}\n"
            f"Source commit: {source_commit}\n"
            "XML files are included byte-for-byte with their repository paths preserved. "
            "The attached rights.json and central FormosanBank terms remain controlling. "
            "Do not infer rights from public repository visibility.\n"
        ).encode()
        package_entries: list[tuple[str, bytes | Path]] = [
            (
                path.relative_to(repo).as_posix(),
                path,
            )
            for path in files
        ]
        package_entries.extend(
            [
                ("README.txt", readme),
                ("manifest.json", _bytes({"source_commit": source_commit, "files": file_manifest})),
                (
                    "rights.json",
                    _bytes(
                        {
                            "central_terms": rights["central_terms"],
                            "corpus": entry,
                        }
                    ),
                ),
            ]
        )
        write_zip(output / relative, package_entries)
        assignments[relative.as_posix()] = [str(entry["id"])]
    return assignments


def _sqlite_schema(database: Path) -> str:
    with open_release(database) as connection:
        rows = connection.execute(
            """
            SELECT type, name, sql
            FROM sqlite_schema
            WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
            ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, name
            """
        )
        return "\n\n".join(f"-- {row['type']} {row['name']}\n{row['sql']};" for row in rows) + "\n"


def _package_core_tables(output: Path, metadata: list[tuple[str, Path]]) -> None:
    prepared = output / "prepared"
    tables = output / "tables"
    write_zip(
        prepared / "csv-tables.zip",
        chain(
            ((path.name, path) for path in sorted(tables.glob("*.csv"))),
            metadata,
        ),
    )
    write_zip(
        prepared / "flat-jsonl-tables.zip",
        chain(
            ((path.name, path) for path in sorted(tables.glob("*.jsonl"))),
            metadata,
        ),
    )
    shutil.rmtree(tables)


def _package_directory(
    root: Path,
    destination: Path,
    metadata: list[tuple[str, Path]],
) -> None:
    write_zip(destination, chain(directory_entries(root), metadata))
    shutil.rmtree(root)


def _package_metadata(prepared: Path) -> None:
    entries: list[tuple[str, Path]] = []
    for name, source in _metadata_files(prepared):
        if not source.is_file():
            raise FileNotFoundError(f"Prepared metadata is missing: {name}")
        entries.append((name, source))
    write_zip(prepared / "metadata-and-audio.zip", entries)
    for name, _source in entries:
        (prepared / name).unlink()


def _metadata_files(prepared: Path) -> list[tuple[str, Path]]:
    names = (
        "README.txt",
        "data-dictionary.json",
        "arrow-schema.json",
        "sqlite-schema.sql",
        "audio-manifest.tsv",
        "format-exclusions.json",
        "jsonl-manifest.json",
        "rights.json",
    )
    return [(name, prepared / name) for name in names]


def build_prepared_formats(
    *,
    repo: Path,
    output: Path,
    database: Path,
    release_id: str,
    source_commit: str,
    rights: dict[str, object],
) -> tuple[dict[str, list[str]], dict[str, object]]:
    prepared = output / "prepared"
    tsv = prepared / "tsv"
    parquet = prepared / "parquet"
    text = prepared / "text"
    prepared.mkdir(parents=True, exist_ok=True)

    dictionary = data_dictionary()
    (prepared / "data-dictionary.json").write_bytes(_bytes(dictionary))
    (prepared / "rights.json").write_bytes(_bytes(rights))
    (prepared / "README.txt").write_text(
        "Kakarayan prepared FormosanBank release\n\n"
        f"Release: {release_id}\n"
        f"Source commit: {source_commit}\n\n"
        "Canonical XML is authoritative. Prepared data preserves repeated tiers and stable "
        "source locators. CSV and TSV use \\N for null. XLSX guards formula-like strings. "
        "Parquet uses Zstandard compression and 50,000-row groups. CLDF is a conservative "
        "Generic ExampleTable projection. Time-aligned files contain references, not audio. "
        "Consult rights.json and each corpus notice before reuse.\n",
        encoding="utf-8",
        newline="\n",
    )
    package_metadata = [
        ("README.txt", prepared / "README.txt"),
        ("data-dictionary.json", prepared / "data-dictionary.json"),
        ("rights.json", prepared / "rights.json"),
    ]

    _package_core_tables(output, package_metadata)
    write_tsv(database, tsv)
    _package_directory(tsv, prepared / "tsv-tables.zip", package_metadata)
    arrow_schemas = write_parquet(database, parquet, release_id)
    _package_directory(parquet, prepared / "parquet-tables.zip", package_metadata)
    jsonl_manifest = write_hierarchical_jsonl(
        database,
        prepared / "jsonl",
        release_id,
        package_metadata=package_metadata,
    )
    (prepared / "jsonl-manifest.json").write_bytes(_bytes(jsonl_manifest))
    write_plain_text(database, text)
    _package_directory(text, prepared / "text-exports.zip", package_metadata)
    write_audio_manifest(database, prepared / "audio-manifest.tsv")
    write_xlsx(
        database,
        prepared / "formosanbank.xlsx",
        release_id,
        source_commit,
        rights,
    )
    cldf_counts = write_cldf_package(
        database,
        prepared / "formosanbank-cldf.zip",
        release_id=release_id,
        source_commit=source_commit,
        rights=rights,
    )
    aligned_counts = write_aligned_package(
        database,
        prepared / "time-aligned.zip",
        release_id,
        rights,
    )

    (prepared / "arrow-schema.json").write_bytes(_bytes(arrow_schemas))
    (prepared / "sqlite-schema.sql").write_text(
        _sqlite_schema(database),
        encoding="utf-8",
        newline="\n",
    )
    exclusions = {
        "not_generated": {
            "conllu": "No dependency syntax is asserted by the source.",
            "tei": "No reviewed lossless TEI mapping is defined.",
            "lift": "The source is not consistently a lexical database.",
            "flex": "No validated FLEx project mapping is defined.",
            "toolbox": "No validated Toolbox marker mapping is defined.",
        },
        "cldf": (
            "Generic ExampleTable only. The export does not claim that corpus sentences "
            "form a dictionary, wordlist, or grammar."
        ),
    }
    (prepared / "format-exclusions.json").write_bytes(_bytes(exclusions))

    all_rights_ids = [str(entry["id"]) for entry in cast(list[dict[str, Any]], rights["entries"])]
    assignments = _canonical_packages(
        repo,
        output,
        source_commit=source_commit,
        rights=rights,
    )
    rights_by_corpus = {
        str(entry["corpus"]): str(entry["id"])
        for entry in cast(list[dict[str, Any]], rights["entries"])
    }
    with open_release(database) as connection:
        corpus_rights = {
            str(corpus_id): rights_by_corpus[str(corpus_name)]
            for corpus_id, corpus_name in connection.execute(
                "SELECT DISTINCT corpus_id, "
                "substr(source_path, 9, instr(substr(source_path, 9), '/') - 1) "
                "FROM texts"
            )
        }
    for partition in cast(list[dict[str, Any]], jsonl_manifest["partitions"]):
        assignments[f"prepared/{partition['path']}"] = [corpus_rights[str(partition["corpus_id"])]]
    _package_metadata(prepared)
    for path in prepared.rglob("*"):
        if path.is_file():
            assignments.setdefault(path.relative_to(output).as_posix(), all_rights_ids)
    return assignments, {
        "cldf": cldf_counts,
        "aligned": aligned_counts,
        "canonical_packages": len(
            [path for path in assignments if path.startswith("prepared/canonical/")]
        ),
    }
