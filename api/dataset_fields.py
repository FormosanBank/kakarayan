"""Field and row-level semantics for bounded XML datasets."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

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


def default_dataset_fields(level: RecordLevel) -> tuple[DatasetField, ...]:
    ancestry: tuple[DatasetField, ...]
    if level == "sentence":
        ancestry = ("id", "xml_id", "text_id")
    elif level == "word":
        ancestry = ("id", "xml_id", "sentence_id", "text_id", "position")
    else:
        ancestry = ("id", "xml_id", "word_id", "sentence_id", "text_id", "position")
    return (*ancestry, "form", "translations", "language_id", "corpus_id", "dialect", "source_path")


def allowed_dataset_fields(level: RecordLevel) -> tuple[DatasetField, ...]:
    return DATASET_FIELDS_BY_LEVEL[level]


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


def dataset_expression(level: RecordLevel, field: DatasetField) -> str:
    """Return one level-aware SQLite projection expression."""
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
