"""Deterministic static API and core artifact builder."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
from collections.abc import Mapping
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from api.contracts import READ_MODEL_VERSION
from publisher import API_VERSION, APPLICATION_VERSION, PUBLIC_DOWNLOAD_PATHS, SCHEMA_VERSION
from publisher.archive import directory_entries, write_zip
from publisher.audio_sources import load_audio_sources
from publisher.languages import language_rows
from publisher.model_catalog import configured_model_catalog
from publisher.orthography import build_orthography_catalog
from publisher.prepared import build_prepared_formats
from publisher.profiling import StageProfile
from publisher.read_model import (
    add_indexes,
    add_publication_metadata,
    add_summary_cache,
    corpus_licenses,
    create_database,
    insert_projection,
    record_counts,
    scope_counts,
)
from publisher.rights import build_rights_catalog
from publisher.tables import TABLE_COLUMNS, delimited_cell
from publisher.xml_records import Projection, discover_xml, project_xml

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_API_BASE = "https://formosanbank.github.io/kakarayan/api/v1"
_APPLICATION_REPOSITORY = "FormosanBank/kakarayan"


class BuildError(RuntimeError):
    """Raised when a publication invariant fails."""


@dataclass(frozen=True)
class Source:
    repository: str
    commit: str
    committed_at: str


@dataclass(frozen=True)
class BuildResult:
    release_id: str
    output: Path
    source: Source
    counts: dict[str, int]
    warnings: tuple[str, ...]


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise BuildError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def inspect_source(repo: Path, expected_commit: str | None = None) -> Source:
    """Verify that a local checkout is the intended clean public source."""
    repo = repo.resolve()
    commit = _git(repo, "rev-parse", "HEAD")
    if not _COMMIT_RE.fullmatch(commit):
        raise BuildError(f"Invalid source commit: {commit!r}")
    if expected_commit and commit != expected_commit:
        raise BuildError(f"Source is at {commit}, expected {expected_commit}")
    tracked_changes = _git(repo, "status", "--porcelain", "--untracked-files=no")
    if tracked_changes:
        raise BuildError("Source checkout has tracked changes; publication requires a clean tree")
    remote = _git(repo, "remote", "get-url", "origin")
    normalized_remote = remote.removesuffix(".git")
    if not normalized_remote.endswith("FormosanBank/FormosanBank"):
        raise BuildError(f"Unexpected source remote: {remote}")
    committed_at = _git(repo, "show", "-s", "--format=%cI", commit)
    return Source(
        repository="FormosanBank/FormosanBank",
        commit=commit,
        committed_at=committed_at,
    )


def inspect_application_commit(expected_commit: str | None = None) -> str:
    """Resolve the exact Kakarayan revision that produced publication bytes."""
    repository = Path(__file__).resolve().parents[1]
    head = _git(repository, "rev-parse", "HEAD").lower()
    commit = (
        expected_commit
        or os.environ.get("KAKARAYAN_COMMIT")
        or os.environ.get("GITHUB_SHA")
        or head
    ).lower()
    if not _COMMIT_RE.fullmatch(commit):
        raise BuildError(f"Invalid Kakarayan commit: {commit!r}")
    if commit != head:
        raise BuildError(f"Kakarayan HEAD {head} does not match expected commit {commit}")
    return commit


def _api_envelope(
    endpoint: str,
    data: object,
    *,
    release_id: str,
    generated_at: str,
    source: Source,
    application_commit: str,
) -> dict[str, object]:
    path = f"{endpoint}.json"
    return {
        "schema_version": SCHEMA_VERSION,
        "api_version": API_VERSION,
        "read_model_version": READ_MODEL_VERSION,
        "endpoint": endpoint,
        "generated_at": generated_at,
        "kakarayan": {
            "repository": _APPLICATION_REPOSITORY,
            "version": APPLICATION_VERSION,
            "commit": application_commit,
        },
        "source": {"repository": source.repository, "commit": source.commit},
        "release_id": release_id,
        "canonical_url": f"{_API_BASE}/{path}",
        "data": data,
    }


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(UTC)


def _release_id(source: Source, application_commit: str) -> str:
    date = _timestamp(source.committed_at).strftime("%Y%m%d")
    return f"fb-{date}-{source.commit[:6]}{application_commit[:6]}"


def _json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_json_bytes(value))


def _prepare_output(output: Path) -> None:
    if output.exists() and any(output.iterdir()):
        raise BuildError(f"Output directory must be absent or empty: {output}")
    output.mkdir(parents=True, exist_ok=True)


def _write_projection(projection: Projection, csv_writers: dict[str, csv.DictWriter]) -> None:
    for table, rows in projection.rows.items():
        columns = TABLE_COLUMNS[table]
        for row in rows:
            csv_writers[table].writerow(
                {column: delimited_cell(row.get(column)) for column in columns}
            )


def _validate_sqlite(connection: sqlite3.Connection) -> None:
    result = connection.execute("PRAGMA integrity_check").fetchone()
    if result != ("ok",):
        raise BuildError(f"SQLite integrity check failed: {result}")


def _build_catalog(
    connection: sqlite3.Connection,
    *,
    source: Source,
    release_id: str,
    generated_at: str,
    application_commit: str,
    rights: dict[str, object],
    language_catalog: list[dict[str, object]],
) -> dict[str, object]:
    corpus_counts, language_counts, corpus_language_counts = scope_counts(connection)
    rights_entries = cast(list[dict[str, object]], rights["entries"])
    rights_by_corpus = {str(entry["corpus"]): str(entry["id"]) for entry in rights_entries}
    corpora = []
    for corpus_id, name in connection.execute(
        "SELECT DISTINCT corpus_id, substr(source_path, 9, instr(substr(source_path, 9), '/') - 1) "
        "FROM texts ORDER BY corpus_id"
    ):
        languages = [
            row[0]
            for row in connection.execute(
                "SELECT DISTINCT language_id FROM texts WHERE corpus_id = ? ORDER BY language_id",
                (corpus_id,),
            )
        ]
        metadata = {}
        variants = {}
        for field in ("citation", "bibtex_citation", "source", "copyright"):
            value, count = connection.execute(
                f"SELECT MAX(NULLIF(\"{field}\", '')), COUNT(DISTINCT NULLIF(\"{field}\", '')) "
                "FROM texts WHERE corpus_id = ?",
                (corpus_id,),
            ).fetchone()
            metadata[field] = value if count == 1 else ""
            variants[field] = count
        corpora.append(
            {
                "id": corpus_id,
                "name": name,
                "source_path": f"Corpora/{name}",
                "languages": languages,
                "rights_id": rights_by_corpus[name],
                "counts": dict(corpus_counts[corpus_id]),
                "language_counts": {
                    language: dict(counts)
                    for language, counts in sorted(corpus_language_counts[corpus_id].items())
                },
                **metadata,
                "metadata_variants": variants,
            }
        )
    languages = language_catalog
    for language in languages:
        counts = dict(language_counts[str(language["id"])])
        language["counts"] = counts
        language["dialects"] = [
            str(row[0])
            for row in connection.execute(
                """
                SELECT DISTINCT dialect
                FROM texts
                WHERE language_id = ? AND dialect != ''
                ORDER BY dialect
                """,
                (language["id"],),
            )
        ]
        if counts.get("audio", 0):
            cast(list[str], language["capabilities"]).append("audio")
    return {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "generated_at": generated_at,
        "kakarayan": {
            "repository": _APPLICATION_REPOSITORY,
            "version": APPLICATION_VERSION,
            "commit": application_commit,
        },
        "source": {"repository": source.repository, "commit": source.commit},
        "languages": languages,
        "corpora": corpora,
        "counts": record_counts(connection),
    }


def _artifact(
    path: Path,
    root: Path,
    *,
    scope: str,
    rights_ids: list[str],
    rights_entries: Mapping[str, Mapping[str, object]],
    content: Mapping[str, object] | None = None,
) -> dict[str, object]:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    blocked_reasons = []
    for rights_id in rights_ids:
        entry = rights_entries[rights_id]
        if entry["review_status"] != "reviewed":
            blocked_reasons.append(f"{rights_id}: rights review required")
        elif entry["redistribution"] != "allowed":
            blocked_reasons.append(f"{rights_id}: redistribution is {entry['redistribution']}")
    artifact = {
        "path": path.relative_to(root).as_posix(),
        "media_type": {
            ".json": "application/json",
            ".jsonl": "application/x-ndjson",
            ".csv": "text/csv",
            ".sqlite": "application/vnd.sqlite3",
            ".parquet": "application/vnd.apache.parquet",
            ".zip": "application/zip",
            ".txt": "text/plain",
            ".sql": "application/sql",
            ".xz": "application/x-xz",
        }.get(path.suffix, "application/octet-stream"),
        "bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "scope": scope,
        "rights_ids": rights_ids,
        "publishable": not blocked_reasons,
        "blocked_reasons": blocked_reasons,
    }
    if content:
        artifact.update(content)
    return artifact


def _artifact_facets(
    relative: str,
    rights_ids: list[str],
    catalog: Mapping[str, object],
) -> dict[str, object]:
    corpus_rows = [
        cast(dict[str, object], corpus) for corpus in cast(list[object], catalog["corpora"])
    ]
    corpora = [corpus for corpus in corpus_rows if corpus["rights_id"] in rights_ids]
    corpus_ids = sorted(str(corpus["id"]) for corpus in corpora)
    language_ids = sorted(
        {
            str(language_id)
            for corpus in corpora
            for language_id in cast(list[object], corpus["languages"])
        }
    )
    name = Path(relative).name
    if relative == "formosanbank.sqlite.xz":
        export_format = "sqlite"
    elif "/canonical/" in relative:
        export_format = "xml"
    elif "cldf" in name:
        export_format = "cldf"
    elif "time-aligned" in name:
        export_format = "aligned"
    elif "parquet" in name:
        export_format = "parquet"
    elif "csv" in name:
        export_format = "csv"
    elif "jsonl" in name or "/jsonl/" in relative:
        export_format = "jsonl"
    elif "text" in name:
        export_format = "text"
    else:
        export_format = "metadata"
    if export_format in {"sqlite", "xml", "csv", "jsonl", "parquet"}:
        tiers = [
            "text",
            "sentence",
            "word",
            "morpheme",
            "form",
            "phonology",
            "translation",
            "audio",
            "token",
        ]
    elif export_format == "cldf":
        tiers = ["language", "sentence", "form", "translation"]
    elif export_format == "aligned":
        tiers = ["sentence", "form", "translation", "audio"]
    elif export_format == "text":
        tiers = ["sentence", "form", "translation", "token"]
    else:
        tiers = ["metadata", "audio"]
    return {
        "format": export_format,
        "language_ids": language_ids,
        "corpus_ids": corpus_ids,
        "tiers": tiers,
    }


def _compress_database(path: Path) -> tuple[Path, dict[str, object]]:
    destination = path.with_suffix(f"{path.suffix}.xz")
    temporary = destination.with_suffix(f"{destination.suffix}.tmp")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    size = path.stat().st_size
    # Multithreaded xz splits fixed 24 MiB blocks, so the bytes do not depend on the
    # thread count. One thread would switch xz to single-block output.
    threads = max(2, os.cpu_count() or 2)
    with temporary.open("wb") as output:
        subprocess.run(
            ["xz", "-6", f"--threads={threads}", "--block-size=24MiB", "--stdout", str(path)],
            stdout=output,
            check=True,
        )
    temporary.replace(destination)
    path.unlink()
    return destination, {
        "compression": "xz",
        "content_media_type": "application/vnd.sqlite3",
        "content_bytes": size,
        "content_sha256": digest.hexdigest(),
    }


def validate_document(document: dict[str, object], schema_path: Path) -> None:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    registry = Registry()
    for candidate in schema_path.parent.glob("*.schema.json"):
        candidate_schema = json.loads(candidate.read_text(encoding="utf-8"))
        registry = registry.with_resource(
            candidate_schema["$id"], Resource.from_contents(candidate_schema)
        )
    Draft202012Validator(schema, registry=registry, format_checker=FormatChecker()).validate(
        document
    )


def build_release(
    repo: Path,
    output: Path,
    *,
    expected_commit: str | None = None,
    schemas: Path | None = None,
    rights_overrides: Path | None = None,
    model_catalog: dict[str, object] | None = None,
    include_prepared: bool = True,
    compress_database: bool = False,
    release_only: bool = False,
    application_commit: str | None = None,
    profile: StageProfile | None = None,
) -> BuildResult:
    """Build deterministic core tables, SQLite, catalogue, and static API."""
    if release_only and (not include_prepared or not compress_database):
        raise BuildError("A release-only build requires prepared formats and a compressed database")
    profile = profile or StageProfile()
    repo = repo.resolve()
    source = inspect_source(repo, expected_commit)
    kakarayan_commit = inspect_application_commit(application_commit)
    output = output.resolve()
    _prepare_output(output)
    schema_dir = schemas or Path(__file__).resolve().parents[1] / "schemas"
    release_id = _release_id(source, kakarayan_commit)
    generated_at = _timestamp(source.committed_at).isoformat().replace("+00:00", "Z")
    xml_paths = list(discover_xml(repo))
    audio_sources = load_audio_sources(repo)
    corpus_names = sorted({path.relative_to(repo).parts[1] for path in xml_paths})
    models = model_catalog or configured_model_catalog(generated_at)
    models = {**models, "generated_at": generated_at}
    validate_document(models, schema_dir / "model-catalog.schema.json")
    orthography = build_orthography_catalog(repo, source.commit)
    content_path = Path(__file__).resolve().parents[1] / "content" / "manifest.json"
    content = cast(dict[str, object], json.loads(content_path.read_text(encoding="utf-8")))
    profile.mark(
        "inputs",
        xml_files=len(xml_paths),
        largest_xml_bytes=max((path.stat().st_size for path in xml_paths), default=0),
    )

    tables_dir = output / "tables"
    tables_dir.mkdir()
    sqlite_path = output / "formosanbank.sqlite"
    connection = create_database(sqlite_path)
    warnings: list[str] = []
    try:
        with ExitStack() as stack:
            csv_files = {
                table: stack.enter_context(
                    (tables_dir / f"{table}.csv").open("w", encoding="utf-8", newline="")
                )
                for table in TABLE_COLUMNS
            }
            csv_writers = {
                table: csv.DictWriter(stream, fieldnames=TABLE_COLUMNS[table])
                for table, stream in csv_files.items()
            }
            for writer in csv_writers.values():
                writer.writeheader()
            for path in xml_paths:
                projection = project_xml(path, repo, audio_sources)
                insert_projection(connection, projection)
                _write_projection(projection, csv_writers)
                warnings.extend(
                    f"{projection.source_path}: {warning}" for warning in projection.warnings
                )
        profile.mark("parse_and_core_serialization")
        add_indexes(connection)
        profile.mark("indexes")
        add_summary_cache(connection)
        connection.commit()
        profile.mark("summary_materialization")
        rights = build_rights_catalog(
            corpus_names,
            licenses=corpus_licenses(connection),
            overrides_path=rights_overrides,
        )
        catalog = _build_catalog(
            connection,
            source=source,
            release_id=release_id,
            generated_at=generated_at,
            application_commit=kakarayan_commit,
            rights=rights,
            language_catalog=language_rows(repo),
        )
        meta = _api_envelope(
            "meta",
            {"current_release": release_id},
            release_id=release_id,
            generated_at=generated_at,
            source=source,
            application_commit=kakarayan_commit,
        )
        add_publication_metadata(
            connection,
            {
                "meta": meta,
                "languages": catalog["languages"],
                "corpora": catalog["corpora"],
                "rights": rights,
                "models": models,
                "orthography": orthography,
                "content": content,
            },
        )
        connection.commit()
        profile.mark("catalogues")
        _validate_sqlite(connection)
        profile.mark("integrity", database_bytes=sqlite_path.stat().st_size)
    finally:
        connection.close()

    api = output / "api" / "v1"
    api_payloads: dict[str, object] = {
        "meta": {"current_release": release_id},
        "languages": catalog["languages"],
        "corpora": catalog["corpora"],
        "rights": rights,
        "models": models,
        "orthography": orthography,
        "content": content,
    }
    api_documents = {
        endpoint: _api_envelope(
            endpoint,
            data,
            release_id=release_id,
            generated_at=generated_at,
            source=source,
            application_commit=kakarayan_commit,
        )
        for endpoint, data in api_payloads.items()
    }
    for endpoint, document in api_documents.items():
        _write_json(api / f"{endpoint}.json", document)
        validate_document(document, schema_dir / "static-api.schema.json")
    _write_json(output / "catalog.json", catalog)
    _write_json(output / "rights.json", rights)
    _write_json(output / "models.json", models)
    _write_json(output / "orthography.json", orthography)

    validate_document(catalog, schema_dir / "catalog.schema.json")
    validate_document(rights, schema_dir / "rights.schema.json")
    validate_document(orthography, schema_dir / "orthography.schema.json")
    validate_document(content, schema_dir / "content.schema.json")

    if include_prepared:
        prepared_rights, prepared_summary = build_prepared_formats(
            repo=repo,
            output=output,
            database=sqlite_path,
            release_id=release_id,
            source_commit=source.commit,
            rights=rights,
            compact_release=release_only,
            profile=profile,
        )
    else:
        prepared_rights = {}
        prepared_summary = {
            "cldf": {},
            "aligned": {},
            "canonical_packages": 0,
        }
    artifact_content: dict[str, dict[str, object]] = {}
    if compress_database:
        compressed_database, content = _compress_database(sqlite_path)
        artifact_content[compressed_database.relative_to(output).as_posix()] = content
        profile.mark("database_compression", compressed_bytes=compressed_database.stat().st_size)
    if release_only:
        write_zip(output / "site-metadata.zip", directory_entries(output / "api"))
        if tables_dir.exists():
            shutil.rmtree(tables_dir)
        shutil.rmtree(output / "api")
        for duplicate in ("catalog.json", "models.json", "orthography.json", "rights.json"):
            (output / duplicate).unlink()
    rights_rows = cast(list[dict[str, object]], rights["entries"])
    rights_ids = [str(entry["id"]) for entry in rights_rows]
    rights_by_id: dict[str, Mapping[str, object]] = {
        str(entry["id"]): entry for entry in rights_rows
    }
    artifact_paths = sorted(
        [
            path
            for path in output.rglob("*")
            if path.is_file() and path.name not in {"release-manifest.json", "SHA256SUMS"}
        ],
        key=lambda path: path.relative_to(output).as_posix(),
    )
    artifacts = []
    for path in artifact_paths:
        relative = path.relative_to(output).as_posix()
        artifact_rights = prepared_rights.get(relative, rights_ids)
        scope = (
            "prepared-download"
            if relative.startswith("prepared/")
            else "site-metadata"
            if relative.startswith("api/") or relative == "site-metadata.zip"
            else "release-core"
        )
        artifact = _artifact(
            path,
            output,
            scope=scope,
            rights_ids=artifact_rights,
            rights_entries=rights_by_id,
            content=artifact_content.get(relative),
        )
        if scope in {"prepared-download", "release-core"}:
            artifact.update(_artifact_facets(relative, artifact_rights, catalog))
        artifacts.append(artifact)
    if release_only:
        asset_names: set[str] = set()
        for artifact in artifacts:
            asset_name = Path(str(artifact["path"])).name
            if asset_name in asset_names:
                raise BuildError(f"GitHub Release asset name is not unique: {asset_name}")
            asset_names.add(asset_name)
            artifact["asset_name"] = asset_name
            artifact["download_url"] = (
                "https://github.com/FormosanBank/kakarayan/releases/download/"
                f"data-{release_id}/{asset_name}"
            )
    prepared_artifacts = [
        {
            **{key: value for key, value in artifact.items() if key != "asset_name"},
            "download_url": (
                str(artifact["download_url"])
                if "download_url" in artifact
                else "https://github.com/FormosanBank/kakarayan/releases/download/"
                f"data-{release_id}/{Path(str(artifact['path'])).name}"
            ),
        }
        for artifact in artifacts
        if str(artifact["path"]) in PUBLIC_DOWNLOAD_PATHS
    ]
    downloads: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "artifacts": prepared_artifacts,
    }
    releases = {
        "schema_version": SCHEMA_VERSION,
        "current": release_id,
        "releases": [
            {
                "id": release_id,
                "source_commit": source.commit,
                "generated_at": generated_at,
                "manifest": "data/release-manifest.json",
            }
        ],
    }
    if not release_only:
        for endpoint, data in (("downloads", downloads), ("releases", releases)):
            document = _api_envelope(
                endpoint,
                data,
                release_id=release_id,
                generated_at=generated_at,
                source=source,
                application_commit=kakarayan_commit,
            )
            _write_json(api / f"{endpoint}.json", document)
            validate_document(document, schema_dir / "static-api.schema.json")
        for path in (api / "downloads.json", api / "releases.json"):
            artifacts.append(
                _artifact(
                    path,
                    output,
                    scope="site-metadata",
                    rights_ids=rights_ids,
                    rights_entries=rights_by_id,
                )
            )
    artifacts.sort(key=lambda artifact: str(artifact["path"]))
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "read_model_version": READ_MODEL_VERSION,
        "release_id": release_id,
        "generated_at": generated_at,
        "kakarayan": {
            "repository": _APPLICATION_REPOSITORY,
            "version": APPLICATION_VERSION,
            "commit": kakarayan_commit,
        },
        "source": {"repository": source.repository, "commit": source.commit},
        "counts": catalog["counts"],
        "formats": prepared_summary,
        "artifacts": artifacts,
    }
    _write_json(output / "release-manifest.json", manifest)
    validate_document(downloads, schema_dir / "downloads.schema.json")
    validate_document(manifest, schema_dir / "release-manifest.schema.json")
    checksum_lines = [f"{artifact['sha256']}  {artifact['path']}" for artifact in artifacts]
    checksum_lines.append(
        f"{hashlib.sha256((output / 'release-manifest.json').read_bytes()).hexdigest()}"
        "  release-manifest.json"
    )
    (output / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    profile.mark(
        "manifest_and_checksums",
        output_bytes=sum(path.stat().st_size for path in output.rglob("*") if path.is_file()),
    )
    return BuildResult(
        release_id=release_id,
        output=output,
        source=source,
        counts={
            str(key): int(value) for key, value in cast(dict[str, Any], catalog["counts"]).items()
        },
        warnings=tuple(warnings),
    )
