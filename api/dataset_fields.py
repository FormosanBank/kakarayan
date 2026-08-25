"""Field and row-level semantics for bounded XML datasets."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from api.errors import ApiError

RecordLevel = Literal["sentence", "word", "morpheme"]
RECORD_LEVELS: tuple[RecordLevel, ...] = ("sentence", "word", "morpheme")
DATASET_TRANSLATION_COLUMN_LIMIT = 256


def translation_column_name(xml_lang: str, occurrence: int) -> str:
    return f"translation_{xml_lang}_{occurrence}"


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


@dataclass(frozen=True)
class DatasetQuery:
    prefix: str
    source: str
    where: str
    order: str
    parameters: tuple[object, ...]
    fields: tuple[DatasetField, ...]
    record_level: RecordLevel


@dataclass(frozen=True)
class TranslationColumn:
    xml_lang: str
    occurrence: int
    name: str


@dataclass(frozen=True)
class DatasetProjection:
    sql: str
    fields: tuple[str, ...]
    translation_columns: tuple[TranslationColumn, ...]

    def expand(self, row: sqlite3.Row) -> dict[str, Any]:
        values = dict(row)
        if not self.translation_columns:
            return values
        serialized_translations = values.pop("__translations", "[]")
        result = {field: values.get(field, "") for field in self.fields}
        occurrences: dict[str, int] = defaultdict(int)
        for translation in json.loads(serialized_translations):
            xml_lang = str(translation["xml_lang"])
            occurrences[xml_lang] += 1
            field = translation_column_name(xml_lang, occurrences[xml_lang])
            if field in result:
                result[field] = translation["text"]
        return result


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


def dataset_owner(level: RecordLevel) -> tuple[str, str]:
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
    owner_type, alias = dataset_owner(level)
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
        raise KeyError("translations must be expanded for the selected rows")
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


def translation_values_expression(level: RecordLevel) -> str:
    """Return ordered owner-level TRANSL values for streaming wide-column expansion."""
    owner_type, alias = dataset_owner(level)
    return f"""COALESCE((
        SELECT json_group_array(json_object('xml_lang', ordered.xml_lang, 'text', ordered.text))
        FROM (
            SELECT COALESCE(NULLIF(tier.xml_lang, ''), 'und') AS xml_lang, tier.text
            FROM translations tier
            WHERE tier.owner_type = '{owner_type}' AND tier.owner_id = {alias}.id
            ORDER BY tier.position, tier.id
        ) ordered
    ), '[]') AS __translations"""


def discover_translation_columns(
    connection: sqlite3.Connection,
    query: DatasetQuery,
    max_rows: int,
) -> tuple[TranslationColumn, ...]:
    """Discover TRANSL columns in the exact ordered row window being returned."""
    owner_type, owner_alias = dataset_owner(query.record_level)
    with_clause = f"{query.prefix}," if query.prefix else "WITH"
    rows = connection.execute(
        f"""
        {with_clause} selected_owners AS MATERIALIZED (
          SELECT {owner_alias}.id AS owner_id
          FROM {query.source}
          WHERE {query.where}
          ORDER BY {query.order}
          LIMIT ?
        ), ranked AS (
          SELECT COALESCE(NULLIF(tr.xml_lang, ''), 'und') AS xml_lang,
                 ROW_NUMBER() OVER (
                   PARTITION BY tr.owner_id, COALESCE(NULLIF(tr.xml_lang, ''), 'und')
                   ORDER BY tr.position, tr.id
                 ) AS occurrence
          FROM translations tr
          JOIN selected_owners selected ON selected.owner_id = tr.owner_id
          WHERE tr.owner_type = ?
        )
        SELECT xml_lang, MAX(occurrence) AS occurrences
        FROM ranked
        GROUP BY xml_lang
        ORDER BY xml_lang
        """,
        (*query.parameters, max_rows, owner_type),
    ).fetchall()
    columns: list[TranslationColumn] = []
    for row in rows:
        xml_lang = str(row["xml_lang"])
        occurrences = int(row["occurrences"])
        if len(columns) + occurrences > DATASET_TRANSLATION_COLUMN_LIMIT:
            raise ApiError(
                422,
                "dataset_too_wide",
                "The selected rows contain more than "
                f"{DATASET_TRANSLATION_COLUMN_LIMIT} TRANSL columns",
            )
        columns.extend(
            TranslationColumn(
                xml_lang=xml_lang,
                occurrence=occurrence,
                name=translation_column_name(xml_lang, occurrence),
            )
            for occurrence in range(1, occurrences + 1)
        )
    if not columns:
        columns.append(
            TranslationColumn(
                xml_lang="und",
                occurrence=1,
                name="translation_und_1",
            )
        )
    return tuple(columns)


def build_dataset_projection(
    query: DatasetQuery,
    translation_columns: tuple[TranslationColumn, ...],
) -> DatasetProjection:
    """Build SQL and public field order for one dataset response."""
    expressions: list[str] = []
    fields: list[str] = []
    for field in query.fields:
        if field == "translations":
            expressions.append(translation_values_expression(query.record_level))
            fields.extend(column.name for column in translation_columns)
        else:
            expressions.append(dataset_expression(query.record_level, field))
            fields.append(field)
    return DatasetProjection(
        sql=",\n".join(expressions),
        fields=tuple(fields),
        translation_columns=translation_columns,
    )


def dataset_completeness_clauses(level: RecordLevel, fields: Sequence[DatasetField]) -> list[str]:
    """Require optional selected fields to contain owner-level evidence."""
    owner_type, alias = dataset_owner(level)
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
