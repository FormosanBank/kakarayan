"""Evidence reads batched over the headwords already selected for one page."""

import json
import sqlite3
from collections.abc import Mapping, Sequence
from typing import Any


def load_evidence(
    connection: sqlite3.Connection,
    headwords: list[str],
    clauses: list[str],
    parameters: list[object],
    translation_language: str | None,
    reverse: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    if not headwords:
        return {}, []
    scope = " AND ".join(clauses)
    rows_by_head = {}
    # Each correlated read stops at 20 indexed attestations. A window over every
    # occurrence of a frequent word would remove that important bound.
    for row in connection.execute(
        f"""SELECT h.value AS headword, (
          SELECT json_group_array(json_object('sentence_id',sentence_id,'owner_id',owner_id,
                 'value',value,'corpus_id',corpus_id)) FROM (
            SELECT tok.sentence_id,tok.word_id AS owner_id,tok.surface AS value,t.corpus_id
            FROM tokens tok JOIN sentences s ON s.id=tok.sentence_id
            JOIN texts t ON t.id=s.parent_id
            WHERE {scope} AND tok.normalized=h.value
            ORDER BY t.source_path,s.position,tok.position LIMIT 20)) AS evidence
        FROM json_each(?) h""",
        (*parameters, json.dumps(headwords)),
    ):
        rows_by_head[row["headword"]] = json.loads(row["evidence"])
    missing = [head for head in headwords if not rows_by_head[head]]
    if missing:
        for row in connection.execute(
            f"""SELECT h.value AS headword, (
              SELECT json_group_array(json_object('sentence_id',sentence_id,'owner_id',owner_id,
                     'value',value,'corpus_id',corpus_id)) FROM (
                SELECT ts.sentence_id,f.owner_id,f.text AS value,t.corpus_id
                FROM forms f JOIN tier_scope_view ts
                  ON ts.owner_type=f.owner_type AND ts.owner_id=f.owner_id
                JOIN sentences s ON s.id=ts.sentence_id JOIN texts t ON t.id=s.parent_id
                WHERE {scope} AND f.owner_type <> 'sentence' AND f.normalized=h.value
                ORDER BY t.source_path,s.position,f.position LIMIT 20)) AS evidence
            FROM json_each(?) h""",
            (*parameters, json.dumps(missing)),
        ):
            rows_by_head[row["headword"]] = json.loads(row["evidence"])
    evidence = {}
    owners: list[tuple[str, str]] = []
    sentences: list[tuple[str, str]] = []
    for head in headwords:
        rows = rows_by_head[head]
        matched = reverse.get(head, ())
        candidates = list(dict.fromkeys(row["sentence_id"] for row in (*matched, *rows)))
        sentence_ids = candidates[:2]
        meaning_rows, seen = [], set()
        for row in matched:
            key = (row["matched_text"], row["matched_xml_lang"])
            if key not in seen:
                seen.add(key)
                meaning_rows.append(
                    {"text": key[0], "xml_lang": key[1], "first_position": row["matched_position"]}
                )
        evidence[head] = {
            "rows": rows,
            "matched": matched,
            "sentence_ids": sentence_ids,
            "truncated": len(candidates) > 2,
            "meanings": meaning_rows,
            "pronunciations": [],
        }
        owners.extend(
            (head, owner)
            for owner in sorted(
                {row["owner_id"] for row in (*matched, *rows) if row.get("owner_id")}
            )
        )
        sentences.extend((head, identifier) for identifier in sentence_ids)
    selected = """WITH wanted AS (
      SELECT json_extract(value,'$[0]') headword,json_extract(value,'$[1]') owner_id
      FROM json_each(?)), owners AS (
      SELECT * FROM wanted UNION SELECT w.headword,m.id FROM wanted w
      JOIN morphemes m ON m.parent_id=w.owner_id)"""
    lang_clause = "AND tr.xml_lang=?" if translation_language else ""
    language_parameters: tuple[object, ...] = (
        (translation_language,) if translation_language else ()
    )
    if owners:
        for row in connection.execute(
            f"""{selected}, meanings AS (
            SELECT o.headword,tr.text,tr.xml_lang,MIN(tr.position) first_position FROM owners o
            JOIN translations tr ON tr.owner_id=o.owner_id
            WHERE tr.text<>'' {lang_clause} GROUP BY o.headword,tr.text,tr.xml_lang),
            ranked AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY headword
              ORDER BY xml_lang,first_position,text) ranking FROM meanings)
            SELECT * FROM ranked WHERE ranking<=13 ORDER BY headword,ranking""",
            (json.dumps(owners), *language_parameters),
        ):
            target = evidence[row["headword"]]["meanings"]
            if not any(
                item["text"] == row["text"] and item["xml_lang"] == row["xml_lang"]
                for item in target
            ):
                target.append(dict(row))
        for row in connection.execute(
            f"""{selected}, pronunciations AS (
              SELECT o.headword,p.text,MIN(p.position) first_position FROM owners o
              JOIN phonology p ON p.owner_id=o.owner_id
              WHERE p.text<>'' GROUP BY o.headword,p.text),
              ranked AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY headword
                ORDER BY first_position,text) ranking FROM pronunciations)
              SELECT * FROM ranked WHERE ranking<=9 ORDER BY headword,ranking""",
            (json.dumps(owners),),
        ):
            evidence[row["headword"]]["pronunciations"].append(row["text"])
    fallback = [
        (head, identifier) for head, identifier in sentences if not evidence[head]["meanings"]
    ]
    if fallback:
        for row in connection.execute(
            f"""WITH wanted AS (SELECT json_extract(value,'$[0]') headword,
              json_extract(value,'$[1]') owner_id FROM json_each(?)), meanings AS (
              SELECT w.headword,tr.text,tr.xml_lang,MIN(tr.position) first_position FROM wanted w
              JOIN translations tr ON tr.owner_type='sentence' AND tr.owner_id=w.owner_id
              WHERE tr.text<>'' {lang_clause} GROUP BY w.headword,tr.text,tr.xml_lang),
              ranked AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY headword
                ORDER BY xml_lang,first_position,text) ranking
              FROM meanings) SELECT * FROM ranked WHERE ranking<=13 ORDER BY headword,ranking""",
            (json.dumps(fallback), *language_parameters),
        ):
            evidence[row["headword"]]["meanings"].append(dict(row))
    identifiers = sorted({identifier for _, identifier in sentences})
    examples = (
        [
            dict(row)
            for row in connection.execute(
                """SELECT s.id,s.parent_id AS text_id,s.xml_id,s.position,s.token_count,
            t.corpus_id,t.language_id,t.language,t.dialect,t.source_path,t.citation
            FROM sentences s JOIN texts t ON t.id=s.parent_id
            WHERE s.id IN (SELECT value FROM json_each(?))
            ORDER BY t.source_path,s.position,s.id""",
                (json.dumps(identifiers),),
            )
        ]
        if identifiers
        else []
    )
    return evidence, examples
