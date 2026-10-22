"""Bounded read queries over one validated immutable release."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from queue import Empty, LifoQueue
from typing import Any, Literal

from api.contracts import Summary
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
from api.dictionary_evidence import load_evidence
from api.errors import ApiError
from api.lookup import (
    SearchDirection,
    SearchScope,
    TierRequirement,
    candidate_sentences,
    candidate_tier_records,
    concordance_match_evidence,
    escape_like,
    match_predicate,
    reverse_dictionary_evidence,
    scope_clauses,
    sentence_summaries,
    summarize_dictionary_evidence,
    tier_requirement_clauses,
)
from api.records import sentence_detail, text_detail
from api.release import ReleaseState, readonly_connection
from api.search import MatchMode, normalize_surface, normalize_text

FrequencySort = Literal["count", "form"]
QueryWorkload = Literal["interactive", "analytical"]


@dataclass
class QueryBudget:
    deadline: float
    cancelled: threading.Event
    workload: QueryWorkload = "interactive"
    queue_wait_seconds: float = 0.0
    slot_seconds: float = 0.0

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
                active_budget.queue_wait_seconds += time.monotonic() - queue_started
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
        active_budget.queue_wait_seconds += time.monotonic() - queue_started
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
        slot_started = time.monotonic()
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
            active_budget.slot_seconds += time.monotonic() - slot_started
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

    def text(self, text_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            return text_detail(connection, text_id)

    def sentence(self, sentence_id: str) -> dict[str, Any]:
        """Expand one record within a shared child and byte budget."""
        with self.connect() as connection:
            return sentence_detail(connection, sentence_id)

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
                self.release_id,
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
            match_parameters = (f"%{escape_like(normalized)}%",)
        else:
            match_clause, match_parameters = match_predicate(
                search_column, normalized, match, direction
            )
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
            selected_rows = rows[:limit]
            reverse_evidence = (
                reverse_dictionary_evidence(
                    connection,
                    headwords=[str(row["headword"]) for row in selected_rows],
                    language_id=language_id,
                    corpus_id=corpus_id,
                    dialect=dialect,
                    translation_language=translation_language,
                    query=normalized,
                    match=match,
                )
                if direction == "translation"
                else {}
            )
            evidence_by_head, example_rows = load_evidence(
                connection,
                [str(row["headword"]) for row in selected_rows],
                *scope_clauses(language_id, corpus_id, dialect),
                translation_language,
                reverse_evidence,
            )
            examples_by_id = {
                row["id"]: row
                for row in sentence_summaries(connection, example_rows, query=normalized)
            }
            items = []
            for row in selected_rows:
                headword = str(row["headword"])
                evidence = summarize_dictionary_evidence(
                    evidence_by_head[headword],
                    examples_by_id,
                    normalized,
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
                self.release_id,
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
        candidates, candidate_parameters = candidate_sentences(
            normalized,
            SearchScope(
                language_id=language_id,
                corpus_id=corpus_id,
                dialect=dialect,
                direction=direction,
                translation_language=translation_language,
                match=match,
            ),
        )
        clauses: list[str] = []
        parameters: list[object] = []
        tier_requirement_clauses(clauses, requirements)
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
            match_evidence, evidence_truncated = concordance_match_evidence(
                connection,
                sentence_ids=[str(row["id"]) for row in visible_rows],
                normalized=normalized,
                direction=direction,
                translation_language=translation_language,
                match=match,
            )
            items = sentence_summaries(
                connection,
                visible_rows,
                match_evidence,
                evidence_truncated,
                normalized,
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
            [
                "frequencies",
                self.release_id,
                language_id,
                corpus_id,
                dialect,
                normalized_prefix,
                minimum,
                sort,
            ]
        )
        expected_cursor = 2 if sort == "count" else 1
        position = _cursor_position(cursor, fingerprint, expected_cursor)
        clauses, parameters = scope_clauses(language_id, corpus_id, dialect)
        if normalized_prefix:
            clauses.append("tok.normalized LIKE ? ESCAPE '\\'")
            parameters.append(f"{escape_like(normalized_prefix)}%")
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
        with self.connect() as connection:
            cached = connection.execute(
                "SELECT value_json FROM summary_cache "
                "WHERE language_id = ? AND corpus_id = ? AND dialect = ?",
                (language_id, corpus_id or "", dialect or ""),
            ).fetchone()
        result = Summary.model_validate_json(str(cached[0])) if cached else Summary()
        result.source_frequencies = result.source_frequencies[:limit]
        result.normalized_frequencies = result.normalized_frequencies[:limit]
        result.translation_frequencies = result.translation_frequencies[:limit]
        return {"release_id": self.release_id, **result.model_dump()}

    def _dataset_clauses(
        self, scope: SearchScope, record_level: RecordLevel
    ) -> tuple[str | None, list[str], list[object]]:
        normalize = normalize_surface if scope.direction == "formosan" else normalize_text
        normalized = normalize(scope.q or "")
        if scope.q is not None and not normalized:
            raise ApiError(422, "invalid_parameter", "The query is empty after normalization")
        if normalized:
            candidates, candidate_parameters = (
                candidate_sentences(normalized, scope)
                if record_level == "sentence"
                else candidate_tier_records(normalized, scope, record_level)
            )
            clauses: list[str] = []
            parameters = list(candidate_parameters)
        else:
            candidates = None
            clauses, parameters = scope_clauses(scope.language_id, scope.corpus_id, scope.dialect)
        tier_requirement_clauses(clauses, scope.requirements)
        return candidates, clauses, parameters

    def dataset_query(
        self,
        scope: SearchScope,
        fields: Sequence[DatasetField],
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
    ) -> DatasetQuery:
        self.language(scope.language_id)
        if scope.corpus_id:
            self.corpus(scope.corpus_id)
        supported = allowed_dataset_fields(record_level)
        if not fields or any(field not in supported for field in fields):
            raise ApiError(
                422,
                "invalid_parameter",
                f"Choose supported {record_level} dataset fields",
            )
        if len(fields) != len(set(fields)):
            raise ApiError(422, "invalid_parameter", "Choose each dataset field once")
        candidates, clauses, parameters = self._dataset_clauses(scope, record_level)
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
        scope: SearchScope,
        fields: Sequence[DatasetField],
        *,
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
        max_rows: int,
        schema_rows: int | None = None,
    ) -> DatasetStream:
        budget = _ACTIVE_QUERY_BUDGET.get()
        query = self.dataset_query(scope, fields, record_level, complete_fields)
        with self.connect(budget) as connection:
            estimated_rows = int(
                connection.execute(
                    f"{query.prefix} SELECT COUNT(*) FROM {query.source} WHERE {query.where}",
                    query.parameters,
                ).fetchone()[0]
            )
            translation_columns = (
                discover_translation_columns(connection, query, schema_rows or max_rows)
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
        scope: SearchScope,
        fields: Sequence[DatasetField],
        *,
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
        max_rows: int,
        selection_rows: int | None = None,
    ) -> dict[str, Any]:
        stream = self.stream_dataset(
            scope,
            fields,
            record_level=record_level,
            complete_fields=complete_fields,
            max_rows=min(max_rows, selection_rows or max_rows),
            schema_rows=selection_rows,
        )
        return {
            "release_id": stream.release_id,
            "record_level": stream.record_level,
            "complete_fields": stream.complete_fields,
            "estimated_rows": stream.estimated_rows,
            "selected_rows": min(stream.estimated_rows, selection_rows or max_rows),
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
