"""Create, index, and summarize the SQLite read model."""

from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Mapping
from pathlib import Path

from publisher.tables import TABLE_COLUMNS, sqlite_type
from publisher.xml_records import Projection


def create_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=DELETE")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("PRAGMA foreign_keys=OFF")
    for table, columns in TABLE_COLUMNS.items():
        definitions = ", ".join(f'"{column}" {sqlite_type(column)}' for column in columns)
        connection.execute(f'CREATE TABLE "{table}" ({definitions})')
    return connection


def insert_projection(connection: sqlite3.Connection, projection: Projection) -> None:
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


def add_indexes(connection: sqlite3.Connection) -> None:
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


def add_summary_cache(connection: sqlite3.Connection) -> None:
    """Precompute only language/corpus/dialect scopes present in this release."""
    connection.execute(
        "CREATE TABLE summary_cache ("
        "language_id TEXT NOT NULL, corpus_id TEXT NOT NULL, dialect TEXT NOT NULL, "
        "value_json TEXT NOT NULL, PRIMARY KEY (language_id, corpus_id, dialect)) WITHOUT ROWID"
    )
    pairs = [
        (str(row[0]), str(row[1]), str(row[2]))
        for row in connection.execute(
            "SELECT DISTINCT language_id, corpus_id, dialect FROM texts "
            "ORDER BY language_id, corpus_id, dialect"
        )
    ]
    scopes = sorted(
        {(language, corpus, dialect) for language, corpus, dialect in pairs}
        | {(language, corpus, "") for language, corpus, _ in pairs}
        | {(language, "", dialect) for language, _, dialect in pairs}
        | {(language, "", "") for language, _, _ in pairs}
    )
    for language_id, corpus_id, dialect in scopes:
        clauses = ["t.language_id = ?"]
        parameters: list[object] = [language_id]
        if corpus_id:
            clauses.append("t.corpus_id = ?")
            parameters.append(corpus_id)
        if dialect:
            clauses.append("t.dialect = ?")
            parameters.append(dialect)
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
            "INSERT INTO summary_cache(language_id, corpus_id, dialect, value_json) "
            "VALUES (?, ?, ?, ?)",
            (
                language_id,
                corpus_id,
                dialect,
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


def corpus_licenses(connection: sqlite3.Connection) -> dict[str, list[str]]:
    licenses: dict[str, list[str]] = {}
    for corpus, value in connection.execute(
        "SELECT DISTINCT substr(source_path, 9, instr(substr(source_path, 9), '/') - 1), "
        "copyright FROM texts WHERE copyright <> '' ORDER BY 1, 2"
    ):
        licenses.setdefault(corpus, []).append(value)
    return licenses


def add_publication_metadata(
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


def record_counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        for table in TABLE_COLUMNS
    }


def scope_counts(
    connection: sqlite3.Connection,
) -> tuple[dict[str, Counter[str]], dict[str, Counter[str]], dict[str, dict[str, Counter[str]]]]:
    corpus: dict[str, Counter[str]] = defaultdict(Counter)
    language: dict[str, Counter[str]] = defaultdict(Counter)
    by_language: dict[str, dict[str, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    sentence_scope = "sentences s JOIN texts t ON t.id = s.parent_id"
    sources = {
        "texts": "texts t",
        "sentences": sentence_scope,
        "words": "words w JOIN sentences s ON s.id = w.parent_id "
        "JOIN texts t ON t.id = s.parent_id",
        "morphemes": (
            "morphemes m JOIN words w ON w.id = m.parent_id "
            "JOIN sentences s ON s.id = w.parent_id JOIN texts t ON t.id = s.parent_id"
        ),
        "tokens": "tokens tok JOIN sentences s ON s.id = tok.sentence_id "
        "JOIN texts t ON t.id = s.parent_id",
    }
    for table in ("forms", "phonology", "translations", "audio"):
        # TEXT evidence is not in tier_scope, which starts at S.
        sources[table] = (
            f'(SELECT t.corpus_id, t.language_id FROM "{table}" evidence '
            "JOIN tier_scope ts ON ts.owner_type = evidence.owner_type "
            "AND ts.owner_id = evidence.owner_id "
            "JOIN sentences s ON s.id = ts.sentence_id JOIN texts t ON t.id = s.parent_id "
            f'UNION ALL SELECT t.corpus_id, t.language_id FROM "{table}" evidence '
            "JOIN texts t ON evidence.owner_type = 'text' AND t.id = evidence.owner_id) t"
        )
    for table, source_sql in sources.items():
        for corpus_id, language_id, count in connection.execute(
            f"SELECT t.corpus_id, t.language_id, COUNT(*) FROM {source_sql} "
            "GROUP BY t.corpus_id, t.language_id"
        ):
            corpus[corpus_id][table] += count
            language[language_id][table] += count
            by_language[corpus_id][language_id][table] += count
    return corpus, language, by_language
