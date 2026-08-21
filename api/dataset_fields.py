"""Field and row-level semantics for bounded XML datasets."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, Literal

RecordLevel = Literal["sentence", "word", "morpheme"]
RECORD_LEVELS: tuple[RecordLevel, ...] = ("sentence", "word", "morpheme")

DatasetField = Literal[
    "id",
    "xml_id",
    "parent_id",
    "text_id",
    "sentence_id",
    "word_id",
    "position",
    "form",
    "standard",
    "original",
    "alternate_forms",
    "translations",
    "tokens",
    "token_count",
    "phonology",
    "class",
    "sclass",
    "source",
    "unclear",
    "language_id",
    "corpus_id",
    "dialect",
    "source_path",
    "audio",
    # Accepted for backward-compatible sentence recipes and API calls.
    "glosses",
    "word_translations",
    "morpheme_translations",
]

DATASET_FIELDS_BY_LEVEL: dict[RecordLevel, tuple[DatasetField, ...]] = {
    "sentence": (
        "id",
        "xml_id",
        "text_id",
        "position",
        "form",
        "standard",
        "original",
        "alternate_forms",
        "translations",
        "tokens",
        "token_count",
        "phonology",
        "source",
        "unclear",
        "language_id",
        "corpus_id",
        "dialect",
        "source_path",
        "audio",
    ),
    "word": (
        "id",
        "xml_id",
        "parent_id",
        "sentence_id",
        "text_id",
        "position",
        "form",
        "standard",
        "original",
        "alternate_forms",
        "translations",
        "phonology",
        "class",
        "sclass",
        "unclear",
        "language_id",
        "corpus_id",
        "dialect",
        "source_path",
        "audio",
    ),
    "morpheme": (
        "id",
        "xml_id",
        "parent_id",
        "word_id",
        "sentence_id",
        "text_id",
        "position",
        "form",
        "standard",
        "original",
        "alternate_forms",
        "translations",
        "phonology",
        "class",
        "sclass",
        "unclear",
        "language_id",
        "corpus_id",
        "dialect",
        "source_path",
        "audio",
    ),
}

LEGACY_SENTENCE_FIELDS: tuple[DatasetField, ...] = (
    "glosses",
    "word_translations",
    "morpheme_translations",
)
DATASET_FIELDS: tuple[DatasetField, ...] = tuple(
    dict.fromkeys(
        field
        for fields in (*DATASET_FIELDS_BY_LEVEL.values(), LEGACY_SENTENCE_FIELDS)
        for field in fields
    )
)


def default_dataset_fields(level: RecordLevel) -> tuple[DatasetField, ...]:
    ancestry: tuple[DatasetField, ...]
    if level == "sentence":
        ancestry = ("id", "xml_id", "text_id")
    elif level == "word":
        ancestry = ("id", "xml_id", "sentence_id", "text_id", "position")
    else:
        ancestry = ("id", "xml_id", "word_id", "sentence_id", "text_id", "position")
    return (*ancestry, "form", "translations", "language_id", "corpus_id", "dialect", "source_path")


def allowed_dataset_fields(
    level: RecordLevel, *, include_legacy: bool = False
) -> tuple[DatasetField, ...]:
    fields = DATASET_FIELDS_BY_LEVEL[level]
    if level == "sentence" and include_legacy:
        return (*fields, *LEGACY_SENTENCE_FIELDS)
    return fields


def _owner(level: RecordLevel) -> tuple[str, str]:
    return {
        "sentence": ("sentence", "s"),
        "word": ("word", "w"),
        "morpheme": ("morpheme", "m"),
    }[level]


def _tier_text(table: str, owner_type: str, owner_alias: str, *, kind: str | None = None) -> str:
    kind_clause = f" AND tier.kind = '{kind}'" if kind else ""
    return f"""COALESCE((
        SELECT tier.text FROM {table} tier
        WHERE tier.owner_type = '{owner_type}' AND tier.owner_id = {owner_alias}.id{kind_clause}
        ORDER BY tier.position LIMIT 1
    ), '')"""


def _tier_values(
    table: str,
    owner_type: str,
    owner_alias: str,
    value: str,
    *,
    kind: str | None = None,
) -> str:
    kind_clause = f" AND tier.kind = '{kind}'" if kind else ""
    return f"""COALESCE((SELECT group_concat(value, ' | ') FROM (
        SELECT {value} AS value FROM {table} tier
        WHERE tier.owner_type = '{owner_type}' AND tier.owner_id = {owner_alias}.id{kind_clause}
        ORDER BY tier.position
    )), '')"""


def _legacy_sentence_expression(field: DatasetField) -> str:
    if field == "glosses":
        return """COALESCE((SELECT group_concat(value, ' | ') FROM (
            SELECT tr.text AS value FROM translations tr
            JOIN tier_scope_view ts
              ON ts.owner_type = tr.owner_type AND ts.owner_id = tr.owner_id
            WHERE ts.sentence_id = s.id AND tr.owner_type <> 'sentence'
            ORDER BY tr.owner_type, tr.owner_id, tr.position
        )), '') AS glosses"""
    if field == "word_translations":
        return """COALESCE((SELECT '[' || group_concat(value, ',') || ']' FROM (
            SELECT json_object(
              'word_id', w_child.id,
              'word_position', w_child.position,
              'form', COALESCE((
                SELECT f.text FROM forms f
                WHERE f.owner_type = 'word' AND f.owner_id = w_child.id
                ORDER BY CASE f.kind WHEN 'standard' THEN 0 WHEN 'original' THEN 1
                         WHEN 'alternate' THEN 2 ELSE 3 END, f.position LIMIT 1
              ), ''),
              'translation_position', tr.position,
              'xml_lang', tr.xml_lang,
              'text', tr.text,
              'kind', tr.kind
            ) AS value
            FROM translations tr JOIN words w_child ON w_child.id = tr.owner_id
            WHERE tr.owner_type = 'word' AND w_child.parent_id = s.id
            ORDER BY w_child.position, tr.position
        )), '[]') AS word_translations"""
    if field == "morpheme_translations":
        return """COALESCE((SELECT '[' || group_concat(value, ',') || ']' FROM (
            SELECT json_object(
              'word_id', w_child.id,
              'word_position', w_child.position,
              'morpheme_id', m_child.id,
              'morpheme_position', m_child.position,
              'form', COALESCE((
                SELECT f.text FROM forms f
                WHERE f.owner_type = 'morpheme' AND f.owner_id = m_child.id
                ORDER BY CASE f.kind WHEN 'standard' THEN 0 WHEN 'original' THEN 1
                         WHEN 'alternate' THEN 2 ELSE 3 END, f.position LIMIT 1
              ), ''),
              'translation_position', tr.position,
              'xml_lang', tr.xml_lang,
              'text', tr.text,
              'kind', tr.kind
            ) AS value
            FROM translations tr
            JOIN morphemes m_child ON m_child.id = tr.owner_id
            JOIN words w_child ON w_child.id = m_child.parent_id
            WHERE tr.owner_type = 'morpheme' AND w_child.parent_id = s.id
            ORDER BY w_child.position, m_child.position, tr.position
        )), '[]') AS morpheme_translations"""
    raise KeyError(field)


def dataset_expression(level: RecordLevel, field: DatasetField) -> str:
    """Return one level-aware SQLite projection expression."""
    if field in LEGACY_SENTENCE_FIELDS:
        if level != "sentence":
            raise KeyError(field)
        return _legacy_sentence_expression(field)

    owner_type, alias = _owner(level)
    simple = {
        "id": f"{alias}.id",
        "xml_id": f"{alias}.xml_id",
        "parent_id": f"{alias}.parent_id",
        "text_id": "s.parent_id",
        "sentence_id": "s.id",
        "word_id": "w.id",
        "position": f"{alias}.position",
        "class": f"{alias}.class",
        "sclass": f"{alias}.sclass",
        "source": "s.source",
        "token_count": "s.token_count",
        "language_id": "t.language_id",
        "corpus_id": "t.corpus_id",
        "dialect": "t.dialect",
        "source_path": "t.source_path",
    }
    if field in simple:
        return f"{simple[field]} AS {field}"
    if field == "form":
        value = f"""COALESCE((
            SELECT f.text FROM forms f
            WHERE f.owner_type = '{owner_type}' AND f.owner_id = {alias}.id
            ORDER BY CASE f.kind WHEN 'standard' THEN 0 WHEN 'original' THEN 1
                     WHEN 'alternate' THEN 2 ELSE 3 END, f.position LIMIT 1
        ), '')"""
    elif field in {"standard", "original"}:
        value = _tier_text("forms", owner_type, alias, kind=field)
    elif field == "alternate_forms":
        value = _tier_values("forms", owner_type, alias, "tier.text", kind="alternate")
    elif field == "translations":
        value = _tier_values(
            "translations",
            owner_type,
            alias,
            "COALESCE(NULLIF(tier.xml_lang, ''), 'und') || ':' || tier.text",
        )
    elif field == "tokens":
        value = """COALESCE((SELECT group_concat(surface, ' ') FROM (
            SELECT tok.surface FROM tokens tok
            WHERE tok.sentence_id = s.id ORDER BY tok.position
        )), '')"""
    elif field == "phonology":
        value = _tier_values("phonology", owner_type, alias, "tier.text")
    elif field == "unclear":
        value = f"""CASE WHEN
            EXISTS (SELECT 1 FROM forms f WHERE f.owner_type = '{owner_type}'
                    AND f.owner_id = {alias}.id AND f.unclear > 0)
            OR EXISTS (SELECT 1 FROM phonology p WHERE p.owner_type = '{owner_type}'
                       AND p.owner_id = {alias}.id AND p.unclear > 0)
            OR EXISTS (SELECT 1 FROM translations tr WHERE tr.owner_type = '{owner_type}'
                       AND tr.owner_id = {alias}.id AND tr.unclear > 0)
            THEN 1 ELSE 0 END"""
    elif field == "audio":
        value = f"""COALESCE((SELECT '[' || group_concat(value, ',') || ']' FROM (
            SELECT json_object(
              'file', a.file, 'url', a.url, 'start', a.start, 'end', a.end,
              'source', a.source, 'availability_status', a.availability_status
            ) AS value
            FROM audio a
            WHERE a.owner_type = '{owner_type}' AND a.owner_id = {alias}.id
            ORDER BY a.position
        )), '[]')"""
    else:
        raise KeyError(field)
    return f"{value} AS {field}"


def dataset_projection(level: RecordLevel, fields: Sequence[DatasetField]) -> str:
    """Return the ordered SQLite projection for one XML level."""
    return ",\n".join(dataset_expression(level, field) for field in fields)


def dataset_completeness_clauses(level: RecordLevel, fields: Sequence[DatasetField]) -> list[str]:
    """Require optional selected fields to contain owner-level evidence."""
    owner_type, alias = _owner(level)
    clauses: list[str] = []
    for field in fields:
        if field == "form":
            clauses.append(
                f"EXISTS (SELECT 1 FROM forms f WHERE f.owner_type = '{owner_type}' "
                f"AND f.owner_id = {alias}.id)"
            )
        elif field in {"standard", "original"}:
            clauses.append(
                f"EXISTS (SELECT 1 FROM forms f WHERE f.owner_type = '{owner_type}' "
                f"AND f.owner_id = {alias}.id AND f.kind = '{field}')"
            )
        elif field == "alternate_forms":
            clauses.append(
                f"EXISTS (SELECT 1 FROM forms f WHERE f.owner_type = '{owner_type}' "
                f"AND f.owner_id = {alias}.id AND f.kind = 'alternate')"
            )
        elif field == "translations":
            clauses.append(
                f"EXISTS (SELECT 1 FROM translations tr WHERE tr.owner_type = '{owner_type}' "
                f"AND tr.owner_id = {alias}.id)"
            )
        elif field == "phonology":
            clauses.append(
                f"EXISTS (SELECT 1 FROM phonology p WHERE p.owner_type = '{owner_type}' "
                f"AND p.owner_id = {alias}.id)"
            )
        elif field == "audio":
            clauses.append(
                f"EXISTS (SELECT 1 FROM audio a WHERE a.owner_type = '{owner_type}' "
                f"AND a.owner_id = {alias}.id)"
            )
        elif field == "unclear":
            expression = dataset_expression(level, "unclear").removesuffix(" AS unclear")
            clauses.append(f"({expression}) = 1")
        elif field in {"class", "sclass", "source"}:
            column = dataset_expression(level, field).removesuffix(f" AS {field}")
            clauses.append(f"COALESCE({column}, '') <> ''")
        elif field == "tokens":
            clauses.append("EXISTS (SELECT 1 FROM tokens tok WHERE tok.sentence_id = s.id)")
    return clauses


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
    """Serialize legacy sentence recipes from hierarchical release records."""
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
    """Serialize one legacy nested sentence recipe."""
    return {field: _record_value(record, field) for field in fields}
