"""Bounded read queries over one validated immutable release."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any, Literal

from api.cursors import CursorValue, decode_cursor, encode_cursor, query_fingerprint
from api.errors import ApiError
from api.release import ReleaseState, readonly_connection
from api.search import MatchMode, normalize_surface, normalize_text

SearchDirection = Literal["formosan", "translation"]
FrequencySort = Literal["count", "form"]
TierRequirement = Literal["translation", "audio", "phonology", "interlinear", "unclear"]
DatasetField = Literal[
    "id",
    "text_id",
    "standard",
    "original",
    "translations",
    "tokens",
    "phonology",
    "glosses",
    "language_id",
    "corpus_id",
    "dialect",
    "source_path",
    "audio",
]
DATASET_FIELDS: tuple[DatasetField, ...] = (
    "id",
    "text_id",
    "standard",
    "original",
    "translations",
    "tokens",
    "phonology",
    "glosses",
    "language_id",
    "corpus_id",
    "dialect",
    "source_path",
    "audio",
)
SUMMARY_FORM_MAX_CHARS = 480
SUMMARY_TRANSLATION_MAX_CHARS = 320
SUMMARY_TRANSLATION_LIMIT = 3
DICTIONARY_EXAMPLE_LIMIT = 2


def _bounded_text(value: object, maximum: int) -> tuple[str, bool]:
    text = str(value)
    if len(text) <= maximum:
        return text, False
    return f"{text[: maximum - 1]}…", True


def _like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _predicate(
    column: str,
    query: str,
    match: MatchMode,
    vocabulary: Literal["formosan", "translation"],
) -> tuple[str, tuple[str, ...]]:
    if match == "exact":
        return f"{column} = ?", (query,)
    if match == "prefix":
        return f"{column} >= ? AND {column} < ?", (query, f"{query}\U0010ffff")
    table = f"{vocabulary}_vocabulary"
    if len(query) < 3:
        return (
            f"{column} IN (SELECT value FROM {table} WHERE value LIKE ? ESCAPE '\\')",
            (f"%{_like(query)}%",),
        )
    fts_table = f"{table}_fts"
    phrase = f'"{query.replace(chr(34), chr(34) * 2)}"'
    return (
        f"{column} IN (SELECT v.value FROM {fts_table} search "
        f"JOIN {table} v ON v.rowid = search.rowid WHERE {fts_table} MATCH ?)",
        (phrase,),
    )


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def _cursor_position(
    cursor: str | None,
    fingerprint: str,
    length: int,
) -> list[CursorValue] | None:
    position = decode_cursor(cursor, fingerprint)
    if position is not None and len(position) != length:
        raise ApiError(400, "invalid_cursor", "The cursor is invalid for this query")
    return position


class CorpusStore:
    def __init__(self, state: ReleaseState, query_step_limit: int) -> None:
        self.state = state
        self.query_step_limit = query_step_limit

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = readonly_connection(self.state.database_path)
        callbacks = 0

        def progress() -> int:
            nonlocal callbacks
            callbacks += 1
            return int(callbacks > self.query_step_limit)

        connection.set_progress_handler(progress, 1000)
        try:
            yield connection
        except sqlite3.OperationalError as error:
            if "interrupted" in str(error).lower():
                raise ApiError(
                    422,
                    "query_too_expensive",
                    "The query exceeded the service work limit. Narrow the scope.",
                ) from None
            raise
        finally:
            connection.close()

    @property
    def release_id(self) -> str:
        return str(self.state.manifest["release_id"])

    def require_release(self, release_id: str) -> None:
        if release_id != self.release_id:
            raise ApiError(404, "release_not_found", "The requested release is not active")

    def metadata(self, key: str) -> Any:
        return self.state.metadata[key]

    def downloads(self) -> dict[str, Any]:
        return {
            "schema_version": self.state.manifest["schema_version"],
            "release_id": self.release_id,
            "artifacts": self.state.manifest["artifacts"],
        }

    def language(self, language_id: str) -> dict[str, Any]:
        match = next(
            (item for item in self.metadata("languages") if item["id"] == language_id),
            None,
        )
        if match is None:
            raise ApiError(404, "language_not_found", "Language not found")
        return match

    def corpus(self, corpus_id: str) -> dict[str, Any]:
        match = next(
            (item for item in self.metadata("corpora") if item["id"] == corpus_id),
            None,
        )
        if match is None:
            raise ApiError(404, "corpus_not_found", "Corpus not found")
        return match

    @staticmethod
    def _scope(
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        *,
        alias: str = "t",
    ) -> tuple[list[str], list[object]]:
        clauses = [f"{alias}.language_id = ?"]
        parameters: list[object] = [language_id]
        if corpus_id:
            clauses.append(f"{alias}.corpus_id = ?")
            parameters.append(corpus_id)
        if dialect:
            clauses.append(f"{alias}.dialect = ?")
            parameters.append(dialect)
        return clauses, parameters

    @classmethod
    def _candidate_sentences(
        cls,
        *,
        normalized: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
    ) -> tuple[str, tuple[object, ...]]:
        scope, scope_parameters = cls._scope(language_id, corpus_id, dialect)
        where = " AND ".join(scope)
        if direction == "formosan":
            token_clause, token_parameters = _predicate(
                "tok.normalized", normalized, match, "formosan"
            )
            form_clause, form_parameters = _predicate("f.normalized", normalized, match, "formosan")
            sql = f"""
                SELECT tok.sentence_id
                FROM tokens tok INDEXED BY tokens_normalized
                JOIN sentences s ON s.id = tok.sentence_id
                JOIN texts t ON t.id = s.parent_id
                WHERE {where} AND {token_clause}
                UNION
                SELECT ts.sentence_id
                FROM forms f INDEXED BY forms_normalized
                JOIN tier_scope ts
                  ON ts.owner_type = f.owner_type AND ts.owner_id = f.owner_id
                JOIN sentences s ON s.id = ts.sentence_id
                JOIN texts t ON t.id = s.parent_id
                WHERE {where} AND f.owner_type <> 'sentence' AND {form_clause}
            """
            return sql, (
                *scope_parameters,
                *token_parameters,
                *scope_parameters,
                *form_parameters,
            )
        translation_clause, translation_parameters = _predicate(
            "tr.normalized", normalized, match, "translation"
        )
        language_clause = " AND tr.xml_lang = ?" if translation_language else ""
        language_parameters: tuple[object, ...] = (
            (translation_language,) if translation_language else ()
        )
        sql = f"""
            SELECT DISTINCT ts.sentence_id
            FROM translations tr
            JOIN tier_scope ts
              ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
            JOIN sentences s ON s.id = ts.sentence_id
            JOIN texts t ON t.id = s.parent_id
            WHERE {where} AND {translation_clause}{language_clause}
        """
        return sql, (
            *scope_parameters,
            *translation_parameters,
            *language_parameters,
        )

    @staticmethod
    def _tiers(
        connection: sqlite3.Connection,
        owner_type: str,
        owner_id: str,
    ) -> dict[str, list[dict[str, Any]]]:
        return {
            table: [
                dict(row)
                for row in connection.execute(
                    f"SELECT * FROM {table} WHERE owner_type = ? AND owner_id = ? "
                    "ORDER BY position",
                    (owner_type, owner_id),
                )
            ]
            for table in ("forms", "phonology", "translations", "audio")
        }

    def text(self, text_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            record = _row(
                connection.execute("SELECT * FROM texts WHERE id = ?", (text_id,)).fetchone()
            )
            if record is None:
                raise ApiError(404, "text_not_found", "Text not found")
            record["tiers"] = self._tiers(connection, "text", text_id)
            record["sentence_count"] = connection.execute(
                "SELECT COUNT(*) FROM sentences WHERE parent_id = ?", (text_id,)
            ).fetchone()[0]
            return record

    @staticmethod
    def _forms_by_kind(forms: Sequence[dict[str, Any]]) -> tuple[str, str]:
        standard = next((str(item["text"]) for item in forms if item["kind"] == "standard"), "")
        original = next((str(item["text"]) for item in forms if item["kind"] == "original"), "")
        return standard, original

    def sentence(self, sentence_id: str) -> dict[str, Any]:
        """Return the complete record only when a user expands one result."""
        with self.connect() as connection:
            record = _row(
                connection.execute(
                    """
                    SELECT s.*, t.corpus_id, t.language_id, t.language, t.xml_lang,
                           t.dialect, t.source_path, t.citation, t.copyright,
                           t.id AS text_id
                    FROM sentences s
                    JOIN texts t ON t.id = s.parent_id
                    WHERE s.id = ?
                    """,
                    (sentence_id,),
                ).fetchone()
            )
            if record is None:
                raise ApiError(404, "sentence_not_found", "Sentence not found")
            tokens = [
                dict(row)
                for row in connection.execute(
                    "SELECT * FROM tokens WHERE sentence_id = ? ORDER BY position LIMIT 1001",
                    (sentence_id,),
                )
            ]
            words = [
                dict(row)
                for row in connection.execute(
                    "SELECT * FROM words WHERE parent_id = ? ORDER BY position LIMIT 1001",
                    (sentence_id,),
                )
            ]
            if len(tokens) > 1000 or len(words) > 1000:
                raise ApiError(422, "record_too_large", "The record exceeds the API detail limit")
            owner_pairs: list[tuple[str, str]] = [("sentence", sentence_id)]
            for word in words:
                owner_pairs.append(("word", str(word["id"])))
                morphemes = [
                    dict(row)
                    for row in connection.execute(
                        "SELECT * FROM morphemes WHERE parent_id = ? ORDER BY position LIMIT 1001",
                        (word["id"],),
                    )
                ]
                if len(morphemes) > 1000:
                    raise ApiError(
                        422, "record_too_large", "The record exceeds the API detail limit"
                    )
                word["morphemes"] = morphemes
                owner_pairs.extend(("morpheme", str(item["id"])) for item in morphemes)

            tiers: dict[str, list[dict[str, Any]]] = {
                "forms": [],
                "phonology": [],
                "translations": [],
                "audio": [],
            }
            for owner_type, owner_id in owner_pairs:
                current = self._tiers(connection, owner_type, owner_id)
                for table, rows in current.items():
                    tiers[table].extend(rows)
            sentence_forms = [
                item
                for item in tiers["forms"]
                if item["owner_type"] == "sentence" and item["owner_id"] == sentence_id
            ]
            standard, original = self._forms_by_kind(sentence_forms)
            sentence_translations = [
                item
                for item in tiers["translations"]
                if item["owner_type"] == "sentence" and item["owner_id"] == sentence_id
            ]
            return {
                **record,
                "standard": standard,
                "original": original,
                "translations": sentence_translations,
                "tier_translations": tiers["translations"],
                "tokens": tokens,
                "words": words,
                "forms": tiers["forms"],
                "phonology": tiers["phonology"],
                "audio": tiers["audio"],
            }

    @staticmethod
    def _sentence_summaries(
        connection: sqlite3.Connection,
        rows: Sequence[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not rows:
            return []
        identifiers = [str(row["id"]) for row in rows]
        placeholders = ",".join("?" for _ in identifiers)
        forms: dict[str, list[dict[str, Any]]] = defaultdict(list)
        translations: dict[str, list[dict[str, Any]]] = defaultdict(list)
        audio_counts: dict[str, int] = defaultdict(int)
        for row in connection.execute(
            f"SELECT owner_id, text, kind, position FROM forms "
            f"WHERE owner_type = 'sentence' AND owner_id IN ({placeholders}) ORDER BY position",
            identifiers,
        ):
            forms[str(row["owner_id"])].append(dict(row))
        for row in connection.execute(
            f"SELECT owner_id, text, xml_lang, kind, version, position FROM translations "
            f"WHERE owner_type = 'sentence' AND owner_id IN ({placeholders}) ORDER BY position",
            identifiers,
        ):
            translations[str(row["owner_id"])].append(dict(row))
        for row in connection.execute(
            f"SELECT ts.sentence_id, COUNT(*) AS count FROM audio a "
            f"JOIN tier_scope_view ts ON ts.owner_type = a.owner_type AND ts.owner_id = a.owner_id "
            f"WHERE ts.sentence_id IN ({placeholders}) GROUP BY ts.sentence_id",
            identifiers,
        ):
            audio_counts[str(row["sentence_id"])] = int(row["count"])

        result = []
        for row in rows:
            identifier = str(row["id"])
            standard, original = CorpusStore._forms_by_kind(forms[identifier])
            standard, standard_truncated = _bounded_text(standard, SUMMARY_FORM_MAX_CHARS)
            original, original_truncated = _bounded_text(original, SUMMARY_FORM_MAX_CHARS)
            sentence_translations = translations[identifier]
            summary_translations = []
            translation_truncated = len(sentence_translations) > SUMMARY_TRANSLATION_LIMIT
            for item in sentence_translations[:SUMMARY_TRANSLATION_LIMIT]:
                summary = dict(item)
                summary["text"], shortened = _bounded_text(
                    item["text"], SUMMARY_TRANSLATION_MAX_CHARS
                )
                translation_truncated = translation_truncated or shortened
                summary_translations.append(summary)
            result.append(
                {
                    **row,
                    "standard": standard,
                    "original": original,
                    "translations": summary_translations,
                    "translation_count": len(sentence_translations),
                    "summary_truncated": (
                        standard_truncated or original_truncated or translation_truncated
                    ),
                    "audio_count": audio_counts[identifier],
                }
            )
        return result

    def translation_languages(
        self,
        *,
        language_id: str,
        corpus_id: str | None,
    ) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    "SELECT xml_lang, records FROM translation_language_cache "
                    "WHERE language_id = ? AND corpus_id = ? ORDER BY xml_lang",
                    (language_id, corpus_id or ""),
                )
            ]

    def _dictionary_evidence(
        self,
        connection: sqlite3.Connection,
        *,
        headword: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        translation_language: str | None,
    ) -> dict[str, Any]:
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        rows = [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT tok.sentence_id, tok.word_id AS owner_id, tok.surface AS value,
                       t.corpus_id
                FROM tokens tok
                JOIN sentences s ON s.id = tok.sentence_id
                JOIN texts t ON t.id = s.parent_id
                WHERE {" AND ".join(clauses)} AND tok.normalized = ?
                ORDER BY t.source_path, s.position, tok.position
                LIMIT 20
                """,
                (*parameters, headword),
            )
        ]
        if not rows:
            rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT ts.sentence_id, f.owner_id, f.text AS value, t.corpus_id
                    FROM forms f
                    JOIN tier_scope_view ts
                      ON ts.owner_type = f.owner_type AND ts.owner_id = f.owner_id
                    JOIN sentences s ON s.id = ts.sentence_id
                    JOIN texts t ON t.id = s.parent_id
                    WHERE {" AND ".join(clauses)} AND f.owner_type <> 'sentence'
                      AND f.normalized = ?
                    ORDER BY t.source_path, s.position, f.position
                    LIMIT 20
                    """,
                    (*parameters, headword),
                )
            ]
        sentence_ids = list(dict.fromkeys(str(row["sentence_id"]) for row in rows))[
            :DICTIONARY_EXAMPLE_LIMIT
        ]
        owner_ids = {str(row["owner_id"]) for row in rows if row.get("owner_id")}
        if owner_ids:
            placeholders = ",".join("?" for _ in owner_ids)
            owner_ids.update(
                str(row[0])
                for row in connection.execute(
                    f"SELECT id FROM morphemes WHERE parent_id IN ({placeholders})",
                    tuple(owner_ids),
                )
            )
        meanings: list[str] = []
        pronunciations: list[str] = []
        if owner_ids:
            placeholders = ",".join("?" for _ in owner_ids)
            language_clause = " AND xml_lang = ?" if translation_language else ""
            language_parameters: tuple[object, ...] = (
                (translation_language,) if translation_language else ()
            )
            meanings = [
                str(row[0])
                for row in connection.execute(
                    f"SELECT DISTINCT text FROM translations "
                    f"WHERE owner_id IN ({placeholders}){language_clause} AND text <> '' "
                    "ORDER BY position LIMIT 12",
                    (*owner_ids, *language_parameters),
                )
            ]
            pronunciations = [
                str(row[0])
                for row in connection.execute(
                    f"SELECT DISTINCT text FROM phonology WHERE owner_id IN ({placeholders}) "
                    "AND text <> '' ORDER BY position LIMIT 8",
                    tuple(owner_ids),
                )
            ]
        if not meanings and sentence_ids:
            placeholders = ",".join("?" for _ in sentence_ids)
            language_clause = " AND xml_lang = ?" if translation_language else ""
            language_parameters = (translation_language,) if translation_language else ()
            meanings = [
                str(row[0])
                for row in connection.execute(
                    f"SELECT DISTINCT text FROM translations WHERE owner_type = 'sentence' "
                    f"AND owner_id IN ({placeholders}){language_clause} AND text <> '' "
                    "ORDER BY position LIMIT 12",
                    (*sentence_ids, *language_parameters),
                )
            ]
        examples: list[dict[str, Any]] = []
        if sentence_ids:
            placeholders = ",".join("?" for _ in sentence_ids)
            example_rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT s.id, s.parent_id AS text_id, s.xml_id, s.position, s.token_count,
                           t.corpus_id, t.language_id, t.language, t.dialect,
                           t.source_path, t.citation
                    FROM sentences s JOIN texts t ON t.id = s.parent_id
                    WHERE s.id IN ({placeholders})
                    ORDER BY t.source_path, s.position, s.id
                    """,
                    sentence_ids,
                )
            ]
            examples = self._sentence_summaries(connection, example_rows)
        variants = list(dict.fromkeys(str(row["value"]) for row in rows if row.get("value")))[:8]
        corpus_ids = list(dict.fromkeys(str(row["corpus_id"]) for row in rows))
        return {
            "meanings": meanings,
            "pronunciations": pronunciations,
            "variants": variants,
            "corpus_ids": corpus_ids,
            "examples": examples,
        }

    def dictionary(
        self,
        *,
        q: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
        limit: int,
        cursor: str | None,
    ) -> dict[str, Any]:
        normalized = normalize_surface(q) if direction == "formosan" else normalize_text(q)
        if not normalized:
            raise ApiError(422, "invalid_parameter", "The query is empty after normalization")
        fingerprint = query_fingerprint(
            [
                "dictionary",
                normalized,
                language_id,
                corpus_id,
                dialect,
                direction,
                translation_language,
                match,
            ]
        )
        position = _cursor_position(cursor, fingerprint, 1)
        scope, scope_parameters = self._scope(language_id, corpus_id, dialect)
        if direction == "formosan":
            clauses = ["d.language_id = ?"]
            parameters: tuple[object, ...] = (language_id,)
            if corpus_id:
                clauses.append("d.corpus_id = ?")
                parameters += (corpus_id,)
            if dialect:
                clauses.append("d.dialect = ?")
                parameters += (dialect,)
            match_clause, match_parameters = _predicate("d.headword", normalized, match, "formosan")
            clauses.append(match_clause)
            parameters += match_parameters
            if position:
                clauses.append("d.headword > ?")
                parameters += (str(position[0]),)
            sql = f"""
                SELECT d.headword, MIN(d.display_form) AS display_form,
                       SUM(d.occurrences) AS occurrences,
                       COUNT(DISTINCT d.display_form) AS variant_count
                FROM dictionary_terms d
                WHERE {" AND ".join(clauses)}
                GROUP BY d.headword
                ORDER BY d.headword LIMIT ?
            """
        else:
            translation_clause, translation_parameters = _predicate(
                "tr.normalized", normalized, match, "translation"
            )
            language_clause = "AND tr.xml_lang = ?" if translation_language else ""
            language_parameters: tuple[object, ...] = (
                (translation_language,) if translation_language else ()
            )
            candidates = f"""
                SELECT f.normalized AS headword, f.text AS display_form
                FROM translations tr
                JOIN tier_scope_view ts
                  ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
                JOIN sentences s ON s.id = ts.sentence_id
                JOIN texts t ON t.id = s.parent_id
                JOIN forms f ON f.owner_type = tr.owner_type AND f.owner_id = tr.owner_id
                WHERE {" AND ".join(scope)} AND tr.owner_type <> 'sentence'
                  AND {translation_clause} {language_clause}
                UNION ALL
                SELECT tok.normalized AS headword, tok.surface AS display_form
                FROM translations tr
                JOIN words w ON tr.owner_type = 'word' AND w.id = tr.owner_id
                JOIN tokens tok ON tok.word_id = w.id
                JOIN sentences s ON s.id = tok.sentence_id
                JOIN texts t ON t.id = s.parent_id
                WHERE {" AND ".join(scope)} AND {translation_clause} {language_clause}
                UNION ALL
                SELECT tok.normalized AS headword, tok.surface AS display_form
                FROM translations tr
                JOIN sentences s ON tr.owner_type = 'sentence' AND s.id = tr.owner_id
                JOIN tokens tok ON tok.sentence_id = s.id
                JOIN texts t ON t.id = s.parent_id
                WHERE {" AND ".join(scope)} AND s.token_count = 1
                  AND {translation_clause} {language_clause}
            """
            branch_parameters = (
                *scope_parameters,
                *translation_parameters,
                *language_parameters,
            )
            parameters = (*branch_parameters, *branch_parameters, *branch_parameters)
            cursor_clause = "WHERE headword > ?" if position else ""
            cursor_parameters: tuple[object, ...] = (str(position[0]),) if position else ()
            parameters += cursor_parameters
            sql = f"""
                WITH candidates AS ({candidates}), grouped AS (
                  SELECT headword, MIN(display_form) AS display_form,
                         COUNT(*) AS occurrences,
                         COUNT(DISTINCT display_form) AS variant_count
                  FROM candidates WHERE headword <> '' GROUP BY headword
                )
                SELECT * FROM grouped {cursor_clause}
                ORDER BY headword LIMIT ?
            """
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    sql,
                    (*parameters, limit + 1),
                )
            ]
            items = []
            for row in rows[:limit]:
                evidence = self._dictionary_evidence(
                    connection,
                    headword=str(row["headword"]),
                    language_id=language_id,
                    corpus_id=corpus_id,
                    dialect=dialect,
                    translation_language=translation_language,
                )
                items.append(
                    {
                        "id": f"lex:{language_id}:{row['headword']}",
                        "language_id": language_id,
                        "headword": row["headword"],
                        "display_form": row["display_form"],
                        "occurrences": row["occurrences"],
                        "variant_count": row["variant_count"],
                        **evidence,
                    }
                )
        has_more = len(rows) > limit
        return {
            "release_id": self.release_id,
            "items": items,
            "next_cursor": encode_cursor([str(rows[limit - 1]["headword"])], fingerprint)
            if has_more and items
            else None,
        }

    @staticmethod
    def _tier_requirements(clauses: list[str], requirements: Sequence[TierRequirement]) -> None:
        if "translation" in requirements:
            clauses.append(
                "EXISTS (SELECT 1 FROM translations tr JOIN tier_scope_view ts "
                "ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id "
                "WHERE ts.sentence_id = s.id)"
            )
        if "audio" in requirements:
            clauses.append(
                "EXISTS (SELECT 1 FROM audio a JOIN tier_scope_view ts "
                "ON ts.owner_type = a.owner_type AND ts.owner_id = a.owner_id "
                "WHERE ts.sentence_id = s.id)"
            )
        if "phonology" in requirements:
            clauses.append(
                "EXISTS (SELECT 1 FROM phonology p JOIN tier_scope_view ts "
                "ON ts.owner_type = p.owner_type AND ts.owner_id = p.owner_id "
                "WHERE ts.sentence_id = s.id)"
            )
        if "interlinear" in requirements:
            clauses.append("EXISTS (SELECT 1 FROM words w WHERE w.parent_id = s.id)")
        if "unclear" in requirements:
            clauses.append(
                "EXISTS (SELECT 1 FROM forms f JOIN tier_scope_view ts "
                "ON ts.owner_type = f.owner_type AND ts.owner_id = f.owner_id "
                "WHERE ts.sentence_id = s.id AND f.unclear > 0)"
            )

    def concordance(
        self,
        *,
        q: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
        requirements: Sequence[TierRequirement],
        limit: int,
        cursor: str | None,
    ) -> dict[str, Any]:
        normalized = normalize_surface(q) if direction == "formosan" else normalize_text(q)
        if not normalized:
            raise ApiError(422, "invalid_parameter", "The query is empty after normalization")
        fingerprint = query_fingerprint(
            [
                "concordance",
                normalized,
                language_id,
                corpus_id,
                dialect,
                direction,
                translation_language,
                match,
                sorted(requirements),
            ]
        )
        position = _cursor_position(cursor, fingerprint, 3)
        candidates, candidate_parameters = self._candidate_sentences(
            normalized=normalized,
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            direction=direction,
            translation_language=translation_language,
            match=match,
        )
        clauses: list[str] = []
        parameters: list[object] = []
        self._tier_requirements(clauses, requirements)
        if position:
            source_path, ordinal, identifier = position
            if (
                not isinstance(source_path, str)
                or not isinstance(ordinal, int)
                or not isinstance(identifier, str)
            ):
                raise ApiError(400, "invalid_cursor", "The cursor is invalid for this query")
            clauses.append(
                "(t.source_path > ? OR (t.source_path = ? AND s.position > ?) OR "
                "(t.source_path = ? AND s.position = ? AND s.id > ?))"
            )
            parameters.extend((source_path, source_path, ordinal, source_path, ordinal, identifier))
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    WITH candidate_ids AS ({candidates})
                    SELECT s.id, s.parent_id AS text_id, s.xml_id, s.position, s.token_count,
                           t.corpus_id, t.language_id, t.language, t.dialect,
                           t.source_path, t.citation
                    FROM candidate_ids candidate
                    JOIN sentences s ON s.id = candidate.sentence_id
                    JOIN texts t ON t.id = s.parent_id
                    WHERE {" AND ".join(clauses) if clauses else "1 = 1"}
                    ORDER BY t.source_path, s.position, s.id LIMIT ?
                    """,
                    (*candidate_parameters, *parameters, limit + 1),
                )
            ]
            items = self._sentence_summaries(connection, rows[:limit])
        has_more = len(rows) > limit
        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(
                [str(last["source_path"]), int(last["position"]), str(last["id"])],
                fingerprint,
            )
        return {"release_id": self.release_id, "items": items, "next_cursor": next_cursor}

    def frequencies(
        self,
        *,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        prefix: str | None,
        minimum: int,
        sort: FrequencySort,
        limit: int,
        cursor: str | None,
    ) -> dict[str, Any]:
        normalized_prefix = normalize_surface(prefix or "")
        fingerprint = query_fingerprint(
            ["frequencies", language_id, corpus_id, dialect, normalized_prefix, minimum, sort]
        )
        expected_cursor = 2 if sort == "count" else 1
        position = _cursor_position(cursor, fingerprint, expected_cursor)
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        if normalized_prefix:
            clauses.append("tok.normalized LIKE ? ESCAPE '\\'")
            parameters.append(f"{_like(normalized_prefix)}%")
        having = ["COUNT(*) >= ?"]
        parameters.append(minimum)
        if position:
            if sort == "count":
                count, form = position
                if not isinstance(count, int) or not isinstance(form, str):
                    raise ApiError(400, "invalid_cursor", "The cursor is invalid for this query")
                having.append("(COUNT(*) < ? OR (COUNT(*) = ? AND tok.normalized > ?))")
                parameters.extend((count, count, form))
            else:
                form = position[0]
                if not isinstance(form, str):
                    raise ApiError(400, "invalid_cursor", "The cursor is invalid for this query")
                having.append("tok.normalized > ?")
                parameters.append(form)
        order = "occurrences DESC, form ASC" if sort == "count" else "form ASC"
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT tok.normalized AS form, MIN(tok.surface) AS display_form,
                           COUNT(*) AS occurrences
                    FROM tokens tok JOIN sentences s ON s.id = tok.sentence_id
                    JOIN texts t ON t.id = s.parent_id
                    WHERE {" AND ".join(clauses)}
                    GROUP BY tok.normalized HAVING {" AND ".join(having)}
                    ORDER BY {order} LIMIT ?
                    """,
                    (*parameters, limit + 1),
                )
            ]
        items = rows[:limit]
        next_cursor = None
        if len(rows) > limit and items:
            last = items[-1]
            values: list[CursorValue] = (
                [int(last["occurrences"]), str(last["form"])]
                if sort == "count"
                else [str(last["form"])]
            )
            next_cursor = encode_cursor(values, fingerprint)
        return {"release_id": self.release_id, "items": items, "next_cursor": next_cursor}

    def summaries(
        self,
        *,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        limit: int,
    ) -> dict[str, Any]:
        if not dialect:
            with self.connect() as connection:
                cached = connection.execute(
                    "SELECT value_json FROM summary_cache WHERE language_id = ? AND corpus_id = ?",
                    (language_id, corpus_id or ""),
                ).fetchone()
            if cached:
                result = json.loads(str(cached[0]))
                for key in (
                    "source_frequencies",
                    "normalized_frequencies",
                    "translation_frequencies",
                ):
                    result[key] = result[key][:limit]
                return {"release_id": self.release_id, **result}
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        where = " AND ".join(clauses)
        with self.connect() as connection:
            sentence_count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM sentences s "
                    f"JOIN texts t ON t.id = s.parent_id WHERE {where}",
                    parameters,
                ).fetchone()[0]
            )
            token_count = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM tokens tok JOIN sentences s ON s.id = tok.sentence_id "
                    f"JOIN texts t ON t.id = s.parent_id WHERE {where}",
                    parameters,
                ).fetchone()[0]
            )
            source_type_count = int(
                connection.execute(
                    f"SELECT COUNT(DISTINCT tok.surface) FROM tokens tok "
                    f"JOIN sentences s ON s.id = tok.sentence_id "
                    f"JOIN texts t ON t.id = s.parent_id WHERE {where}",
                    parameters,
                ).fetchone()[0]
            )
            normalized_type_count = int(
                connection.execute(
                    f"SELECT COUNT(DISTINCT tok.normalized) FROM tokens tok "
                    f"JOIN sentences s ON s.id = tok.sentence_id "
                    f"JOIN texts t ON t.id = s.parent_id WHERE {where}",
                    parameters,
                ).fetchone()[0]
            )
            normalized = [
                dict(row)
                for row in connection.execute(
                    f"SELECT tok.normalized AS value, COUNT(*) AS count FROM tokens tok "
                    f"JOIN sentences s ON s.id = tok.sentence_id "
                    "JOIN texts t ON t.id = s.parent_id "
                    f"WHERE {where} GROUP BY tok.normalized ORDER BY count DESC, value LIMIT ?",
                    (*parameters, limit),
                )
            ]
            source = [
                dict(row)
                for row in connection.execute(
                    f"SELECT tok.surface AS value, COUNT(*) AS count FROM tokens tok "
                    f"JOIN sentences s ON s.id = tok.sentence_id "
                    "JOIN texts t ON t.id = s.parent_id "
                    f"WHERE {where} GROUP BY tok.surface ORDER BY count DESC, value LIMIT ?",
                    (*parameters, limit),
                )
            ]
            translations = [
                dict(row)
                for row in connection.execute(
                    f"SELECT tr.normalized AS value, COUNT(*) AS count FROM translations tr "
                    f"JOIN tier_scope_view ts ON ts.owner_type = tr.owner_type "
                    "AND ts.owner_id = tr.owner_id "
                    f"JOIN sentences s ON s.id = ts.sentence_id JOIN texts t ON t.id = s.parent_id "
                    f"WHERE {where} AND tr.normalized <> '' GROUP BY tr.normalized "
                    "ORDER BY count DESC, value LIMIT ?",
                    (*parameters, limit),
                )
            ]
            distributions = [
                {
                    "value": f"{row['corpus_id']} · {row['dialect'] or 'unknown'}",
                    "count": row["count"],
                }
                for row in connection.execute(
                    f"SELECT t.corpus_id, t.dialect, COUNT(*) AS count FROM sentences s "
                    f"JOIN texts t ON t.id = s.parent_id WHERE {where} "
                    "GROUP BY t.corpus_id, t.dialect ORDER BY count DESC, t.corpus_id, t.dialect",
                    parameters,
                )
            ]
        return {
            "release_id": self.release_id,
            "sentences": sentence_count,
            "tokens": token_count,
            "source_types": source_type_count,
            "normalized_types": normalized_type_count,
            "source_frequencies": source,
            "normalized_frequencies": normalized,
            "translation_frequencies": translations,
            "distributions": distributions,
        }

    def _dataset_clauses(
        self,
        *,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        q: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
        requirements: Sequence[TierRequirement],
    ) -> tuple[str | None, list[str], list[object]]:
        normalized = (
            normalize_surface(q or "") if direction == "formosan" else normalize_text(q or "")
        )
        if q is not None and not normalized:
            raise ApiError(422, "invalid_parameter", "The query is empty after normalization")
        if normalized:
            candidates, candidate_parameters = self._candidate_sentences(
                normalized=normalized,
                language_id=language_id,
                corpus_id=corpus_id,
                dialect=dialect,
                direction=direction,
                translation_language=translation_language,
                match=match,
            )
            clauses: list[str] = []
            parameters = list(candidate_parameters)
        else:
            candidates = None
            clauses, parameters = self._scope(language_id, corpus_id, dialect)
        self._tier_requirements(clauses, requirements)
        return candidates, clauses, parameters

    @staticmethod
    def _dataset_projection(fields: Sequence[DatasetField]) -> str:
        expressions = {
            "id": "s.id AS id",
            "text_id": "s.parent_id AS text_id",
            "standard": """COALESCE((
                SELECT f.text FROM forms f
                WHERE f.owner_type = 'sentence' AND f.owner_id = s.id
                  AND f.kind = 'standard' ORDER BY f.position LIMIT 1
            ), '') AS standard""",
            "original": """COALESCE((
                SELECT f.text FROM forms f
                WHERE f.owner_type = 'sentence' AND f.owner_id = s.id
                  AND f.kind = 'original' ORDER BY f.position LIMIT 1
            ), '') AS original""",
            "translations": """COALESCE((SELECT group_concat(value, ' | ') FROM (
                SELECT tr.xml_lang || ':' || tr.text AS value FROM translations tr
                JOIN tier_scope_view ts
                  ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
                WHERE ts.sentence_id = s.id
                ORDER BY tr.owner_type, tr.owner_id, tr.position
            )), '') AS translations""",
            "tokens": """COALESCE((SELECT group_concat(surface, ' ') FROM (
                SELECT tok.surface FROM tokens tok
                WHERE tok.sentence_id = s.id ORDER BY tok.position
            )), '') AS tokens""",
            "phonology": """COALESCE((SELECT group_concat(value, ' | ') FROM (
                SELECT p.text AS value FROM phonology p
                JOIN tier_scope_view ts
                  ON ts.owner_type = p.owner_type AND ts.owner_id = p.owner_id
                WHERE ts.sentence_id = s.id
                ORDER BY p.owner_type, p.owner_id, p.position
            )), '') AS phonology""",
            "glosses": """COALESCE((SELECT group_concat(value, ' | ') FROM (
                SELECT tr.text AS value FROM translations tr
                JOIN tier_scope_view ts
                  ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
                WHERE ts.sentence_id = s.id AND tr.owner_type <> 'sentence'
                ORDER BY tr.owner_type, tr.owner_id, tr.position
            )), '') AS glosses""",
            "language_id": "t.language_id AS language_id",
            "corpus_id": "t.corpus_id AS corpus_id",
            "dialect": "t.dialect AS dialect",
            "source_path": "t.source_path AS source_path",
            "audio": """COALESCE((SELECT group_concat(value, ' | ') FROM (
                SELECT COALESCE(NULLIF(a.url, ''), NULLIF(a.file, ''), a.source) AS value
                FROM audio a JOIN tier_scope_view ts
                  ON ts.owner_type = a.owner_type AND ts.owner_id = a.owner_id
                WHERE ts.sentence_id = s.id
                ORDER BY a.owner_type, a.owner_id, a.position
            )), '') AS audio""",
        }
        return ",\n".join(expressions[field] for field in fields)

    def dataset(
        self,
        *,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        q: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
        requirements: Sequence[TierRequirement],
        fields: Sequence[DatasetField],
        max_rows: int,
    ) -> dict[str, Any]:
        if not fields or any(field not in DATASET_FIELDS for field in fields):
            raise ApiError(422, "invalid_parameter", "Choose at least one supported dataset field")
        candidates, clauses, parameters = self._dataset_clauses(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            q=q,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirements,
        )
        where = " AND ".join(clauses) if clauses else "1 = 1"
        prefix = f"WITH candidate_ids AS ({candidates})" if candidates else ""
        source = (
            "candidate_ids candidate JOIN sentences s ON s.id = candidate.sentence_id "
            "JOIN texts t ON t.id = s.parent_id"
            if candidates
            else "sentences s JOIN texts t ON t.id = s.parent_id"
        )
        projection = self._dataset_projection(fields)
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    f"{prefix} SELECT {projection}, COUNT(*) OVER() AS _estimated_rows "
                    f"FROM {source} WHERE {where} "
                    "ORDER BY t.source_path, s.position, s.id LIMIT ?",
                    (*parameters, max_rows),
                )
            ]
        estimated_rows = int(rows[0].pop("_estimated_rows")) if rows else 0
        return {
            "release_id": self.release_id,
            "estimated_rows": estimated_rows,
            "returned_rows": len(rows),
            "truncated": estimated_rows > len(rows),
            "fields": list(fields),
            "items": rows,
        }

    def assert_export_allowed(self, language_id: str, corpus_id: str | None) -> None:
        rights = {item["id"]: item for item in self.metadata("rights").get("entries", [])}
        selected = [
            corpus
            for corpus in self.metadata("corpora")
            if (not corpus_id or corpus["id"] == corpus_id)
            and language_id in corpus.get("languages", [])
        ]
        blocked = [
            corpus["id"]
            for corpus in selected
            if rights.get(corpus.get("rights_id"), {}).get("redistribution") != "allowed"
        ]
        if blocked:
            raise ApiError(
                403,
                "export_not_permitted",
                "The selected scope includes data without reviewed redistribution permission",
            )
