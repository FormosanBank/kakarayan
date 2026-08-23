"""Deterministic static API and core artifact builder."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import re
import shutil
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

from publisher import API_VERSION, APPLICATION_VERSION, PUBLIC_DOWNLOAD_PATHS, SCHEMA_VERSION
from publisher.archive import directory_entries, write_zip
from publisher.languages import language_rows
from publisher.model_catalog import configured_model_catalog
from publisher.orthography import build_orthography_catalog
from publisher.prepared import build_prepared_formats
from publisher.rights import build_rights_catalog
from publisher.tables import TABLE_COLUMNS, sqlite_type
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
            csv_writers[table].writerow(
                {
                    column: r"\N" if row.get(column) is None else row.get(column)
                    for column in columns
                }
            )
            jsonl_files[table].write(
                json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
            )


def _add_indexes(connection: sqlite3.Connection) -> None:
    statements = (
        "CREATE UNIQUE INDEX texts_id ON texts(id)",
        "CREATE INDEX texts_scope ON texts(language_id, corpus_id, dialect, source_path, id)",
        "CREATE UNIQUE INDEX sentences_id ON sentences(id)",
        "CREATE INDEX sentences_parent ON sentences(parent_id, position)",
        "CREATE UNIQUE INDEX words_id ON words(id)",
        "CREATE INDEX words_parent ON words(parent_id, position)",
        "CREATE UNIQUE INDEX morphemes_id ON morphemes(id)",
        "CREATE INDEX morphemes_parent ON morphemes(parent_id, position)",
        "CREATE INDEX forms_owner ON forms(owner_type, owner_id, position)",
        "CREATE INDEX forms_normalized ON forms(normalized, owner_type, owner_id, position)",
        "CREATE INDEX phonology_owner ON phonology(owner_type, owner_id, position)",
        "CREATE INDEX translations_owner ON translations(owner_type, owner_id, position)",
        "CREATE INDEX translations_normalized "
        "ON translations(normalized, xml_lang, owner_type, owner_id, position)",
        "CREATE INDEX audio_owner ON audio(owner_type, owner_id, position)",
        "CREATE INDEX tokens_normalized ON tokens(normalized, sentence_id, position, word_id)",
        "CREATE INDEX tokens_sentence ON tokens(sentence_id, position)",
        "CREATE INDEX tokens_word ON tokens(word_id, sentence_id, normalized, position)",
    )
    for statement in statements:
        connection.execute(statement)
    connection.executescript(
        """
        CREATE TABLE tier_scope (
          owner_type TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          sentence_id TEXT NOT NULL,
          PRIMARY KEY (owner_type, owner_id)
        ) WITHOUT ROWID;

        INSERT INTO tier_scope
        SELECT 'sentence', id, id FROM sentences;

        INSERT INTO tier_scope
        SELECT 'word', id, parent_id FROM words;

        INSERT INTO tier_scope
        SELECT 'morpheme', m.id, w.parent_id
        FROM morphemes m JOIN words w ON w.id = m.parent_id;

        CREATE INDEX tier_scope_sentence
        ON tier_scope(sentence_id, owner_type, owner_id);

        CREATE TABLE formosan_sentence_terms (
          language_id TEXT NOT NULL,
          normalized TEXT NOT NULL,
          sentence_id TEXT NOT NULL,
          PRIMARY KEY (language_id, normalized, sentence_id)
        ) WITHOUT ROWID;

        INSERT INTO formosan_sentence_terms
        SELECT t.language_id, tok.normalized, tok.sentence_id
        FROM tokens tok
        JOIN sentences s ON s.id = tok.sentence_id
        JOIN texts t ON t.id = s.parent_id
        WHERE tok.normalized <> ''
        GROUP BY t.language_id, tok.normalized, tok.sentence_id;

        INSERT OR IGNORE INTO formosan_sentence_terms
        SELECT t.language_id, f.normalized, ts.sentence_id
        FROM forms f
        JOIN tier_scope ts
          ON ts.owner_type = f.owner_type AND ts.owner_id = f.owner_id
        JOIN sentences s ON s.id = ts.sentence_id
        JOIN texts t ON t.id = s.parent_id
        WHERE f.normalized <> ''
        GROUP BY t.language_id, f.normalized, ts.sentence_id;

        CREATE TABLE translation_sentence_terms (
          language_id TEXT NOT NULL,
          xml_lang TEXT NOT NULL,
          normalized TEXT NOT NULL,
          sentence_id TEXT NOT NULL,
          PRIMARY KEY (language_id, xml_lang, normalized, sentence_id)
        ) WITHOUT ROWID;

        INSERT INTO translation_sentence_terms
        SELECT t.language_id, tr.xml_lang, tr.normalized, ts.sentence_id
        FROM translations tr
        JOIN tier_scope ts
          ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
        JOIN sentences s ON s.id = ts.sentence_id
        JOIN texts t ON t.id = s.parent_id
        WHERE tr.normalized <> ''
        GROUP BY t.language_id, tr.xml_lang, tr.normalized, ts.sentence_id;

        CREATE TABLE reverse_dictionary_terms (
          language_id TEXT NOT NULL,
          xml_lang TEXT NOT NULL,
          normalized TEXT NOT NULL,
          corpus_id TEXT NOT NULL,
          dialect TEXT NOT NULL,
          headword TEXT NOT NULL,
          display_form TEXT NOT NULL,
          occurrences INTEGER NOT NULL,
          PRIMARY KEY (
            language_id, xml_lang, normalized, corpus_id, dialect, headword, display_form
          )
        ) WITHOUT ROWID;

        INSERT INTO reverse_dictionary_terms
        WITH candidates AS (
          SELECT t.language_id, tr.xml_lang, tr.normalized, t.corpus_id, t.dialect,
                 f.normalized AS headword, f.text AS display_form
          FROM translations tr
          JOIN tier_scope ts
            ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
          JOIN sentences s ON s.id = ts.sentence_id
          JOIN texts t ON t.id = s.parent_id
          JOIN forms f
            ON f.owner_type = tr.owner_type AND f.owner_id = tr.owner_id
          WHERE tr.owner_type <> 'sentence' AND tr.normalized <> '' AND f.normalized <> ''
          UNION ALL
          SELECT t.language_id, tr.xml_lang, tr.normalized, t.corpus_id, t.dialect,
                 tok.normalized AS headword, tok.surface AS display_form
          FROM translations tr
          JOIN tier_scope ts
            ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
          JOIN sentences s ON s.id = ts.sentence_id
          JOIN texts t ON t.id = s.parent_id
          JOIN tokens tok ON tr.owner_type = 'word' AND tok.word_id = tr.owner_id
          WHERE tr.normalized <> '' AND tok.normalized <> ''
          UNION ALL
          SELECT t.language_id, tr.xml_lang, tr.normalized, t.corpus_id, t.dialect,
                 tok.normalized AS headword, tok.surface AS display_form
          FROM translations tr
          JOIN sentences s
            ON tr.owner_type = 'sentence' AND s.id = tr.owner_id AND s.token_count = 1
          JOIN texts t ON t.id = s.parent_id
          JOIN tokens tok ON tok.sentence_id = s.id
          WHERE tr.normalized <> '' AND tok.normalized <> ''
        )
        SELECT language_id, xml_lang, normalized, corpus_id, dialect,
               headword, display_form, COUNT(*)
        FROM candidates
        GROUP BY language_id, xml_lang, normalized, corpus_id, dialect,
                 headword, display_form;

        CREATE VIEW sentence_view AS
        SELECT
          s.id AS sentence_id,
          s.parent_id AS text_id,
          t.corpus_id,
          t.language_id,
          t.language,
          t.xml_lang,
          t.dialect,
          t.source_path,
          s.xml_id AS source_xml_id,
          s.position AS source_ordinal,
          (
            SELECT text FROM forms
            WHERE owner_type = 'sentence' AND owner_id = s.id AND kind = 'standard'
            ORDER BY position LIMIT 1
          ) AS standard_form,
          (
            SELECT text FROM forms
            WHERE owner_type = 'sentence' AND owner_id = s.id AND kind = 'original'
            ORDER BY position LIMIT 1
          ) AS original_form,
          s.audio_url,
          s.source,
          s.token_count
        FROM sentences s
        JOIN texts t ON t.id = s.parent_id;

        CREATE VIEW concordance_view AS
        SELECT
          tok.id AS token_id,
          tok.sentence_id,
          tok.word_id,
          tok.position,
          tok.surface,
          tok.normalized,
          sv.text_id,
          sv.corpus_id,
          sv.language_id,
          sv.language,
          sv.dialect,
          sv.source_path,
          sv.standard_form,
          sv.original_form
        FROM tokens tok
        JOIN sentence_view sv ON sv.sentence_id = tok.sentence_id;

        CREATE VIEW tier_scope_view AS
        SELECT owner_type, owner_id, sentence_id FROM tier_scope;

        CREATE TABLE formosan_vocabulary(value TEXT PRIMARY KEY NOT NULL);

        INSERT INTO formosan_vocabulary
        SELECT normalized FROM tokens WHERE normalized <> ''
        UNION
        SELECT normalized FROM forms WHERE normalized <> '';

        CREATE VIRTUAL TABLE formosan_vocabulary_fts USING fts5(
          value,
          content='formosan_vocabulary',
          content_rowid='rowid',
          tokenize='trigram'
        );

        INSERT INTO formosan_vocabulary_fts(formosan_vocabulary_fts) VALUES('rebuild');

        CREATE TABLE translation_vocabulary(value TEXT PRIMARY KEY NOT NULL);

        INSERT INTO translation_vocabulary
        SELECT DISTINCT normalized FROM translations WHERE normalized <> '';

        CREATE VIRTUAL TABLE translation_vocabulary_fts USING fts5(
          value,
          content='translation_vocabulary',
          content_rowid='rowid',
          tokenize='trigram'
        );

        INSERT INTO translation_vocabulary_fts(translation_vocabulary_fts) VALUES('rebuild');

        CREATE TABLE dictionary_terms (
          language_id TEXT NOT NULL,
          corpus_id TEXT NOT NULL,
          dialect TEXT NOT NULL,
          headword TEXT NOT NULL,
          display_form TEXT NOT NULL,
          occurrences INTEGER NOT NULL
        );

        INSERT INTO dictionary_terms
        WITH candidates AS (
          SELECT t.language_id, t.corpus_id, t.dialect,
                 tok.normalized AS headword, tok.surface AS display_form
          FROM tokens tok
          JOIN sentences s ON s.id = tok.sentence_id
          JOIN texts t ON t.id = s.parent_id
          WHERE tok.normalized <> ''
          UNION ALL
          SELECT t.language_id, t.corpus_id, t.dialect,
                 f.normalized AS headword, f.text AS display_form
          FROM forms f
          JOIN tier_scope ts
            ON ts.owner_type = f.owner_type AND ts.owner_id = f.owner_id
          JOIN sentences s ON s.id = ts.sentence_id
          JOIN texts t ON t.id = s.parent_id
          WHERE f.owner_type <> 'sentence' AND f.normalized <> ''
        )
        SELECT language_id, corpus_id, dialect, headword, display_form, COUNT(*)
        FROM candidates
        GROUP BY language_id, corpus_id, dialect, headword, display_form;

        CREATE UNIQUE INDEX dictionary_terms_scope
        ON dictionary_terms(language_id, corpus_id, dialect, headword, display_form);

        CREATE INDEX dictionary_terms_lookup
        ON dictionary_terms(language_id, headword, corpus_id, dialect);

        ANALYZE;
        """
    )


def _add_summary_cache(connection: sqlite3.Connection) -> None:
    """Precompute the immutable language and corpus summaries used by the UI."""
    connection.execute(
        "CREATE TABLE summary_cache ("
        "language_id TEXT NOT NULL, corpus_id TEXT NOT NULL, value_json TEXT NOT NULL, "
        "PRIMARY KEY (language_id, corpus_id)) WITHOUT ROWID"
    )
    pairs = [
        (str(row[0]), str(row[1]))
        for row in connection.execute(
            "SELECT DISTINCT language_id, corpus_id FROM texts ORDER BY language_id, corpus_id"
        )
    ]
    scopes = sorted({(language_id, "") for language_id, _ in pairs} | set(pairs))
    for language_id, corpus_id in scopes:
        clauses = ["t.language_id = ?"]
        parameters: list[object] = [language_id]
        if corpus_id:
            clauses.append("t.corpus_id = ?")
            parameters.append(corpus_id)
        where = " AND ".join(clauses)
        sentence_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM sentences s JOIN texts t ON t.id = s.parent_id "
                f"WHERE {where}",
                parameters,
            ).fetchone()[0]
        )
        token_count, source_types, normalized_types = connection.execute(
            "SELECT COUNT(*), COUNT(DISTINCT tok.surface), COUNT(DISTINCT tok.normalized) "
            "FROM tokens tok JOIN sentences s ON s.id = tok.sentence_id "
            f"JOIN texts t ON t.id = s.parent_id WHERE {where}",
            parameters,
        ).fetchone()
        source = [
            {"value": str(row[0]), "count": int(row[1])}
            for row in connection.execute(
                "SELECT tok.surface, COUNT(*) AS count FROM tokens tok "
                "JOIN sentences s ON s.id = tok.sentence_id "
                f"JOIN texts t ON t.id = s.parent_id WHERE {where} "
                "GROUP BY tok.surface ORDER BY count DESC, tok.surface LIMIT 100",
                parameters,
            )
        ]
        normalized = [
            {"value": str(row[0]), "count": int(row[1])}
            for row in connection.execute(
                "SELECT tok.normalized, COUNT(*) AS count FROM tokens tok "
                "JOIN sentences s ON s.id = tok.sentence_id "
                f"JOIN texts t ON t.id = s.parent_id WHERE {where} "
                "GROUP BY tok.normalized ORDER BY count DESC, tok.normalized LIMIT 100",
                parameters,
            )
        ]
        translations = [
            {"value": str(row[0]), "count": int(row[1])}
            for row in connection.execute(
                "SELECT tr.normalized, COUNT(*) AS count FROM translations tr "
                "JOIN tier_scope ts "
                "ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id "
                "JOIN sentences s ON s.id = ts.sentence_id "
                f"JOIN texts t ON t.id = s.parent_id WHERE {where} AND tr.normalized <> '' "
                "GROUP BY tr.normalized ORDER BY count DESC, tr.normalized LIMIT 100",
                parameters,
            )
        ]
        distributions = [
            {
                "value": f"{row[0]} · {row[1] or 'unknown'}",
                "count": int(row[2]),
            }
            for row in connection.execute(
                "SELECT t.corpus_id, t.dialect, COUNT(*) AS count FROM sentences s "
                f"JOIN texts t ON t.id = s.parent_id WHERE {where} "
                "GROUP BY t.corpus_id, t.dialect "
                "ORDER BY count DESC, t.corpus_id, t.dialect",
                parameters,
            )
        ]
        value = {
            "sentences": sentence_count,
            "tokens": int(token_count),
            "source_types": int(source_types),
            "normalized_types": int(normalized_types),
            "source_frequencies": source,
            "normalized_frequencies": normalized,
            "translation_frequencies": translations,
            "distributions": distributions,
        }
        connection.execute(
            "INSERT INTO summary_cache(language_id, corpus_id, value_json) VALUES (?, ?, ?)",
            (
                language_id,
                corpus_id,
                json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            ),
        )
    connection.executescript(
        """
        CREATE TABLE translation_language_cache (
          language_id TEXT NOT NULL,
          corpus_id TEXT NOT NULL,
          xml_lang TEXT NOT NULL,
          records INTEGER NOT NULL,
          PRIMARY KEY (language_id, corpus_id, xml_lang)
        ) WITHOUT ROWID;

        INSERT INTO translation_language_cache
        WITH scoped AS (
          SELECT t.language_id, t.corpus_id, tr.xml_lang,
                 COUNT(DISTINCT ts.sentence_id) AS records
          FROM translations tr
          JOIN tier_scope ts
            ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
          JOIN sentences s ON s.id = ts.sentence_id
          JOIN texts t ON t.id = s.parent_id
          WHERE tr.xml_lang <> ''
          GROUP BY t.language_id, t.corpus_id, tr.xml_lang
        )
        SELECT language_id, corpus_id, xml_lang, records FROM scoped
        UNION ALL
        SELECT language_id, '', xml_lang, SUM(records)
        FROM scoped GROUP BY language_id, xml_lang;
        """
    )


def _validate_sqlite(connection: sqlite3.Connection) -> None:
    result = connection.execute("PRAGMA integrity_check").fetchone()
    if result != ("ok",):
        raise BuildError(f"SQLite integrity check failed: {result}")


def _add_publication_metadata(
    connection: sqlite3.Connection,
    documents: Mapping[str, object],
) -> None:
    """Embed non-circular release metadata used by the optional live API."""
    connection.execute(
        "CREATE TABLE publication_metadata "
        "(key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL)"
    )
    connection.executemany(
        "INSERT INTO publication_metadata (key, value_json) VALUES (?, ?)",
        [
            (
                key,
                json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            )
            for key, value in sorted(documents.items())
        ],
    )


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
    application_commit: str,
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
        citation, bibtex, source_note, copyright_note, citation_count = connection.execute(
            """
            SELECT
              COALESCE(MAX(NULLIF(citation, '')), ''),
              COALESCE(MAX(NULLIF(bibtex_citation, '')), ''),
              COALESCE(MAX(NULLIF(source, '')), ''),
              COALESCE(MAX(NULLIF(copyright, '')), ''),
              COUNT(DISTINCT NULLIF(citation, ''))
            FROM texts
            WHERE corpus_id = ?
            """,
            (corpus_id,),
        ).fetchone()
        corpora.append(
            {
                "id": corpus_id,
                "name": name,
                "source_path": f"Corpora/{name}",
                "languages": languages,
                "rights_id": rights_by_corpus[name],
                "counts": dict(corpus_counts[corpus_id]),
                "citation": citation,
                "bibtex_citation": bibtex,
                "source": source_note,
                "copyright": copyright_note,
                "citation_count": citation_count,
            }
        )
    languages = language_rows()
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
        "counts": _record_counts(connection),
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
            ".tsv": "text/tab-separated-values",
            ".sqlite": "application/vnd.sqlite3",
            ".parquet": "application/vnd.apache.parquet",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".zip": "application/zip",
            ".txt": "text/plain",
            ".sql": "application/sql",
            ".gz": "application/gzip",
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
    if relative == "formosanbank.sqlite.gz":
        export_format = "sqlite"
    elif "/canonical/" in relative:
        export_format = "xml"
    elif "cldf" in name:
        export_format = "cldf"
    elif "time-aligned" in name:
        export_format = "aligned"
    elif "parquet" in name:
        export_format = "parquet"
    elif name.endswith(".xlsx"):
        export_format = "xlsx"
    elif "tsv" in name:
        export_format = "tsv"
    elif "csv" in name:
        export_format = "csv"
    elif "jsonl" in name or "/jsonl/" in relative:
        export_format = "jsonl"
    elif "text" in name:
        export_format = "text"
    else:
        export_format = "metadata"
    if export_format in {"sqlite", "xml", "csv", "tsv", "jsonl", "parquet", "xlsx"}:
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
    destination = path.with_suffix(f"{path.suffix}.gz")
    temporary = destination.with_suffix(f"{destination.suffix}.tmp")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source, temporary.open("wb") as raw_output:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            compresslevel=6,
            fileobj=raw_output,
            mtime=0,
        ) as output:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
                output.write(chunk)
    temporary.replace(destination)
    path.unlink()
    return destination, {
        "compression": "gzip",
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
) -> BuildResult:
    """Build deterministic core tables, SQLite, catalogue, and static API."""
    if release_only and (not include_prepared or not compress_database):
        raise BuildError("A release-only build requires prepared formats and a compressed database")
    repo = repo.resolve()
    source = inspect_source(repo, expected_commit)
    kakarayan_commit = inspect_application_commit(application_commit)
    output = output.resolve()
    _prepare_output(output)
    schema_dir = schemas or Path(__file__).resolve().parents[1] / "schemas"
    release_id = _release_id(source, kakarayan_commit)
    generated_at = _timestamp(source.committed_at).isoformat().replace("+00:00", "Z")
    xml_paths = list(discover_xml(repo))
    corpus_names = sorted({path.relative_to(repo).parts[1] for path in xml_paths})
    rights = build_rights_catalog(corpus_names, overrides_path=rights_overrides)
    models = model_catalog or configured_model_catalog(generated_at)
    models = {**models, "generated_at": generated_at}
    validate_document(models, schema_dir / "model-catalog.schema.json")
    orthography = build_orthography_catalog(repo, source.commit)
    content_path = Path(__file__).resolve().parents[1] / "content" / "manifest.json"
    content = cast(dict[str, object], json.loads(content_path.read_text(encoding="utf-8")))

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
        _add_summary_cache(connection)
        connection.commit()
        _validate_sqlite(connection)
        catalog = _build_catalog(
            connection,
            source=source,
            release_id=release_id,
            generated_at=generated_at,
            application_commit=kakarayan_commit,
            rights=rights,
        )
        meta = _api_envelope(
            "meta",
            {"current_release": release_id},
            release_id=release_id,
            generated_at=generated_at,
            source=source,
            application_commit=kakarayan_commit,
        )
        _add_publication_metadata(
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
        _validate_sqlite(connection)
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
    return BuildResult(
        release_id=release_id,
        output=output,
        source=source,
        counts={
            str(key): int(value) for key, value in cast(dict[str, Any], catalog["counts"]).items()
        },
        warnings=tuple(warnings),
    )
