"""Bounded read queries over a validated immutable release."""

from __future__ import annotations

import sqlite3
import unicodedata
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Literal

from api.cursors import decode_cursor, encode_cursor, query_fingerprint
from api.errors import ApiError
from api.release import ReleaseState, readonly_connection

MatchMode = Literal["exact", "prefix", "contains"]
SearchField = Literal["form", "translation", "any"]
FrequencySort = Literal["count", "form"]


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold().strip()


def _like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _predicate(column: str, query: str, match: MatchMode) -> tuple[str, str]:
    escaped = _like(query)
    if match == "exact":
        return f"{column} = ?", query
    if match == "prefix":
        return f"{column} LIKE ? ESCAPE '\\'", f"{escaped}%"
    return f"{column} LIKE ? ESCAPE '\\'", f"%{escaped}%"


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


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

    def metadata(self, key: str) -> Any:
        return self.state.metadata[key]

    def downloads(self) -> dict[str, Any]:
        return {
            "schema_version": self.state.manifest["schema_version"],
            "release_id": self.state.manifest["release_id"],
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

    def _tiers(
        self,
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
                connection.execute(
                    "SELECT * FROM texts WHERE id = ?",
                    (text_id,),
                ).fetchone()
            )
            if record is None:
                raise ApiError(404, "text_not_found", "Text not found")
            record["tiers"] = self._tiers(connection, "text", text_id)
            record["sentence_count"] = connection.execute(
                "SELECT COUNT(*) FROM sentences WHERE parent_id = ?",
                (text_id,),
            ).fetchone()[0]
            return record

    def sentence(self, sentence_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            record = _row(
                connection.execute(
                    """
                    SELECT s.*, t.corpus_id, t.language_id, t.language, t.xml_lang,
                           t.dialect, t.source_path, t.citation, t.copyright
                    FROM sentences s
                    JOIN texts t ON t.id = s.parent_id
                    WHERE s.id = ?
                    """,
                    (sentence_id,),
                ).fetchone()
            )
            if record is None:
                raise ApiError(404, "sentence_not_found", "Sentence not found")
            record["tiers"] = self._tiers(connection, "sentence", sentence_id)
            record["tokens"] = [
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
            if len(record["tokens"]) > 1000 or len(words) > 1000:
                raise ApiError(
                    422,
                    "record_too_large",
                    "The sentence exceeds the live API record limit; use a release download.",
                )
            for word in words:
                word["tiers"] = self._tiers(connection, "word", word["id"])
                morphemes = [
                    dict(row)
                    for row in connection.execute(
                        "SELECT * FROM morphemes WHERE parent_id = ? "
                        "ORDER BY position LIMIT 1001",
                        (word["id"],),
                    )
                ]
                if len(morphemes) > 1000:
                    raise ApiError(
                        422,
                        "record_too_large",
                        "The sentence exceeds the live API record limit; use a release download.",
                    )
                for morpheme in morphemes:
                    morpheme["tiers"] = self._tiers(connection, "morpheme", morpheme["id"])
                word["morphemes"] = morphemes
            record["words"] = words
            return record

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

    def dictionary(
        self,
        *,
        q: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        match: MatchMode,
        limit: int,
        cursor: str | None,
    ) -> dict[str, Any]:
        normalized = _normalize(q)
        fingerprint = query_fingerprint(
            ["dictionary", normalized, language_id, corpus_id, dialect, match, limit]
        )
        offset = decode_cursor(cursor, fingerprint)
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        query_clause, query_value = _predicate("tok.normalized", normalized, match)
        clauses.append(query_clause)
        parameters.append(query_value)
        where = " AND ".join(clauses)
        sql = f"""
            SELECT tok.normalized AS headword,
                   MIN(tok.surface) AS display_form,
                   COUNT(*) AS occurrences,
                   COUNT(DISTINCT tok.surface) AS variants,
                   MIN(tok.sentence_id) AS sentence_id
            FROM tokens tok
            JOIN sentences s ON s.id = tok.sentence_id
            JOIN texts t ON t.id = s.parent_id
            WHERE {where}
            GROUP BY tok.normalized
            ORDER BY tok.normalized, display_form
            LIMIT ? OFFSET ?
        """
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    sql,
                    (*parameters, limit + 1, offset),
                )
            ]
        has_more = len(rows) > limit
        return {
            "items": rows[:limit],
            "next_cursor": encode_cursor(offset + limit, fingerprint) if has_more else None,
        }

    def concordance(
        self,
        *,
        q: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        field: SearchField,
        match: MatchMode,
        limit: int,
        cursor: str | None,
    ) -> dict[str, Any]:
        normalized = _normalize(q)
        fingerprint = query_fingerprint(
            [
                "concordance",
                normalized,
                language_id,
                corpus_id,
                dialect,
                field,
                match,
                limit,
            ]
        )
        offset = decode_cursor(cursor, fingerprint)
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        form_clause, form_value = _predicate("f.normalized", normalized, match)
        token_clause, token_value = _predicate("tok.normalized", normalized, match)
        translation_clause, translation_value = _predicate("tr.normalized", normalized, match)
        alternatives: list[str] = []
        if field in {"form", "any"}:
            alternatives.append(
                "(EXISTS (SELECT 1 FROM tokens tok WHERE tok.sentence_id = s.id "
                f"AND {token_clause}) OR "
                "EXISTS (SELECT 1 FROM forms f WHERE f.owner_type = 'sentence' "
                f"AND f.owner_id = s.id AND {form_clause}))"
            )
            parameters.extend((token_value, form_value))
        if field in {"translation", "any"}:
            alternatives.append(
                "EXISTS (SELECT 1 FROM translations tr WHERE tr.owner_type = 'sentence' "
                f"AND tr.owner_id = s.id AND {translation_clause})"
            )
            parameters.append(translation_value)
        clauses.append(f"({' OR '.join(alternatives)})")
        where = " AND ".join(clauses)
        sql = f"""
            SELECT s.id, s.xml_id, s.position, s.audio_url, s.token_count,
                   t.id AS text_id, t.corpus_id, t.language_id, t.language,
                   t.dialect, t.source_path, t.citation
            FROM sentences s
            JOIN texts t ON t.id = s.parent_id
            WHERE {where}
            ORDER BY t.source_path, s.position, s.id
            LIMIT ? OFFSET ?
        """
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    sql,
                    (*parameters, limit + 1, offset),
                )
            ]
            for row in rows[:limit]:
                row["tiers"] = self._tiers(connection, "sentence", row["id"])
        has_more = len(rows) > limit
        return {
            "items": rows[:limit],
            "next_cursor": encode_cursor(offset + limit, fingerprint) if has_more else None,
        }

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
        normalized_prefix = _normalize(prefix or "")
        fingerprint = query_fingerprint(
            [
                "frequencies",
                language_id,
                corpus_id,
                dialect,
                normalized_prefix,
                minimum,
                sort,
                limit,
            ]
        )
        offset = decode_cursor(cursor, fingerprint)
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        if normalized_prefix:
            clauses.append("tok.normalized LIKE ? ESCAPE '\\'")
            parameters.append(f"{_like(normalized_prefix)}%")
        order = (
            "occurrences DESC, tok.normalized ASC"
            if sort == "count"
            else "tok.normalized ASC, occurrences DESC"
        )
        sql = f"""
            SELECT tok.normalized AS form,
                   MIN(tok.surface) AS display_form,
                   COUNT(*) AS occurrences
            FROM tokens tok
            JOIN sentences s ON s.id = tok.sentence_id
            JOIN texts t ON t.id = s.parent_id
            WHERE {' AND '.join(clauses)}
            GROUP BY tok.normalized
            HAVING COUNT(*) >= ?
            ORDER BY {order}
            LIMIT ? OFFSET ?
        """
        with self.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    sql,
                    (*parameters, minimum, limit + 1, offset),
                )
            ]
        has_more = len(rows) > limit
        return {
            "items": rows[:limit],
            "next_cursor": encode_cursor(offset + limit, fingerprint) if has_more else None,
        }
