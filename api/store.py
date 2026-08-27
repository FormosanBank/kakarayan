"""Bounded read queries over one validated immutable release."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections import defaultdict
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from queue import Empty, LifoQueue
from typing import Any, Literal

from api.cursors import CursorValue, decode_cursor, encode_cursor, query_fingerprint
from api.dataset_fields import (
    DatasetField,
    DatasetQuery,
    RecordLevel,
    allowed_dataset_fields,
    build_dataset_projection,
    dataset_completeness_clauses,
    discover_translation_columns,
)
from api.errors import ApiError
from api.release import ReleaseState, readonly_connection
from api.search import MatchMode, normalize_surface, normalize_text

SearchDirection = Literal["formosan", "translation"]
FrequencySort = Literal["count", "form"]
TierRequirement = Literal["translation", "audio", "phonology", "interlinear", "unclear"]
QueryWorkload = Literal["interactive", "analytical"]
SUMMARY_FORM_MAX_CHARS = 480
SUMMARY_TRANSLATION_MAX_CHARS = 320
SUMMARY_TRANSLATION_LIMIT = 3
SUMMARY_MATCH_LIMIT = 3
DICTIONARY_EXAMPLE_LIMIT = 2
DICTIONARY_MEANING_LIMIT = 12
DICTIONARY_PRONUNCIATION_LIMIT = 8
DICTIONARY_VALUE_MAX_CHARS = 320


@dataclass
class QueryBudget:
    deadline: float
    cancelled: threading.Event
    workload: QueryWorkload = "interactive"

    @classmethod
    def for_timeout(
        cls,
        seconds: float,
        *,
        workload: QueryWorkload = "interactive",
    ) -> QueryBudget:
        return cls(
            deadline=time.monotonic() + seconds,
            cancelled=threading.Event(),
            workload=workload,
        )

    def cancel(self) -> None:
        self.cancelled.set()

    def interruption_reason(self) -> str | None:
        if self.cancelled.is_set():
            return "cancelled"
        if time.monotonic() >= self.deadline:
            return "timeout"
        return None


_ACTIVE_QUERY_BUDGET: ContextVar[QueryBudget | None] = ContextVar(
    "kakarayan_query_budget", default=None
)


@contextmanager
def use_query_budget(budget: QueryBudget) -> Iterator[None]:
    token = _ACTIVE_QUERY_BUDGET.set(budget)
    try:
        yield
    finally:
        _ACTIVE_QUERY_BUDGET.reset(token)


@dataclass(frozen=True)
class DatasetStream:
    release_id: str
    record_level: RecordLevel
    complete_fields: bool
    estimated_rows: int
    returned_rows: int
    truncated: bool
    fields: tuple[str, ...]
    rows: Iterator[dict[str, Any]]


def _bounded_text(value: object, maximum: int) -> tuple[str, bool]:
    text = str(value)
    if len(text) <= maximum:
        return text, False
    return f"{text[: maximum - 1]}…", True


def _bounded_values(
    values: Sequence[str], *, maximum_items: int, maximum_chars: int
) -> tuple[list[str], bool]:
    result = []
    truncated = len(values) > maximum_items
    for value in values[:maximum_items]:
        bounded, shortened = _bounded_text(value, maximum_chars)
        result.append(bounded)
        truncated = truncated or shortened
    return result, truncated


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
    def __init__(
        self,
        state: ReleaseState,
        query_step_limit: int,
        query_concurrency: int = 4,
        query_queue_wait_seconds: float = 1.0,
        query_timeout_seconds: float = 10.0,
        *,
        analytical_query_concurrency: int = 1,
        sqlite_cache_mib: int = 128,
        sqlite_mmap_mib: int = 2048,
    ) -> None:
        if analytical_query_concurrency > query_concurrency:
            raise ValueError("Analytical query concurrency cannot exceed total concurrency")
        self.state = state
        self.query_step_limit = query_step_limit
        self._query_slots = threading.BoundedSemaphore(query_concurrency)
        self._analytical_slots = threading.BoundedSemaphore(analytical_query_concurrency)
        self.query_queue_wait_seconds = query_queue_wait_seconds
        self.query_timeout_seconds = query_timeout_seconds
        self._connections: LifoQueue[sqlite3.Connection] = LifoQueue(query_concurrency)
        try:
            for _ in range(query_concurrency):
                self._connections.put(
                    readonly_connection(
                        self.state.database_path,
                        cache_mib=sqlite_cache_mib,
                        mmap_mib=sqlite_mmap_mib,
                    )
                )
        except sqlite3.Error:
            self.close()
            raise

    def close(self) -> None:
        while True:
            try:
                connection = self._connections.get_nowait()
            except Empty:
                return
            connection.close()

    def __enter__(self) -> CorpusStore:
        return self

    def __exit__(self, *_error: object) -> None:
        self.close()

    @contextmanager
    def connect(self, budget: QueryBudget | None = None) -> Iterator[sqlite3.Connection]:
        active_budget = budget or _ACTIVE_QUERY_BUDGET.get()
        if active_budget is None:
            active_budget = QueryBudget.for_timeout(self.query_timeout_seconds)
        self.check_ready()
        analytical_acquired = False
        queue_started = time.monotonic()
        if active_budget.workload == "analytical":
            analytical_acquired = self._analytical_slots.acquire(
                timeout=self.query_queue_wait_seconds
            )
            if not analytical_acquired:
                raise ApiError(
                    503,
                    "server_busy",
                    "The analytical query service is busy. Try again shortly.",
                    headers={"Cache-Control": "no-store", "Retry-After": "1"},
                )
        remaining_wait = max(
            0.0,
            self.query_queue_wait_seconds - (time.monotonic() - queue_started),
        )
        query_acquired = self._query_slots.acquire(timeout=remaining_wait)
        if not query_acquired:
            if analytical_acquired:
                self._analytical_slots.release()
            raise ApiError(
                503,
                "server_busy",
                "The query service is busy. Try again shortly.",
                headers={"Cache-Control": "no-store", "Retry-After": "1"},
            )
        connection: sqlite3.Connection | None = None
        interruption_reason: str | None = None
        try:
            try:
                connection = self._connections.get_nowait()
            except Empty as error:
                raise RuntimeError("SQLite connection pool is out of sync") from error
            callbacks = 0

            def progress() -> int:
                nonlocal callbacks, interruption_reason
                callbacks += 1
                interruption_reason = active_budget.interruption_reason()
                if interruption_reason is not None:
                    return 1
                if callbacks > self.query_step_limit:
                    interruption_reason = "work_limit"
                    return 1
                return 0

            connection.set_progress_handler(progress, 1000)
            yield connection
        except sqlite3.OperationalError as error:
            if "interrupted" in str(error).lower():
                if interruption_reason == "cancelled":
                    raise ApiError(
                        408,
                        "query_cancelled",
                        "The query was cancelled.",
                        headers={"Cache-Control": "no-store"},
                    ) from None
                if interruption_reason == "timeout":
                    raise ApiError(
                        504,
                        "query_timed_out",
                        "The query took too long. Narrow the scope and try again.",
                        headers={"Cache-Control": "no-store", "Retry-After": "1"},
                    ) from None
                raise ApiError(
                    422,
                    "query_too_expensive",
                    "The query exceeded the service work limit. Narrow the scope.",
                ) from None
            raise
        finally:
            if connection is not None:
                connection.set_progress_handler(None, 0)
                self._connections.put(connection)
            self._query_slots.release()
            if analytical_acquired:
                self._analytical_slots.release()

    @property
    def release_id(self) -> str:
        return str(self.state.manifest["release_id"])

    def require_release(self, release_id: str) -> None:
        if release_id != self.release_id:
            raise ApiError(404, "release_not_found", "The requested release is not active")

    def check_ready(self) -> None:
        # Startup validates SQLite. Runtime readiness only checks the small active
        # manifest so it never competes with user queries for a database slot.
        try:
            active = json.loads(self.state.manifest_path.read_bytes())
            active_release = active.get("release_id") if isinstance(active, dict) else None
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            active_release = None
        if active_release != self.release_id:
            raise ApiError(
                503,
                "release_mismatch",
                "The active query database changed. Restart with its matching manifest.",
            )

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

    def _candidate_sentences(
        self,
        *,
        normalized: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
    ) -> tuple[str, tuple[object, ...]]:
        table = (
            "formosan_sentence_terms" if direction == "formosan" else "translation_sentence_terms"
        )
        term_clauses = ["term.language_id = ?"]
        term_parameters: list[object] = [language_id]
        if direction == "translation" and translation_language:
            term_clauses.append("term.xml_lang = ?")
            term_parameters.append(translation_language)
        if corpus_id:
            term_clauses.append("t.corpus_id = ?")
            term_parameters.append(corpus_id)
        if dialect:
            term_clauses.append("t.dialect = ?")
            term_parameters.append(dialect)
        match_parameters: tuple[str, ...]
        if match == "contains" and len(normalized) < 3:
            term_clause = "term.normalized LIKE ? ESCAPE '\\'"
            match_parameters = (f"%{_like(normalized)}%",)
        else:
            term_clause, match_parameters = _predicate(
                "term.normalized", normalized, match, direction
            )
        term_clauses.append(term_clause)
        term_parameters.extend(match_parameters)
        return (
            f"""
            SELECT DISTINCT term.sentence_id
            FROM {table} term
            JOIN sentences s ON s.id = term.sentence_id
            JOIN texts t ON t.id = s.parent_id
            WHERE {" AND ".join(term_clauses)}
            """,
            tuple(term_parameters),
        )

    def _candidate_tier_records(
        self,
        *,
        normalized: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
        record_level: Literal["word", "morpheme"],
    ) -> tuple[str, tuple[object, ...]]:
        table = "forms" if direction == "formosan" else "translations"
        predicate, predicate_parameters = _predicate(
            "term.normalized", normalized, match, direction
        )
        clauses = [f"term.owner_type = '{record_level}'", predicate]
        parameters: list[object] = list(predicate_parameters)
        if direction == "translation" and translation_language:
            clauses.append("term.xml_lang = ?")
            parameters.append(translation_language)
        scope_clauses, scope_parameters = self._scope(language_id, corpus_id, dialect)
        clauses.extend(scope_clauses)
        parameters.extend(scope_parameters)
        return (
            f"""
            SELECT DISTINCT term.owner_id AS record_id
            FROM {table} term
            JOIN tier_scope ts
              ON ts.owner_type = term.owner_type AND ts.owner_id = term.owner_id
            JOIN sentences s ON s.id = ts.sentence_id
            JOIN texts t ON t.id = s.parent_id
            WHERE {" AND ".join(clauses)}
            """,
            tuple(parameters),
        )

    @staticmethod
    def _tiers(
        connection: sqlite3.Connection,
        owner_type: str,
        owner_id: str,
    ) -> dict[str, list[dict[str, Any]]]:
        tiers = {
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
        for audio in tiers["audio"]:
            audio["playback_urls"] = json.loads(str(audio["playback_urls"]))
        return tiers

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
        match_evidence: Mapping[str, Sequence[dict[str, Any]]] | None = None,
        match_evidence_truncated: set[str] | None = None,
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

        evidence_by_sentence = match_evidence or {}
        truncated_evidence = match_evidence_truncated or set()
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
            summary_row = dict(row)
            summary_row["citation"], citation_truncated = _bounded_text(
                row.get("citation", ""), 800
            )
            result.append(
                {
                    **summary_row,
                    "standard": standard,
                    "original": original,
                    "translations": summary_translations,
                    "translation_count": len(sentence_translations),
                    "match_evidence": list(evidence_by_sentence.get(identifier, ())),
                    "summary_truncated": (
                        standard_truncated
                        or original_truncated
                        or translation_truncated
                        or citation_truncated
                        or identifier in truncated_evidence
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

    def _reverse_dictionary_evidence(
        self,
        connection: sqlite3.Connection,
        *,
        headword: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        translation_language: str | None,
        query: str,
        match: MatchMode,
    ) -> list[dict[str, Any]]:
        clauses, parameters = self._scope(language_id, corpus_id, dialect)
        if match == "contains" and len(query) < 3:
            match_clause = "tr.normalized LIKE ? ESCAPE '\\'"
            parameters.append(f"%{_like(query)}%")
        else:
            match_clause, match_parameters = _predicate(
                "tr.normalized", query, match, "translation"
            )
            parameters.extend(match_parameters)
        clauses.append(match_clause)
        if translation_language:
            clauses.append("tr.xml_lang = ?")
            parameters.append(translation_language)
        clauses.append(
            "((tr.owner_type <> 'sentence' AND EXISTS ("
            "SELECT 1 FROM forms matched_form "
            "WHERE matched_form.owner_type = tr.owner_type "
            "AND matched_form.owner_id = tr.owner_id "
            "AND matched_form.normalized = ?)) "
            "OR (tr.owner_type = 'word' AND EXISTS ("
            "SELECT 1 FROM tokens matched_token "
            "WHERE matched_token.word_id = tr.owner_id "
            "AND matched_token.normalized = ?)) "
            "OR (tr.owner_type = 'sentence' AND s.token_count = 1 AND EXISTS ("
            "SELECT 1 FROM tokens matched_token "
            "WHERE matched_token.sentence_id = s.id "
            "AND matched_token.normalized = ?)))"
        )
        parameters.extend((headword, headword, headword))
        return [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT ts.sentence_id, tr.owner_id, t.corpus_id,
                       tr.text AS matched_text, tr.xml_lang AS matched_xml_lang,
                       tr.position AS matched_position
                FROM translations tr
                JOIN tier_scope_view ts
                  ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
                JOIN sentences s ON s.id = ts.sentence_id
                JOIN texts t ON t.id = s.parent_id
                WHERE {" AND ".join(clauses)}
                ORDER BY t.source_path, s.position, tr.position, tr.text
                LIMIT ?
                """,
                (*parameters, DICTIONARY_MEANING_LIMIT + 1),
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
        reverse_query: str | None,
        reverse_match: MatchMode,
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
        matched_rows = (
            self._reverse_dictionary_evidence(
                connection,
                headword=headword,
                language_id=language_id,
                corpus_id=corpus_id,
                dialect=dialect,
                translation_language=translation_language,
                query=reverse_query,
                match=reverse_match,
            )
            if reverse_query is not None
            else []
        )
        candidate_sentence_ids = list(
            dict.fromkeys(str(row["sentence_id"]) for row in (*matched_rows, *rows))
        )
        sentence_ids = candidate_sentence_ids[:DICTIONARY_EXAMPLE_LIMIT]
        evidence_truncated = len(candidate_sentence_ids) > DICTIONARY_EXAMPLE_LIMIT
        owner_ids = {str(row["owner_id"]) for row in (*matched_rows, *rows) if row.get("owner_id")}
        if owner_ids:
            placeholders = ",".join("?" for _ in owner_ids)
            owner_ids.update(
                str(row[0])
                for row in connection.execute(
                    f"SELECT id FROM morphemes WHERE parent_id IN ({placeholders})",
                    tuple(owner_ids),
                )
            )
        meaning_rows: list[dict[str, Any]] = []
        seen_meanings: set[tuple[str, str]] = set()
        for row in matched_rows:
            key = (str(row["matched_text"]), str(row["matched_xml_lang"]))
            if key in seen_meanings:
                continue
            seen_meanings.add(key)
            meaning_rows.append(
                {
                    "text": row["matched_text"],
                    "xml_lang": row["matched_xml_lang"],
                    "first_position": row["matched_position"],
                }
            )
        pronunciations: list[str] = []
        if owner_ids:
            placeholders = ",".join("?" for _ in owner_ids)
            language_clause = " AND xml_lang = ?" if translation_language else ""
            language_parameters: tuple[object, ...] = (
                (translation_language,) if translation_language else ()
            )
            related_meanings = [
                dict(row)
                for row in connection.execute(
                    f"SELECT text, xml_lang, MIN(position) AS first_position FROM translations "
                    f"WHERE owner_id IN ({placeholders}){language_clause} AND text <> '' "
                    "GROUP BY text, xml_lang ORDER BY xml_lang, first_position, text LIMIT 13",
                    (*owner_ids, *language_parameters),
                )
            ]
            for row in related_meanings:
                key = (str(row["text"]), str(row["xml_lang"]))
                if key in seen_meanings:
                    continue
                seen_meanings.add(key)
                meaning_rows.append(row)
            pronunciations = [
                str(row[0])
                for row in connection.execute(
                    f"SELECT DISTINCT text FROM phonology WHERE owner_id IN ({placeholders}) "
                    "AND text <> '' ORDER BY position LIMIT 9",
                    tuple(owner_ids),
                )
            ]
        if not meaning_rows and sentence_ids:
            placeholders = ",".join("?" for _ in sentence_ids)
            language_clause = " AND xml_lang = ?" if translation_language else ""
            language_parameters = (translation_language,) if translation_language else ()
            meaning_rows = [
                dict(row)
                for row in connection.execute(
                    f"SELECT text, xml_lang, MIN(position) AS first_position FROM translations "
                    "WHERE owner_type = 'sentence' "
                    f"AND owner_id IN ({placeholders}){language_clause} AND text <> '' "
                    "GROUP BY text, xml_lang ORDER BY xml_lang, first_position, text LIMIT 13",
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
        meanings: list[dict[str, str]] = []
        meanings_truncated = len(meaning_rows) > DICTIONARY_MEANING_LIMIT
        for row in meaning_rows[:DICTIONARY_MEANING_LIMIT]:
            text, shortened = _bounded_text(row["text"], DICTIONARY_VALUE_MAX_CHARS)
            meanings.append({"text": text, "xml_lang": str(row["xml_lang"])})
            meanings_truncated = meanings_truncated or shortened
        evidence_truncated = evidence_truncated or meanings_truncated
        pronunciations, shortened = _bounded_values(
            pronunciations,
            maximum_items=DICTIONARY_PRONUNCIATION_LIMIT,
            maximum_chars=DICTIONARY_VALUE_MAX_CHARS,
        )
        evidence_truncated = evidence_truncated or shortened
        raw_variants = list(dict.fromkeys(str(row["value"]) for row in rows if row.get("value")))
        variants, shortened = _bounded_values(
            raw_variants, maximum_items=8, maximum_chars=DICTIONARY_VALUE_MAX_CHARS
        )
        evidence_truncated = (
            evidence_truncated
            or shortened
            or any(bool(example["summary_truncated"]) for example in examples)
        )
        corpus_ids = list(dict.fromkeys(str(row["corpus_id"]) for row in (*matched_rows, *rows)))
        return {
            "meanings": meanings,
            "pronunciations": pronunciations,
            "variants": variants,
            "corpus_ids": corpus_ids,
            "examples": examples,
            "summary_truncated": evidence_truncated,
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
        if direction == "formosan":
            table, search_column = "dictionary_terms", "d.headword"
        else:
            table, search_column = "reverse_dictionary_terms", "d.normalized"
        clauses = ["d.language_id = ?"]
        parameters: tuple[object, ...] = (language_id,)
        if direction == "translation" and translation_language:
            clauses.append("d.xml_lang = ?")
            parameters += (translation_language,)
        if corpus_id:
            clauses.append("d.corpus_id = ?")
            parameters += (corpus_id,)
        if dialect:
            clauses.append("d.dialect = ?")
            parameters += (dialect,)
        match_parameters: tuple[str, ...]
        if direction == "translation" and match == "contains" and len(normalized) < 3:
            match_clause = "d.normalized LIKE ? ESCAPE '\\'"
            match_parameters = (f"%{_like(normalized)}%",)
        else:
            match_clause, match_parameters = _predicate(search_column, normalized, match, direction)
        clauses.append(match_clause)
        parameters += match_parameters
        if position:
            clauses.append("d.headword > ?")
            parameters += (str(position[0]),)
        sql = f"""
            SELECT d.headword, MIN(d.display_form) AS display_form,
                   SUM(d.occurrences) AS occurrences,
                   COUNT(DISTINCT d.display_form) AS variant_count
            FROM {table} d
            WHERE {" AND ".join(clauses)}
            GROUP BY d.headword
            ORDER BY d.headword LIMIT ?
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
                    reverse_query=normalized if direction == "translation" else None,
                    reverse_match=match,
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
                "(EXISTS (SELECT 1 FROM forms f JOIN tier_scope_view ts "
                "ON ts.owner_type = f.owner_type AND ts.owner_id = f.owner_id "
                "WHERE ts.sentence_id = s.id AND f.unclear > 0) "
                "OR EXISTS (SELECT 1 FROM phonology p JOIN tier_scope_view ts "
                "ON ts.owner_type = p.owner_type AND ts.owner_id = p.owner_id "
                "WHERE ts.sentence_id = s.id AND p.unclear > 0) "
                "OR EXISTS (SELECT 1 FROM translations tr JOIN tier_scope_view ts "
                "ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id "
                "WHERE ts.sentence_id = s.id AND tr.unclear > 0))"
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
            visible_rows = rows[:limit]
            match_evidence, evidence_truncated = self._concordance_match_evidence(
                connection,
                sentence_ids=[str(row["id"]) for row in visible_rows],
                normalized=normalized,
                direction=direction,
                translation_language=translation_language,
                match=match,
            )
            items = self._sentence_summaries(
                connection,
                visible_rows,
                match_evidence,
                evidence_truncated,
            )
        has_more = len(rows) > limit
        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(
                [str(last["source_path"]), int(last["position"]), str(last["id"])],
                fingerprint,
            )
        return {"release_id": self.release_id, "items": items, "next_cursor": next_cursor}

    @staticmethod
    def _concordance_match_evidence(
        connection: sqlite3.Connection,
        *,
        sentence_ids: Sequence[str],
        normalized: str,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
    ) -> tuple[dict[str, list[dict[str, str]]], set[str]]:
        if not sentence_ids:
            return {}, set()
        placeholders = ",".join("?" for _ in sentence_ids)
        if direction == "translation":
            table = "translations"
            alias = "tr"
            field = "translation"
            xml_lang = "tr.xml_lang"
            language_clause = " AND tr.xml_lang = ?" if translation_language else ""
            language_parameters: tuple[object, ...] = (
                (translation_language,) if translation_language else ()
            )
            vocabulary: Literal["formosan", "translation"] = "translation"
        else:
            table = "forms"
            alias = "f"
            field = "form"
            xml_lang = "''"
            language_clause = ""
            language_parameters = ()
            vocabulary = "formosan"
        match_clause, match_parameters = _predicate(
            f"{alias}.normalized", normalized, match, vocabulary
        )
        tier_order = f"CASE {alias}.owner_type WHEN 'sentence' THEN 0 WHEN 'word' THEN 1 ELSE 2 END"
        rows = connection.execute(
            f"""
            SELECT sentence_id, tier, field, text, xml_lang, kind, match_count
            FROM (
              SELECT ts.sentence_id, {alias}.owner_type AS tier, ? AS field,
                     {alias}.text, {xml_lang} AS xml_lang, {alias}.kind,
                     COUNT(*) OVER (PARTITION BY ts.sentence_id) AS match_count,
                     ROW_NUMBER() OVER (
                       PARTITION BY ts.sentence_id
                       ORDER BY {tier_order}, {alias}.position, {alias}.id
                     ) AS match_rank
              FROM {table} {alias}
              JOIN tier_scope_view ts
                ON ts.owner_type = {alias}.owner_type AND ts.owner_id = {alias}.owner_id
              WHERE ts.sentence_id IN ({placeholders})
                {language_clause} AND {match_clause}
            )
            WHERE match_rank <= ?
            ORDER BY sentence_id, match_rank
            """,
            (
                field,
                *sentence_ids,
                *language_parameters,
                *match_parameters,
                SUMMARY_MATCH_LIMIT,
            ),
        )
        evidence: dict[str, list[dict[str, str]]] = defaultdict(list)
        truncated: set[str] = set()
        for raw in rows:
            row = dict(raw)
            sentence_id = str(row["sentence_id"])
            text, shortened = _bounded_text(row["text"], SUMMARY_TRANSLATION_MAX_CHARS)
            evidence[sentence_id].append(
                {
                    "tier": str(row["tier"]),
                    "field": str(row["field"]),
                    "text": text,
                    "xml_lang": str(row["xml_lang"]),
                    "kind": str(row["kind"]),
                }
            )
            if shortened or int(row["match_count"]) > SUMMARY_MATCH_LIMIT:
                truncated.add(sentence_id)
        return dict(evidence), truncated

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
        record_level: RecordLevel,
    ) -> tuple[str | None, list[str], list[object]]:
        normalized = (
            normalize_surface(q or "") if direction == "formosan" else normalize_text(q or "")
        )
        if q is not None and not normalized:
            raise ApiError(422, "invalid_parameter", "The query is empty after normalization")
        if normalized:
            if record_level == "sentence":
                candidates, candidate_parameters = self._candidate_sentences(
                    normalized=normalized,
                    language_id=language_id,
                    corpus_id=corpus_id,
                    dialect=dialect,
                    direction=direction,
                    translation_language=translation_language,
                    match=match,
                )
            else:
                candidates, candidate_parameters = self._candidate_tier_records(
                    normalized=normalized,
                    language_id=language_id,
                    corpus_id=corpus_id,
                    dialect=dialect,
                    direction=direction,
                    translation_language=translation_language,
                    match=match,
                    record_level=record_level,
                )
            clauses: list[str] = []
            parameters = list(candidate_parameters)
        else:
            candidates = None
            clauses, parameters = self._scope(language_id, corpus_id, dialect)
        self._tier_requirements(clauses, requirements)
        return candidates, clauses, parameters

    def _dataset_query(
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
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
    ) -> DatasetQuery:
        supported = allowed_dataset_fields(record_level)
        if not fields or any(field not in supported for field in fields):
            raise ApiError(
                422,
                "invalid_parameter",
                f"Choose supported {record_level} dataset fields",
            )
        if len(fields) != len(set(fields)):
            raise ApiError(422, "invalid_parameter", "Choose each dataset field once")
        candidates, clauses, parameters = self._dataset_clauses(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            q=q,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirements,
            record_level=record_level,
        )
        if complete_fields:
            clauses.extend(dataset_completeness_clauses(record_level, fields))
        where = " AND ".join(clauses) if clauses else "1 = 1"
        prefix = f"WITH candidate_ids AS MATERIALIZED ({candidates})" if candidates else ""
        if candidates:
            source, order = {
                "sentence": (
                    "candidate_ids candidate "
                    "JOIN sentences s ON s.id = candidate.sentence_id "
                    "JOIN texts t ON t.id = s.parent_id",
                    "t.source_path, s.position, s.id",
                ),
                "word": (
                    "candidate_ids candidate JOIN words w ON w.id = candidate.record_id "
                    "JOIN sentences s ON s.id = w.parent_id "
                    "JOIN texts t ON t.id = s.parent_id",
                    "t.source_path, s.position, w.position, w.id",
                ),
                "morpheme": (
                    "candidate_ids candidate JOIN morphemes m ON m.id = candidate.record_id "
                    "JOIN words w ON w.id = m.parent_id "
                    "JOIN sentences s ON s.id = w.parent_id "
                    "JOIN texts t ON t.id = s.parent_id",
                    "t.source_path, s.position, w.position, m.position, m.id",
                ),
            }[record_level]
        else:
            source, order = {
                "sentence": (
                    "sentences s JOIN texts t ON t.id = s.parent_id",
                    "t.source_path, s.position, s.id",
                ),
                "word": (
                    "sentences s JOIN words w ON w.parent_id = s.id "
                    "JOIN texts t ON t.id = s.parent_id",
                    "t.source_path, s.position, w.position, w.id",
                ),
                "morpheme": (
                    "sentences s JOIN words w ON w.parent_id = s.id "
                    "JOIN morphemes m ON m.parent_id = w.id "
                    "JOIN texts t ON t.id = s.parent_id",
                    "t.source_path, s.position, w.position, m.position, m.id",
                ),
            }[record_level]
        return DatasetQuery(
            prefix=prefix,
            source=source,
            where=where,
            order=order,
            parameters=tuple(parameters),
            fields=tuple(fields),
            record_level=record_level,
        )

    def stream_dataset(
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
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
        max_rows: int,
    ) -> DatasetStream:
        budget = _ACTIVE_QUERY_BUDGET.get()
        query = self._dataset_query(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            q=q,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirements,
            fields=fields,
            record_level=record_level,
            complete_fields=complete_fields,
        )
        with self.connect(budget) as connection:
            estimated_rows = int(
                connection.execute(
                    f"{query.prefix} SELECT COUNT(*) FROM {query.source} WHERE {query.where}",
                    query.parameters,
                ).fetchone()[0]
            )
            translation_columns = (
                discover_translation_columns(connection, query, max_rows)
                if "translations" in query.fields
                else ()
            )
        projection = build_dataset_projection(query, translation_columns)

        returned_rows = min(estimated_rows, max_rows)

        def rows() -> Iterator[dict[str, Any]]:
            with self.connect(budget) as connection:
                cursor = connection.execute(
                    f"{query.prefix} SELECT {projection.sql} FROM {query.source} "
                    f"WHERE {query.where} ORDER BY {query.order} LIMIT ?",
                    (*query.parameters, max_rows),
                )
                for row in cursor:
                    yield projection.expand(row)

        return DatasetStream(
            release_id=self.release_id,
            record_level=record_level,
            complete_fields=complete_fields,
            estimated_rows=estimated_rows,
            returned_rows=returned_rows,
            truncated=estimated_rows > returned_rows,
            fields=projection.fields,
            rows=rows(),
        )

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
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
        max_rows: int,
    ) -> dict[str, Any]:
        stream = self.stream_dataset(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            q=q,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirements,
            fields=fields,
            record_level=record_level,
            complete_fields=complete_fields,
            max_rows=max_rows,
        )
        return {
            "release_id": stream.release_id,
            "record_level": stream.record_level,
            "complete_fields": stream.complete_fields,
            "estimated_rows": stream.estimated_rows,
            "returned_rows": stream.returned_rows,
            "truncated": stream.truncated,
            "fields": list(stream.fields),
            "items": list(stream.rows),
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
