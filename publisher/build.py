"""Deterministic static API and core artifact builder."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
import subprocess
from collections import Counter, defaultdict
from collections.abc import Mapping
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TextIO, cast

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from publisher import SCHEMA_VERSION
from publisher.languages import language_rows
from publisher.rights import build_rights_catalog
from publisher.tables import TABLE_COLUMNS, sqlite_type
from publisher.xml_records import Projection, discover_xml, project_xml

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


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


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(UTC)


def _release_id(source: Source) -> str:
    date = _timestamp(source.committed_at).strftime("%Y%m%d")
    return f"fb-{date}-{source.commit[:8]}"


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


def _create_sqlite(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=DELETE")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("PRAGMA foreign_keys=OFF")
    for table, columns in TABLE_COLUMNS.items():
        definitions = ", ".join(f'"{column}" {sqlite_type(column)}' for column in columns)
        connection.execute(f'CREATE TABLE "{table}" ({definitions})')
    return connection


def _insert_projection(connection: sqlite3.Connection, projection: Projection) -> None:
    for table, rows in projection.rows.items():
        columns = TABLE_COLUMNS[table]
        placeholders = ",".join("?" for _ in columns)
        column_sql = ",".join(f'"{column}"' for column in columns)
        values = []
        for row in rows:
            values.append(
                tuple(
                    int(value) if isinstance(value, bool) else value
                    for value in (row.get(column) for column in columns)
                )
            )
        if values:
            connection.executemany(
                f'INSERT INTO "{table}" ({column_sql}) VALUES ({placeholders})', values
            )


def _write_projection(
    projection: Projection,
    csv_writers: dict[str, csv.DictWriter],
    jsonl_files: Mapping[str, TextIO],
) -> None:
    for table, rows in projection.rows.items():
        columns = TABLE_COLUMNS[table]
        for row in rows:
            csv_writers[table].writerow({column: row.get(column) for column in columns})
            jsonl_files[table].write(
                json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
            )


def _add_indexes(connection: sqlite3.Connection) -> None:
    statements = (
        "CREATE UNIQUE INDEX texts_id ON texts(id)",
        "CREATE INDEX texts_scope ON texts(corpus_id, language_id, dialect)",
        "CREATE UNIQUE INDEX sentences_id ON sentences(id)",
        "CREATE INDEX sentences_parent ON sentences(parent_id, position)",
        "CREATE UNIQUE INDEX words_id ON words(id)",
        "CREATE INDEX words_parent ON words(parent_id, position)",
        "CREATE UNIQUE INDEX morphemes_id ON morphemes(id)",
        "CREATE INDEX morphemes_parent ON morphemes(parent_id, position)",
        "CREATE INDEX forms_owner ON forms(owner_type, owner_id, position)",
        "CREATE INDEX forms_normalized ON forms(normalized)",
        "CREATE INDEX phonology_owner ON phonology(owner_type, owner_id, position)",
        "CREATE INDEX translations_owner ON translations(owner_type, owner_id, position)",
        "CREATE INDEX translations_normalized ON translations(normalized)",
        "CREATE INDEX audio_owner ON audio(owner_type, owner_id, position)",
        "CREATE INDEX tokens_normalized ON tokens(normalized)",
        "CREATE INDEX tokens_sentence ON tokens(sentence_id, position)",
    )
    for statement in statements:
        connection.execute(statement)


def _validate_sqlite(connection: sqlite3.Connection) -> None:
    result = connection.execute("PRAGMA integrity_check").fetchone()
    if result != ("ok",):
        raise BuildError(f"SQLite integrity check failed: {result}")


def _record_counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        for table in TABLE_COLUMNS
    }


def _scope_counts(
    connection: sqlite3.Connection,
) -> tuple[dict[str, Counter[str]], dict[str, Counter[str]]]:
    corpus: dict[str, Counter[str]] = defaultdict(Counter)
    language: dict[str, Counter[str]] = defaultdict(Counter)
    text_scope = {
        row[0]: (row[1], row[2])
        for row in connection.execute("SELECT id, corpus_id, language_id FROM texts")
    }
    sentence_scope: dict[str, tuple[str, str]] = {}
    word_scope: dict[str, tuple[str, str]] = {}
    morpheme_scope: dict[str, tuple[str, str]] = {}
    for sentence_id, text_id in connection.execute("SELECT id, parent_id FROM sentences"):
        sentence_scope[sentence_id] = text_scope[text_id]
    for word_id, sentence_id in connection.execute("SELECT id, parent_id FROM words"):
        word_scope[word_id] = sentence_scope[sentence_id]
    for morpheme_id, word_id in connection.execute("SELECT id, parent_id FROM morphemes"):
        morpheme_scope[morpheme_id] = word_scope[word_id]
    scopes = {
        "text": text_scope,
        "sentence": sentence_scope,
        "word": word_scope,
        "morpheme": morpheme_scope,
    }
    for table, owner_type in (
        ("texts", "text"),
        ("sentences", "sentence"),
        ("words", "word"),
        ("morphemes", "morpheme"),
    ):
        for record_id_value in scopes[owner_type]:
            corpus_id, language_id = scopes[owner_type][record_id_value]
            corpus[corpus_id][table] += 1
            language[language_id][table] += 1
    for table in ("forms", "phonology", "translations", "audio"):
        for owner_type, owner_id in connection.execute(
            f'SELECT owner_type, owner_id FROM "{table}"'
        ):
            scope = scopes.get(owner_type, {}).get(owner_id)
            if scope:
                corpus[scope[0]][table] += 1
                language[scope[1]][table] += 1
    for sentence_id in connection.execute("SELECT sentence_id FROM tokens"):
        scope = sentence_scope[sentence_id[0]]
        corpus[scope[0]]["tokens"] += 1
        language[scope[1]]["tokens"] += 1
    return corpus, language


def _build_catalog(
    connection: sqlite3.Connection,
    *,
    source: Source,
    release_id: str,
    generated_at: str,
    rights: dict[str, object],
) -> dict[str, object]:
    corpus_counts, language_counts = _scope_counts(connection)
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
        corpora.append(
            {
                "id": corpus_id,
                "name": name,
                "source_path": f"Corpora/{name}",
                "languages": languages,
                "rights_id": rights_by_corpus[name],
                "counts": dict(corpus_counts[corpus_id]),
            }
        )
    languages = language_rows()
    for language in languages:
        counts = dict(language_counts[str(language["id"])])
        language["counts"] = counts
        if counts.get("audio", 0):
            cast(list[str], language["capabilities"]).append("audio")
    return {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "generated_at": generated_at,
        "source": {"repository": source.repository, "commit": source.commit},
        "languages": languages,
        "corpora": corpora,
        "counts": _record_counts(connection),
    }


def _write_search_records(connection: sqlite3.Connection, path: Path) -> None:
    """Write a portable sentence-level search projection for fixture and small builds."""
    path.parent.mkdir(parents=True, exist_ok=True)
    query = """
        SELECT
          s.id,
          t.corpus_id,
          t.language_id,
          t.dialect,
          t.source_path,
          s.xml_id,
          COALESCE((
            SELECT text FROM forms
            WHERE owner_type = 'sentence' AND owner_id = s.id AND kind = 'standard'
            ORDER BY position LIMIT 1
          ), ''),
          COALESCE((
            SELECT text FROM forms
            WHERE owner_type = 'sentence' AND owner_id = s.id AND kind = 'original'
            ORDER BY position LIMIT 1
          ), '')
        FROM sentences s
        JOIN texts t ON t.id = s.parent_id
        ORDER BY t.source_path, s.position
    """
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in connection.execute(query):
            translations = [
                {"text": item[0], "xml_lang": item[1], "kind": item[2], "version": item[3]}
                for item in connection.execute(
                    "SELECT text, xml_lang, kind, version FROM translations "
                    "WHERE owner_type = 'sentence' AND owner_id = ? ORDER BY position",
                    (row[0],),
                )
            ]
            tokens = [
                {"surface": item[0], "normalized": item[1], "position": item[2]}
                for item in connection.execute(
                    "SELECT surface, normalized, position FROM tokens "
                    "WHERE sentence_id = ? ORDER BY position",
                    (row[0],),
                )
            ]
            value = {
                "id": row[0],
                "corpus_id": row[1],
                "language_id": row[2],
                "dialect": row[3],
                "source_path": row[4],
                "xml_id": row[5],
                "standard": row[6],
                "original": row[7],
                "translations": translations,
                "tokens": tokens,
            }
            stream.write(
                json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
            )


def _artifact(path: Path, root: Path, *, scope: str, rights_ids: list[str]) -> dict[str, object]:
    data = path.read_bytes()
    return {
        "path": path.relative_to(root).as_posix(),
        "media_type": {
            ".json": "application/json",
            ".jsonl": "application/x-ndjson",
            ".csv": "text/csv",
            ".sqlite": "application/vnd.sqlite3",
        }.get(path.suffix, "application/octet-stream"),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "scope": scope,
        "rights_ids": rights_ids,
    }


def _validate(document: dict[str, object], schema_path: Path) -> None:
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
) -> BuildResult:
    """Build deterministic core tables, SQLite, catalogue, and static API."""
    source = inspect_source(repo, expected_commit)
    output = output.resolve()
    _prepare_output(output)
    schema_dir = schemas or Path(__file__).resolve().parents[1] / "schemas"
    release_id = _release_id(source)
    generated_at = _timestamp(source.committed_at).isoformat().replace("+00:00", "Z")
    xml_paths = list(discover_xml(repo))
    corpus_names = sorted({path.relative_to(repo).parts[1] for path in xml_paths})
    rights = build_rights_catalog(corpus_names, overrides_path=rights_overrides)
    models = model_catalog or {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "provider": "Hugging Face",
        "models": [],
        "services": [],
    }

    tables_dir = output / "tables"
    tables_dir.mkdir()
    sqlite_path = output / "formosanbank.sqlite"
    connection = _create_sqlite(sqlite_path)
    warnings: list[str] = []
    try:
        with ExitStack() as stack:
            csv_files = {
                table: stack.enter_context(
                    (tables_dir / f"{table}.csv").open("w", encoding="utf-8", newline="")
                )
                for table in TABLE_COLUMNS
            }
            jsonl_files = {
                table: stack.enter_context(
                    (tables_dir / f"{table}.jsonl").open("w", encoding="utf-8", newline="\n")
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
                projection = project_xml(path, repo)
                _insert_projection(connection, projection)
                _write_projection(projection, csv_writers, jsonl_files)
                warnings.extend(
                    f"{projection.source_path}: {warning}" for warning in projection.warnings
                )
        _add_indexes(connection)
        connection.commit()
        _validate_sqlite(connection)
        catalog = _build_catalog(
            connection,
            source=source,
            release_id=release_id,
            generated_at=generated_at,
            rights=rights,
        )
        _write_search_records(connection, output / "search" / "sentences.jsonl")
    finally:
        connection.close()

    api = output / "api" / "v1"
    _write_json(
        api / "meta.json",
        {
            "schema_version": SCHEMA_VERSION,
            "release_id": release_id,
            "generated_at": generated_at,
            "source": {"repository": source.repository, "commit": source.commit},
        },
    )
    _write_json(api / "languages.json", catalog["languages"])
    _write_json(api / "corpora.json", catalog["corpora"])
    _write_json(api / "rights.json", rights)
    _write_json(api / "models.json", models)
    _write_json(output / "catalog.json", catalog)
    _write_json(output / "rights.json", rights)
    _write_json(output / "models.json", models)

    _validate(catalog, schema_dir / "catalog.schema.json")
    _validate(rights, schema_dir / "rights.schema.json")
    _validate(models, schema_dir / "model-catalog.schema.json")

    rights_ids = [str(entry["id"]) for entry in cast(list[dict[str, object]], rights["entries"])]
    artifact_paths = sorted(
        [
            path
            for path in output.rglob("*")
            if path.is_file() and path.name not in {"release-manifest.json", "SHA256SUMS"}
        ],
        key=lambda path: path.relative_to(output).as_posix(),
    )
    artifacts = [
        _artifact(path, output, scope="all-public-projected-data", rights_ids=rights_ids)
        for path in artifact_paths
    ]
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "generated_at": generated_at,
        "source": {"repository": source.repository, "commit": source.commit},
        "counts": catalog["counts"],
        "artifacts": artifacts,
    }
    _write_json(output / "release-manifest.json", manifest)
    _validate(manifest, schema_dir / "release-manifest.schema.json")
    checksum_lines = [f"{artifact['sha256']}  {artifact['path']}" for artifact in artifacts]
    checksum_lines.append(
        f"{hashlib.sha256((output / 'release-manifest.json').read_bytes()).hexdigest()}"
        "  release-manifest.json"
    )
    (output / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    return BuildResult(
        release_id=release_id,
        output=output,
        source=source,
        counts={
            str(key): int(value) for key, value in cast(dict[str, Any], catalog["counts"]).items()
        },
        warnings=tuple(warnings),
    )
