"""Shared SQL predicates, scopes, and bounded summaries for corpus lookups."""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from api.dataset_fields import RecordLevel
from api.search import MatchMode, match_snippet

SearchDirection = Literal["formosan", "translation"]
TierRequirement = Literal["translation", "audio", "phonology", "interlinear", "unclear"]
SUMMARY_FORM_MAX_CHARS = 480
SUMMARY_TRANSLATION_MAX_CHARS = 320
SUMMARY_TRANSLATION_LIMIT = 3
SUMMARY_MATCH_LIMIT = 3
DICTIONARY_MEANING_LIMIT = 12
DICTIONARY_PRONUNCIATION_LIMIT = 8
DICTIONARY_VALUE_MAX_CHARS = 320


@dataclass(frozen=True)
class SearchScope:
    """The records a search or dataset selects, before fields, limits, and cursors."""

    language_id: str
    corpus_id: str | None = None
    dialect: str | None = None
    q: str | None = None
    direction: SearchDirection = "formosan"
    translation_language: str | None = None
    match: MatchMode = "exact"
    requirements: tuple[TierRequirement, ...] = ()


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


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def match_predicate(
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
            (f"%{escape_like(query)}%",),
        )
    fts_table = f"{table}_fts"
    phrase = f'"{query.replace(chr(34), chr(34) * 2)}"'
    return (
        f"{column} IN (SELECT v.value FROM {fts_table} search "
        f"JOIN {table} v ON v.rowid = search.rowid WHERE {fts_table} MATCH ?)",
        (phrase,),
    )


