"""Shared field semantics for bounded sentence datasets."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, Literal

DatasetField = Literal[
    "id",
    "text_id",
    "standard",
    "original",
    "translations",
    "tokens",
    "phonology",
    "glosses",
    "word_translations",
    "morpheme_translations",
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
    "word_translations",
    "morpheme_translations",
    "language_id",
    "corpus_id",
    "dialect",
    "source_path",
    "audio",
)

_SQL_EXPRESSIONS: dict[DatasetField, str] = {
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
        WHERE tr.owner_type = 'sentence' AND tr.owner_id = s.id
        ORDER BY tr.position
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
    "word_translations": """COALESCE((SELECT '[' || group_concat(value, ',') || ']' FROM (
        SELECT json_object(
          'word_id', w.id,
          'word_position', w.position,
          'form', COALESCE((
            SELECT f.text FROM forms f
            WHERE f.owner_type = 'word' AND f.owner_id = w.id
            ORDER BY CASE f.kind WHEN 'standard' THEN 0 WHEN 'original' THEN 1
                     WHEN 'alternate' THEN 2 ELSE 3 END, f.position LIMIT 1
          ), ''),
          'translation_position', tr.position,
          'xml_lang', tr.xml_lang,
          'text', tr.text,
          'kind', tr.kind
        ) AS value
        FROM translations tr JOIN words w ON w.id = tr.owner_id
        WHERE tr.owner_type = 'word' AND w.parent_id = s.id
        ORDER BY w.position, tr.position
    )), '[]') AS word_translations""",
    "morpheme_translations": """COALESCE((SELECT '[' || group_concat(value, ',') || ']' FROM (
        SELECT json_object(
          'word_id', w.id,
          'word_position', w.position,
          'morpheme_id', m.id,
          'morpheme_position', m.position,
          'form', COALESCE((
            SELECT f.text FROM forms f
            WHERE f.owner_type = 'morpheme' AND f.owner_id = m.id
            ORDER BY CASE f.kind WHEN 'standard' THEN 0 WHEN 'original' THEN 1
                     WHEN 'alternate' THEN 2 ELSE 3 END, f.position LIMIT 1
          ), ''),
          'translation_position', tr.position,
          'xml_lang', tr.xml_lang,
          'text', tr.text,
          'kind', tr.kind
        ) AS value
        FROM translations tr
        JOIN morphemes m ON m.id = tr.owner_id
        JOIN words w ON w.id = m.parent_id
        WHERE tr.owner_type = 'morpheme' AND w.parent_id = s.id
        ORDER BY w.position, m.position, tr.position
    )), '[]') AS morpheme_translations""",
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


def dataset_projection(fields: Sequence[DatasetField]) -> str:
    """Return the ordered SQLite projection for the public dataset fields."""
    return ",\n".join(_SQL_EXPRESSIONS[field] for field in fields)


def _selected_form(forms: Sequence[Mapping[str, Any]]) -> str:
    by_kind: dict[str, str] = {}
    for item in forms:
        if item["text"]:
            by_kind.setdefault(str(item["kind"]), str(item["text"]))
    return by_kind.get("standard") or by_kind.get("original") or by_kind.get("alternate") or ""


def _owner_rows(
    record: Mapping[str, Any],
    owner: Mapping[str, Any],
    owner_type: str,
    table: str,
) -> Sequence[Mapping[str, Any]]:
    tiers = owner.get("tiers")
    if isinstance(tiers, Mapping):
        rows = tiers.get(table)
        if isinstance(rows, Sequence):
            return rows
    source = "tier_translations" if table == "translations" else table
    return [
        item
        for item in record[source]
        if item["owner_type"] == owner_type and item["owner_id"] == owner["id"]
    ]


def _record_value(record: Mapping[str, Any], field: DatasetField) -> object:
    if field == "translations":
        return " | ".join(f"{item['xml_lang']}:{item['text']}" for item in record["translations"])
    if field == "tokens":
        return " ".join(item["surface"] for item in record["tokens"])
    if field == "phonology":
        return " | ".join(item["text"] for item in record["phonology"])
    if field == "glosses":
        return " | ".join(
            item["text"] for item in record["tier_translations"] if item["owner_type"] != "sentence"
        )
    if field == "word_translations":
        values = []
        for word in record["words"]:
            form = _selected_form(_owner_rows(record, word, "word", "forms"))
            for translation in _owner_rows(record, word, "word", "translations"):
                values.append(
                    {
                        "word_id": word["id"],
                        "word_position": word["position"],
                        "form": form,
                        "translation_position": translation["position"],
                        "xml_lang": translation["xml_lang"],
                        "text": translation["text"],
                        "kind": translation["kind"],
                    }
                )
        return json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    if field == "morpheme_translations":
        values = []
        for word in record["words"]:
            for morpheme in word["morphemes"]:
                form = _selected_form(_owner_rows(record, morpheme, "morpheme", "forms"))
                for translation in _owner_rows(record, morpheme, "morpheme", "translations"):
                    values.append(
                        {
                            "word_id": word["id"],
                            "word_position": word["position"],
                            "morpheme_id": morpheme["id"],
                            "morpheme_position": morpheme["position"],
                            "form": form,
                            "translation_position": translation["position"],
                            "xml_lang": translation["xml_lang"],
                            "text": translation["text"],
                            "kind": translation["kind"],
                        }
                    )
        return json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    if field == "audio":
        return " | ".join(item["url"] or item["file"] or item["source"] for item in record["audio"])
    return record[field]


def project_record(record: Mapping[str, Any], fields: Sequence[DatasetField]) -> dict[str, object]:
    """Serialize one nested sentence under the same public field contract."""
    return {field: _record_value(record, field) for field in fields}
