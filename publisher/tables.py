"""Relational table contracts shared by JSONL, CSV, and SQLite output."""

from __future__ import annotations

TABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "texts": (
        "id",
        "corpus_id",
        "language_id",
        "language",
        "xml_lang",
        "dialect",
        "xml_id",
        "source_path",
        "source_sha256",
        "citation",
        "bibtex_citation",
        "copyright",
        "source",
        "audio_mode",
        "glottocode",
    ),
    "sentences": (
        "id",
        "parent_id",
        "xml_id",
        "position",
        "audio_url",
        "source",
        "token_count",
    ),
    "words": ("id", "parent_id", "xml_id", "position", "class", "sclass"),
    "morphemes": ("id", "parent_id", "xml_id", "position", "class", "sclass"),
    "forms": (
        "id",
        "owner_type",
        "owner_id",
        "position",
        "text",
        "unclear",
        "kind",
        "notes",
        "normalized",
    ),
    "phonology": (
        "id",
        "owner_type",
        "owner_id",
        "position",
        "text",
        "unclear",
        "kind",
    ),
    "translations": (
        "id",
        "owner_type",
        "owner_id",
        "position",
        "text",
        "unclear",
        "xml_lang",
        "kind",
        "version",
        "notes",
        "normalized",
    ),
    "audio": (
        "id",
        "owner_type",
        "owner_id",
        "position",
        "file",
        "url",
        "start",
        "end",
        "start_raw",
        "end_raw",
        "source",
    ),
    "tokens": (
        "id",
        "sentence_id",
        "word_id",
        "position",
        "surface",
        "normalized",
    ),
}

INTEGER_COLUMNS = {"position", "token_count", "unclear"}
REAL_COLUMNS = {"start", "end"}


def sqlite_type(column: str) -> str:
    if column in INTEGER_COLUMNS:
        return "INTEGER"
    if column in REAL_COLUMNS:
        return "REAL"
    return "TEXT"