def scope_clauses(
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


def candidate_sentences(normalized: str, scope: SearchScope) -> tuple[str, tuple[object, ...]]:
    direction = scope.direction
    table = "formosan_sentence_terms" if direction == "formosan" else "translation_sentence_terms"
    term_clauses = ["term.language_id = ?"]
    term_parameters: list[object] = [scope.language_id]
    if direction == "translation" and scope.translation_language:
        term_clauses.append("term.xml_lang = ?")
        term_parameters.append(scope.translation_language)
    if scope.corpus_id:
        term_clauses.append("t.corpus_id = ?")
        term_parameters.append(scope.corpus_id)
    if scope.dialect:
        term_clauses.append("t.dialect = ?")
        term_parameters.append(scope.dialect)
    match_parameters: tuple[str, ...]
    if scope.match == "contains" and len(normalized) < 3:
        term_clause = "term.normalized LIKE ? ESCAPE '\\'"
        match_parameters = (f"%{escape_like(normalized)}%",)
    else:
        term_clause, match_parameters = match_predicate(
            "term.normalized", normalized, scope.match, direction
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


def candidate_tier_records(
    normalized: str, scope: SearchScope, record_level: RecordLevel
) -> tuple[str, tuple[object, ...]]:
    table = "forms" if scope.direction == "formosan" else "translations"
    predicate, predicate_parameters = match_predicate(
        "term.normalized", normalized, scope.match, scope.direction
    )
    clauses = [f"term.owner_type = '{record_level}'", predicate]
    parameters: list[object] = list(predicate_parameters)
    if scope.direction == "translation" and scope.translation_language:
        clauses.append("term.xml_lang = ?")
        parameters.append(scope.translation_language)
    filters, filter_parameters = scope_clauses(scope.language_id, scope.corpus_id, scope.dialect)
    clauses.extend(filters)
    parameters.extend(filter_parameters)
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


def _forms_by_kind(forms: Sequence[dict[str, Any]]) -> tuple[str, str]:
    standard = next((str(item["text"]) for item in forms if item["kind"] == "standard"), "")
    original = next((str(item["text"]) for item in forms if item["kind"] == "original"), "")
    return standard, original


def sentence_summaries(
    connection: sqlite3.Connection,
    rows: Sequence[dict[str, Any]],
    match_evidence: Mapping[str, Sequence[dict[str, Any]]] | None = None,
    match_evidence_truncated: set[str] | None = None,
    query: str = "",
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
        standard, original = _forms_by_kind(forms[identifier])
        standard, standard_truncated = match_snippet(standard, query, SUMMARY_FORM_MAX_CHARS)
        original, original_truncated = match_snippet(original, query, SUMMARY_FORM_MAX_CHARS)
        sentence_translations = translations[identifier]
        summary_translations = []
        translation_truncated = len(sentence_translations) > SUMMARY_TRANSLATION_LIMIT
        for item in sentence_translations[:SUMMARY_TRANSLATION_LIMIT]:
            summary = dict(item)
            summary["text"], shortened = match_snippet(
                str(item["text"]), query, SUMMARY_TRANSLATION_MAX_CHARS
            )
            translation_truncated = translation_truncated or shortened
            summary_translations.append(summary)
        summary_row = dict(row)
        summary_row["citation"], citation_truncated = _bounded_text(row.get("citation", ""), 800)
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


def reverse_dictionary_evidence(
    connection: sqlite3.Connection,
    *,
    headwords: Sequence[str],
    language_id: str,
    corpus_id: str | None,
    dialect: str | None,
    translation_language: str | None,
    query: str,
    match: MatchMode,
) -> dict[str, list[dict[str, Any]]]:
    if not headwords:
        return {}

    requested = ", ".join("(?)" for _ in headwords)
    term_clauses, term_parameters = scope_clauses(language_id, corpus_id, dialect, alias="d")
    match_parameters: tuple[str, ...]
    if match == "contains" and len(query) < 3:
        match_clause = "d.normalized LIKE ? ESCAPE '\\'"
        match_parameters = (f"%{escape_like(query)}%",)
    else:
        match_clause, match_parameters = match_predicate(
            "d.normalized", query, match, "translation"
        )
    term_clauses.append(match_clause)
    term_parameters.extend(match_parameters)
    if translation_language:
        term_clauses.append("d.xml_lang = ?")
        term_parameters.append(translation_language)
    evidence_clauses, evidence_parameters = scope_clauses(language_id, corpus_id, dialect)
    rows = connection.execute(
        f"""
        WITH requested(headword) AS (VALUES {requested}),
        matched_terms AS MATERIALIZED (
          SELECT DISTINCT d.headword, d.normalized, d.xml_lang
          FROM reverse_dictionary_terms d
          JOIN requested r ON r.headword = d.headword
          WHERE {" AND ".join(term_clauses)}
        ),
        candidates AS (
          SELECT mt.headword, ts.sentence_id, tr.owner_id, t.corpus_id,
                 tr.text AS matched_text, tr.xml_lang AS matched_xml_lang,
                 tr.position AS matched_position, t.source_path,
                 s.position AS sentence_position
          FROM matched_terms mt
          JOIN translations tr
            ON tr.normalized = mt.normalized AND tr.xml_lang = mt.xml_lang
          JOIN tier_scope_view ts
            ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
          JOIN sentences s ON s.id = ts.sentence_id
          JOIN texts t ON t.id = s.parent_id
          WHERE {" AND ".join(evidence_clauses)}
            AND (
              (tr.owner_type <> 'sentence' AND EXISTS (
                SELECT 1 FROM forms matched_form
                WHERE matched_form.owner_type = tr.owner_type
                  AND matched_form.owner_id = tr.owner_id
                  AND matched_form.normalized = mt.headword
              ))
              OR (tr.owner_type = 'word' AND EXISTS (
                SELECT 1 FROM tokens matched_token
                WHERE matched_token.word_id = tr.owner_id
                  AND matched_token.sentence_id = s.id
                  AND matched_token.normalized = mt.headword
              ))
              OR (tr.owner_type = 'sentence' AND s.token_count = 1 AND EXISTS (
                SELECT 1 FROM tokens matched_token
                WHERE matched_token.sentence_id = s.id
                  AND matched_token.normalized = mt.headword
              ))
            )
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY headword
            ORDER BY source_path, sentence_position, matched_position,
                     matched_text, sentence_id, owner_id
          ) AS evidence_rank
          FROM candidates
        )
        SELECT headword, sentence_id, owner_id, corpus_id, matched_text,
               matched_xml_lang, matched_position
        FROM ranked
        WHERE evidence_rank <= ?
        ORDER BY headword, evidence_rank
        """,
        (
            *headwords,
            *term_parameters,
            *evidence_parameters,
            DICTIONARY_MEANING_LIMIT + 1,
        ),
    )
    evidence: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        item = dict(row)
        evidence[str(item.pop("headword"))].append(item)
    return dict(evidence)


def summarize_dictionary_evidence(
    evidence: dict[str, Any],
    examples_by_id: Mapping[str, dict[str, Any]],
    query: str,
) -> dict[str, Any]:
    examples = sorted(
        [examples_by_id[identifier] for identifier in evidence["sentence_ids"]],
        key=lambda row: (row["source_path"], row["position"], row["id"]),
    )
    meaning_rows = evidence["meanings"]
    truncated = evidence["truncated"] or len(meaning_rows) > DICTIONARY_MEANING_LIMIT
    meanings = []
    for row in meaning_rows[:DICTIONARY_MEANING_LIMIT]:
        value, shortened = match_snippet(str(row["text"]), query, DICTIONARY_VALUE_MAX_CHARS)
        meanings.append({"text": value, "xml_lang": str(row["xml_lang"])})
        truncated = truncated or shortened
    pronunciations, shortened = _bounded_values(
        evidence["pronunciations"],
        maximum_items=DICTIONARY_PRONUNCIATION_LIMIT,
        maximum_chars=DICTIONARY_VALUE_MAX_CHARS,
    )
    truncated = truncated or shortened
    rows, matched = evidence["rows"], evidence["matched"]
    raw_variants = list(dict.fromkeys(str(row["value"]) for row in rows if row.get("value")))
    variants, shortened = _bounded_values(
        raw_variants,
        maximum_items=8,
        maximum_chars=DICTIONARY_VALUE_MAX_CHARS,
    )
    return {
        "meanings": meanings,
        "pronunciations": pronunciations,
        "variants": variants,
        "corpus_ids": list(dict.fromkeys(str(row["corpus_id"]) for row in (*matched, *rows))),
        "examples": examples,
        "summary_truncated": truncated
        or shortened
        or any(bool(example["summary_truncated"]) for example in examples),
    }


def tier_requirement_clauses(clauses: list[str], requirements: Sequence[TierRequirement]) -> None:
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


def concordance_match_evidence(
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
    match_parameters: tuple[str, ...]
    if match == "contains":
        # The primary search has already reduced this query to the visible
        # sentence IDs. Scanning their bounded tier rows is substantially
        # cheaper than resolving the global trigram vocabulary again.
        match_clause = f"{alias}.normalized LIKE ? ESCAPE '\\'"
        match_parameters = (f"%{escape_like(normalized)}%",)
    else:
        match_clause, match_parameters = match_predicate(
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
        text, shortened = match_snippet(str(row["text"]), normalized, SUMMARY_TRANSLATION_MAX_CHARS)
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
