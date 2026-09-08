"""Bounded, batched record expansion. Full records remain available in source XML."""

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from api.errors import ApiError

DETAIL_MAX_ROWS = 2500
DETAIL_MAX_BYTES = 2 * 1024 * 1024
_FIELD_CHARS = 65_536
_TABLES = {"tokens", "words", "morphemes", "forms", "translations", "phonology", "audio"}


@dataclass
class DetailBudget:
    rows: int = DETAIL_MAX_ROWS
    # S forms and translations also appear in convenience fields. Reserve their
    # duplicated JSON space, plus structural keys and the containing record.
    bytes: int = DETAIL_MAX_BYTES // 4
    truncated: bool = False
    columns: dict[str, str] = field(default_factory=dict)

    def take(self, row: sqlite3.Row) -> dict[str, Any] | None:
        item = dict(row)
        for key, value in item.items():
            if isinstance(value, str) and len(value) > _FIELD_CHARS:
                item[key] = value[:_FIELD_CHARS] + "…"
                self.truncated = True
        size = len(json.dumps(item, ensure_ascii=False).encode())
        if not self.rows or size > self.bytes:
            self.truncated = True
            return None
        self.rows -= 1
        self.bytes -= size
        return item


def _rows(
    connection: sqlite3.Connection,
    table: str,
    where: str,
    parameters: tuple,
    order: str,
    budget: DetailBudget,
) -> list[dict[str, Any]]:
    if table not in _TABLES:
        raise ValueError("Unsupported record table")
    # Cap cells in SQLite before allocating Python strings. Table and column names
    # come from this fixed allowlist and the already validated read-model schema.
    if table not in budget.columns:
        budget.columns[table] = ", ".join(
            f'substr(r."{row[1]}",1,{_FIELD_CHARS + 1}) AS "{row[1]}"'
            if row[2].upper() == "TEXT"
            else f'r."{row[1]}"'
            for row in connection.execute(f'PRAGMA table_info("{table}")')
        )
    result = []
    for row in connection.execute(
        f'SELECT {budget.columns[table]} FROM "{table}" r WHERE {where} ORDER BY {order} LIMIT ?',
        (*parameters, budget.rows + 1),
    ):
        item = budget.take(row)
        if item is None:
            break
        if table == "audio":
            try:
                item["playback_urls"] = json.loads(item["playback_urls"])
            except json.JSONDecodeError:
                if not budget.truncated:
                    raise
                item["playback_urls"] = []
        result.append(item)
    return result


def tiers(
    connection: sqlite3.Connection, owners: list[tuple[str, str]], budget: DetailBudget
) -> dict:
    wanted = json.dumps(owners)
    return {
        table: _rows(
            connection,
            table,
            "(r.owner_type,r.owner_id) IN (SELECT json_extract(value,'$[0]'), "
            "json_extract(value,'$[1]') FROM json_each(?))",
            (wanted,),
            "CASE r.owner_type WHEN 'sentence' THEN 0 WHEN 'word' THEN 1 ELSE 2 END, "
            "r.position, r.id",
            budget,
        )
        for table in ("forms", "phonology", "translations", "audio")
    }


def text_detail(connection: sqlite3.Connection, text_id: str) -> dict:
    row = connection.execute("SELECT * FROM texts WHERE id = ?", (text_id,)).fetchone()
    if row is None:
        raise ApiError(404, "text_not_found", "Text not found")
    budget = DetailBudget()
    record = budget.take(row)
    if record is None:
        raise ApiError(422, "record_too_large", "Use the published XML for this record")
    record["tiers"] = tiers(connection, [("text", text_id)], budget)
    record["sentence_count"] = connection.execute(
        "SELECT COUNT(*) FROM sentences WHERE parent_id=?", (text_id,)
    ).fetchone()[0]
    record["detail_truncated"] = budget.truncated
    return record


def sentence_detail(connection: sqlite3.Connection, sentence_id: str) -> dict:
    row = connection.execute(
        "SELECT s.*, t.corpus_id,t.language_id,t.language,t.xml_lang,t.dialect,"
        "t.source_path,t.citation,t.copyright,t.id AS text_id "
        "FROM sentences s JOIN texts t ON t.id=s.parent_id WHERE s.id=?",
        (sentence_id,),
    ).fetchone()
    if row is None:
        raise ApiError(404, "sentence_not_found", "Sentence not found")
    budget = DetailBudget()
    record = budget.take(row)
    if record is None:
        raise ApiError(422, "record_too_large", "Use the published XML for this record")
    expanded = tiers(connection, [("sentence", sentence_id)], budget)
    tokens = _rows(
        connection, "tokens", "r.sentence_id=?", (sentence_id,), "r.position,r.id", budget
    )
    words = _rows(connection, "words", "r.parent_id=?", (sentence_id,), "r.position,r.id", budget)
    word_ids = json.dumps([word["id"] for word in words])
    morphemes = _rows(
        connection,
        "morphemes",
        "r.parent_id IN (SELECT value FROM json_each(?))",
        (word_ids,),
        "r.parent_id,r.position,r.id",
        budget,
    )
    by_word: dict[str, list] = defaultdict(list)
    for item in morphemes:
        by_word[item["parent_id"]].append(item)
    for word in words:
        word["morphemes"] = by_word[word["id"]]
    owners = [
        (kind, item["id"])
        for word in words
        for kind, item in [("word", word), *(("morpheme", m) for m in word["morphemes"])]
    ]
    owner_order = {owner: position for position, owner in enumerate(owners)}
    for table, items in tiers(connection, owners, budget).items():
        expanded[table].extend(
            sorted(
                items,
                key=lambda item: (
                    owner_order[(item["owner_type"], item["owner_id"])],
                    item["position"],
                    item["id"],
                ),
            )
        )
    sentence_forms = [item for item in expanded["forms"] if item["owner_type"] == "sentence"]
    return {
        **record,
        "standard": next(
            (item["text"] for item in sentence_forms if item["kind"] == "standard"), ""
        ),
        "original": next(
            (item["text"] for item in sentence_forms if item["kind"] == "original"), ""
        ),
        "translations": [
            item for item in expanded["translations"] if item["owner_type"] == "sentence"
        ],
        "tier_translations": expanded["translations"],
        "forms": expanded["forms"],
        "phonology": expanded["phonology"],
        "audio": expanded["audio"],
        "tokens": tokens,
        "words": words,
        "detail_truncated": budget.truncated,
    }
