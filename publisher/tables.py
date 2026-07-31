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
        "metadata_json",
    ),
    "sentences": (
        "id",
        "parent_id",
        "xml_id",
        "position",
        "audio_url",
        "source",
        "token_count",
        "metadata_json",
    ),
    "words": ("id", "parent_id", "xml_id", "position", "class", "sclass", "metadata_json"),
    "morphemes": ("id", "parent_id", "xml_id", "position", "class", "sclass", "metadata_json"),
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
        "attributes_json",
        "inline_markup_json",
    ),
    "phonology": (
        "id",
        "owner_type",
        "owner_id",
        "position",
        "text",
        "unclear",
        "kind",
        "attributes_json",
        "inline_markup_json",
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
        "attributes_json",
        "inline_markup_json",
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
        "duration",
        "availability_status",
        "attributes_json",
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
REAL_COLUMNS = {"start", "end", "duration"}


def sqlite_type(column: str) -> str:
    if column in INTEGER_COLUMNS:
        return "INTEGER"
    if column in REAL_COLUMNS:
        return "REAL"
    return "TEXT"
