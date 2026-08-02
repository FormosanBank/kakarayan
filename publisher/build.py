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
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Mapping
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TextIO, cast

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from publisher import API_VERSION, APPLICATION_VERSION, SCHEMA_VERSION
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
    connection.executescript(
        """
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
        SELECT 'sentence' AS owner_type, s.id AS owner_id, s.id AS sentence_id
        FROM sentences s
        UNION ALL
        SELECT 'word' AS owner_type, w.id AS owner_id, w.parent_id AS sentence_id
        FROM words w
        UNION ALL
        SELECT 'morpheme' AS owner_type, m.id AS owner_id, w.parent_id AS sentence_id
        FROM morphemes m
        JOIN words w ON w.id = m.parent_id;
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


def _search_records(
    connection: sqlite3.Connection,
    rows: list[tuple[object, ...]],
) -> list[dict[str, object]]:
    """Project one bounded shard in bulk instead of issuing queries per sentence."""
    if not rows:
        return []
    records: dict[str, dict[str, object]] = {}
    for row in rows:
        sentence_id = str(row[0])
        records[sentence_id] = {
            "id": sentence_id,
            "text_id": row[1],
            "corpus_id": row[2],
            "language_id": row[3],
            "dialect": row[4],
            "source_path": row[5],
            "xml_id": row[6],
            "standard": row[7],
            "original": row[8],
            "translations": [],
            "tokens": [],
            "forms": [],
            "phonology": [],
            "tier_translations": [],
            "audio": [],
            "words": [],
        }
    sentence_ids = list(records)
    placeholders = ",".join("?" for _ in sentence_ids)

    def tier_rows(table: str, columns: tuple[str, ...]) -> None:
        cursor = connection.execute(
            f"""
            SELECT scope.sentence_id, {", ".join(f"tier.{column}" for column in columns)}
            FROM {table} tier
            JOIN tier_scope_view scope
              ON scope.owner_type = tier.owner_type AND scope.owner_id = tier.owner_id
            WHERE scope.sentence_id IN ({placeholders})
            ORDER BY scope.sentence_id,
                     CASE tier.owner_type
                       WHEN 'sentence' THEN 0 WHEN 'word' THEN 1 ELSE 2
                     END,
                     tier.owner_id, tier.position, tier.id
            """,
            sentence_ids,
        )
        for item in cursor:
            sentence_id = str(item[0])
            value = dict(zip(columns, item[1:], strict=True))
            cast(list[dict[str, object]], records[sentence_id][table]).append(value)

    tier_rows(
        "forms",
        ("owner_type", "owner_id", "position", "text", "unclear", "kind", "notes", "normalized"),
    )
    tier_rows(
        "phonology",
        ("owner_type", "owner_id", "position", "text", "unclear", "kind"),
    )
    translation_columns = (
        "owner_type",
        "owner_id",
        "position",
        "text",
        "unclear",
        "xml_lang",
        "kind",
        "version",
        "notes",
        "normalized",
    )
    cursor = connection.execute(
        f"""
        SELECT scope.sentence_id,
               {", ".join(f"tier.{column}" for column in translation_columns)}
        FROM translations tier
        JOIN tier_scope_view scope
          ON scope.owner_type = tier.owner_type AND scope.owner_id = tier.owner_id
        WHERE scope.sentence_id IN ({placeholders})
        ORDER BY scope.sentence_id,
                 CASE tier.owner_type WHEN 'sentence' THEN 0 WHEN 'word' THEN 1 ELSE 2 END,
                 tier.owner_id, tier.position, tier.id
        """,
        sentence_ids,
    )
    for item in cursor:
        sentence_id = str(item[0])
        value = dict(zip(translation_columns, item[1:], strict=True))
        cast(list[dict[str, object]], records[sentence_id]["tier_translations"]).append(value)
        if value["owner_type"] == "sentence":
            cast(list[dict[str, object]], records[sentence_id]["translations"]).append(
                {
                    "text": value["text"],
                    "xml_lang": value["xml_lang"],
                    "kind": value["kind"],
                    "version": value["version"],
                }
            )

    audio_columns = (
        "owner_type",
        "owner_id",
        "position",
        "file",
        "url",
        "start",
        "end",
        "source",
        "duration",
        "availability_status",
    )
    cursor = connection.execute(
        f"""
        SELECT scope.sentence_id, {", ".join(f"tier.{column}" for column in audio_columns)}
        FROM audio tier
        JOIN tier_scope_view scope
          ON scope.owner_type = tier.owner_type AND scope.owner_id = tier.owner_id
        WHERE scope.sentence_id IN ({placeholders})
        ORDER BY scope.sentence_id,
                 CASE tier.owner_type WHEN 'sentence' THEN 0 WHEN 'word' THEN 1 ELSE 2 END,
                 tier.owner_id, tier.position, tier.id
        """,
        sentence_ids,
    )
    for item in cursor:
        sentence_id = str(item[0])
        value = dict(zip(audio_columns, item[1:], strict=True))
        cast(list[dict[str, object]], records[sentence_id]["audio"]).append(value)

    cursor = connection.execute(
        f"""
        SELECT sentence_id, surface, normalized, position, word_id
        FROM tokens
        WHERE sentence_id IN ({placeholders})
        ORDER BY sentence_id, position, id
        """,
        sentence_ids,
    )
    for sentence_id, surface, normalized, position, word_id in cursor:
        cast(list[dict[str, object]], records[str(sentence_id)]["tokens"]).append(
            {
                "surface": surface,
                "normalized": normalized,
                "position": position,
                "word_id": word_id,
            }
        )

    words_by_id: dict[str, dict[str, object]] = {}
    cursor = connection.execute(
        f"""
        SELECT parent_id, id, xml_id, position, class, sclass
        FROM words
        WHERE parent_id IN ({placeholders})
        ORDER BY parent_id, position, id
        """,
        sentence_ids,
    )
    for sentence_id, word_id, xml_id, position, word_class, sclass in cursor:
        word = {
            "id": word_id,
            "xml_id": xml_id,
            "position": position,
            "class": word_class,
            "sclass": sclass,
            "morphemes": [],
        }
        words_by_id[str(word_id)] = word
        cast(list[dict[str, object]], records[str(sentence_id)]["words"]).append(word)
    if words_by_id:
        word_ids = list(words_by_id)
        word_placeholders = ",".join("?" for _ in word_ids)
        cursor = connection.execute(
            f"""
            SELECT parent_id, id, xml_id, position, class, sclass
            FROM morphemes
            WHERE parent_id IN ({word_placeholders})
            ORDER BY parent_id, position, id
            """,
            word_ids,
        )
        for word_id, morpheme_id, xml_id, position, morpheme_class, sclass in cursor:
            cast(list[dict[str, object]], words_by_id[str(word_id)]["morphemes"]).append(
                {
                    "id": morpheme_id,
                    "xml_id": xml_id,
                    "position": position,
                    "class": morpheme_class,
                    "sclass": sclass,
                }
            )
    return [records[str(row[0])] for row in rows]


def _write_search_data(
    connection: sqlite3.Connection,
    output: Path,
    *,
    release_id: str,
    shard_size: int = 1000,
) -> dict[str, object]:
    """Write portable JSONL plus bounded Pages-origin JSON shards."""
    search_dir = output / "search"
    search_dir.mkdir(parents=True, exist_ok=True)
    query = """
        SELECT
          s.id,
          t.id,
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
        ORDER BY t.language_id, t.corpus_id, t.source_path, s.position
    """
    shards: list[dict[str, object]] = []
    indexes: list[dict[str, object]] = []
    current_scope: tuple[str, str] | None = None
    current_rows: list[tuple[object, ...]] = []
    scope_part = 0
    scope_terms: dict[str, dict[str, set[int]]] = {}

    def reset_terms() -> None:
        nonlocal scope_terms
        scope_terms = {
            "source_exact": {},
            "source": {},
            "translation": {},
            "phonology": {},
            "gloss": {},
            "regex": {},
        }

    def add_term(kind: str, value: object, part: int, *, normalize: bool = True) -> None:
        text = str(value or "")
        if normalize:
            text = unicodedata.normalize("NFC", text).strip().casefold()
        else:
            text = unicodedata.normalize("NFC", text).strip()
        if text:
            scope_terms[kind].setdefault(text, set()).add(part)

    def index_records(records: list[dict[str, object]], part: int) -> None:
        for record in records:
            source_values = [
                record["standard"],
                record["original"],
                *(item["surface"] for item in cast(list[dict[str, object]], record["tokens"])),
                *(item["text"] for item in cast(list[dict[str, object]], record["forms"])),
            ]
            for value in source_values:
                add_term("source_exact", value, part, normalize=False)
                add_term("source", value, part)
                add_term("regex", value, part, normalize=False)
            for item in cast(list[dict[str, object]], record["translations"]):
                add_term("translation", item["text"], part)
                add_term("regex", item["text"], part, normalize=False)
            for item in cast(list[dict[str, object]], record["phonology"]):
                add_term("phonology", item["text"], part)
                add_term("regex", item["text"], part, normalize=False)
            for item in cast(list[dict[str, object]], record["tier_translations"]):
                add_term("regex", item["text"], part, normalize=False)
                if item["owner_type"] != "sentence":
                    add_term("gloss", item["text"], part)
                    add_term("gloss", item["normalized"], part)

    def write_index() -> None:
        if current_scope is None or scope_part == 0:
            return
        corpus_id, language_id = current_scope
        relative = Path("search") / "indexes" / language_id / corpus_id / "vocabulary.json.gz"
        path = output / relative
        document = {
            "schema_version": SCHEMA_VERSION,
            "release_id": release_id,
            "language_id": language_id,
            "corpus_id": corpus_id,
            "shards": scope_part,
            "terms": {
                kind: {term: sorted(parts) for term, parts in values.items()}
                for kind, values in scope_terms.items()
            },
        }
        uncompressed = _json_bytes(document)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(uncompressed, compresslevel=9, mtime=0))
        data = path.read_bytes()
        indexes.append(
            {
                "path": relative.as_posix(),
                "language_id": language_id,
                "corpus_id": corpus_id,
                "shards": scope_part,
                "terms": sum(len(values) for values in scope_terms.values()),
                "bytes": len(data),
                "uncompressed_bytes": len(uncompressed),
                "sha256": hashlib.sha256(data).hexdigest(),
                "uncompressed_sha256": hashlib.sha256(uncompressed).hexdigest(),
            }
        )

    def flush() -> None:
        nonlocal current_rows, scope_part
        if not current_rows or current_scope is None:
            return
        corpus_id, language_id = current_scope
        current_records = _search_records(connection, current_rows)
        index_records(current_records, scope_part)
        for value in current_records:
            stream.write(
                json.dumps(
                    value,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n"
            )
        relative = Path("search") / "shards" / language_id / corpus_id / f"{scope_part:04d}.json.gz"
        path = output / relative
        uncompressed = _json_bytes(current_records)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(uncompressed, compresslevel=9, mtime=0))
        data = path.read_bytes()
        shards.append(
            {
                "path": relative.as_posix(),
                "language_id": language_id,
                "corpus_id": corpus_id,
                "part": scope_part,
                "records": len(current_records),
                "bytes": len(data),
                "uncompressed_bytes": len(uncompressed),
                "sha256": hashlib.sha256(data).hexdigest(),
                "uncompressed_sha256": hashlib.sha256(uncompressed).hexdigest(),
            }
        )
        current_rows = []
        scope_part += 1

    with (search_dir / "sentences.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        reset_terms()
        for row in connection.execute(query):
            scope = (str(row[2]), str(row[3]))
            if current_scope != scope:
                flush()
                write_index()
                current_scope = scope
                scope_part = 0
                reset_terms()
            current_rows.append(row)
            if len(current_rows) >= shard_size:
                flush()
        flush()
        write_index()
    translation_targets: dict[str, dict[str, object]] = {}
    for (
        xml_lang,
        language_id,
        corpus_id,
        records,
        sentence_records,
        lexical_records,
    ) in connection.execute(
        """
        SELECT translation.xml_lang,
               text.language_id,
               text.corpus_id,
               COUNT(DISTINCT scope.sentence_id),
               COUNT(DISTINCT CASE
                 WHEN translation.owner_type = 'sentence' THEN scope.sentence_id
               END),
               COUNT(DISTINCT CASE
                 WHEN translation.owner_type != 'sentence' THEN scope.sentence_id
               END)
        FROM translations translation
        JOIN tier_scope_view scope
          ON scope.owner_type = translation.owner_type
         AND scope.owner_id = translation.owner_id
        JOIN sentences sentence ON scope.sentence_id = sentence.id
        JOIN texts text ON sentence.parent_id = text.id
        WHERE TRIM(translation.xml_lang) != ''
        GROUP BY translation.xml_lang, text.language_id, text.corpus_id
        ORDER BY translation.xml_lang, text.language_id, text.corpus_id
        """
    ):
        target = translation_targets.setdefault(
            str(xml_lang),
            {
                "xml_lang": str(xml_lang),
                "records": 0,
                "sentence_records": 0,
                "lexical_records": 0,
                "language_ids": set(),
                "corpus_ids": set(),
                "scopes": [],
            },
        )
        target["records"] = cast(int, target["records"]) + int(records)
        target["sentence_records"] = cast(int, target["sentence_records"]) + int(sentence_records)
        target["lexical_records"] = cast(int, target["lexical_records"]) + int(lexical_records)
        cast(set[str], target["language_ids"]).add(str(language_id))
        cast(set[str], target["corpus_ids"]).add(str(corpus_id))
        cast(list[dict[str, object]], target["scopes"]).append(
            {
                "language_id": str(language_id),
                "corpus_id": str(corpus_id),
                "records": int(records),
                "sentence_records": int(sentence_records),
                "lexical_records": int(lexical_records),
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "record_unit": "sentence",
        "translation_targets": [
            {
                **target,
                "language_ids": sorted(cast(set[str], target["language_ids"])),
                "corpus_ids": sorted(cast(set[str], target["corpus_ids"])),
            }
            for target in translation_targets.values()
        ],
        "shards": shards,
        "indexes": indexes,
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
    site_only: bool = False,
    compress_database: bool = False,
    release_only: bool = False,
    application_commit: str | None = None,
) -> BuildResult:
    """Build deterministic core tables, SQLite, catalogue, and static API."""
    if site_only and include_prepared:
        raise BuildError("A site-only build cannot include prepared download formats")
    if site_only and compress_database:
        raise BuildError("A site-only build has no database to compress")
    if release_only and (site_only or not include_prepared or not compress_database):
        raise BuildError("A release-only build requires prepared formats and a compressed database")
    repo = repo.resolve()
    source = inspect_source(repo, expected_commit)
    kakarayan_commit = inspect_application_commit(application_commit)
    output = output.resolve()
    _prepare_output(output)
    schema_dir = schemas or Path(__file__).resolve().parents[1] / "schemas"
    release_id = _release_id(source)
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
        search_manifest = _write_search_data(
            connection,
            output,
            release_id=release_id,
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
        "search/manifest": search_manifest,
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
    validate_document(search_manifest, schema_dir / "search-manifest.schema.json")

    if include_prepared:
        prepared_rights, prepared_summary = build_prepared_formats(
            repo=repo,
            output=output,
            database=sqlite_path,
            release_id=release_id,
            source_commit=source.commit,
            rights=rights,
        )
    else:
        prepared_rights = {}
        prepared_summary = {
            "cldf": {},
            "aligned": {},
            "canonical_packages": 0,
        }
    artifact_content: dict[str, dict[str, object]] = {}
    if site_only:
        shutil.rmtree(tables_dir)
        sqlite_path.unlink()
        (output / "search" / "sentences.jsonl").unlink()
    elif compress_database:
        compressed_database, content = _compress_database(sqlite_path)
        artifact_content[compressed_database.relative_to(output).as_posix()] = content
    if release_only:
        if tables_dir.exists():
            shutil.rmtree(tables_dir)
        shutil.rmtree(output / "api")
        shutil.rmtree(output / "search")
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
            else "site-query-data"
            if relative.startswith(("api/", "search/"))
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
        if (
            str(artifact["path"]) == "formosanbank.sqlite.gz"
            or (
                str(artifact["path"]).startswith("prepared/")
                and (
                    str(artifact["path"]).endswith((".zip", ".xlsx"))
                    or "/parquet/" in str(artifact["path"])
                )
            )
        )
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
                    scope="site-query-data",
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
