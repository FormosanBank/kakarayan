"""Load one locally prepared immutable release without deployment-time work."""

from __future__ import annotations

import json
import sqlite3
import urllib.parse
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from api.config import Settings

_MANIFEST_LIMIT = 10_000_000
_SUPPORTED_SCHEMA_VERSION = "1.0.0"
REQUIRED_DATABASE_TABLES = frozenset(
    {
        "texts",
        "sentences",
        "words",
        "morphemes",
        "forms",
        "phonology",
        "translations",
        "audio",
        "tokens",
        "publication_metadata",
        "tier_scope",
        "dictionary_terms",
        "formosan_sentence_terms",
        "translation_sentence_terms",
        "reverse_dictionary_terms",
        "formosan_vocabulary",
        "formosan_vocabulary_fts",
        "translation_vocabulary",
        "translation_vocabulary_fts",
        "summary_cache",
        "translation_language_cache",
    }
)


class ReleaseError(RuntimeError):
    """Raised when the configured local release is not ready to serve."""


@dataclass(frozen=True)
class ReleaseState:
    database_path: Path
    manifest_path: Path
    manifest: dict[str, Any]
    metadata: dict[str, Any]


def readonly_connection(
    path: Path,
    *,
    cache_mib: int | None = None,
    mmap_mib: int | None = None,
) -> sqlite3.Connection:
    uri_path = urllib.parse.quote(str(path), safe="/")
    connection = sqlite3.connect(
        f"file:{uri_path}?mode=ro&immutable=1",
        uri=True,
        check_same_thread=False,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    if cache_mib is not None:
        connection.execute(f"PRAGMA cache_size=-{cache_mib * 1024}")
    if mmap_mib is not None:
        connection.execute(f"PRAGMA mmap_size={mmap_mib * 1024 * 1024}")
    if cache_mib is not None or mmap_mib is not None:
        connection.execute("PRAGMA temp_store=MEMORY")
    return connection


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ReleaseError(f"Cannot read active release manifest: {error}") from error
    if len(raw) > _MANIFEST_LIMIT:
        raise ReleaseError("Active release manifest exceeds the size limit")
    try:
        manifest = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("Active release manifest is not valid UTF-8 JSON") from error
    if not isinstance(manifest, dict):
        raise ReleaseError("Active release manifest must be a JSON object")
    if manifest.get("schema_version") != _SUPPORTED_SCHEMA_VERSION:
        raise ReleaseError("Active release manifest schema is unsupported")
    if not isinstance(manifest.get("release_id"), str):
        raise ReleaseError("Active release manifest has no release ID")
    return manifest


def _fast_database_check(path: Path) -> dict[str, Any]:
    """Check release identity and schema only. Full integrity belongs to activation."""
    if not path.is_file():
        raise ReleaseError(f"SQLite release does not exist: {path}")
    try:
        with closing(readonly_connection(path)) as connection:
            table_names = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_schema WHERE type = 'table'")
            }
            if not REQUIRED_DATABASE_TABLES.issubset(table_names):
                raise ReleaseError("SQLite release is missing required tables")
            metadata = {
                row["key"]: json.loads(row["value_json"])
                for row in connection.execute(
                    "SELECT key, value_json FROM publication_metadata ORDER BY key"
                )
            }
    except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
        raise ReleaseError(f"SQLite release validation failed: {error}") from error
    meta = metadata.get("meta")
    if not isinstance(meta, dict) or meta.get("schema_version") != _SUPPORTED_SCHEMA_VERSION:
        raise ReleaseError("SQLite metadata schema is unsupported")
    return metadata


def load_release(settings: Settings) -> ReleaseState:
    settings.validate()
    manifest = _load_manifest(settings.manifest_path)
    metadata = _fast_database_check(settings.database_path)
    meta = metadata["meta"]
    if meta.get("release_id") != manifest.get("release_id"):
        raise ReleaseError("SQLite and active manifest identify different releases")
    configured_checksum = settings.expected_sha256
    artifact: dict[str, Any] = next(
        (
            item
            for item in manifest.get("artifacts", [])
            if item.get("path") in {"formosanbank.sqlite", "formosanbank.sqlite.gz"}
        ),
        {},
    )
    manifest_checksum = (
        artifact.get("content_sha256")
        if artifact.get("compression") == "gzip"
        else artifact.get("sha256")
    )
    if configured_checksum and manifest_checksum != configured_checksum:
        raise ReleaseError("Configured checksum does not match the active release")
    return ReleaseState(settings.database_path, settings.manifest_path, manifest, metadata)
