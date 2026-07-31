"""Acquire and validate one immutable published release."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import urllib.parse
import urllib.request
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from api.config import Settings

_MANIFEST_LIMIT = 10_000_000
_SUPPORTED_SCHEMA_VERSION = "1.0.0"


class ReleaseError(RuntimeError):
    """Raised when startup cannot establish a trusted release."""


@dataclass(frozen=True)
class ReleaseState:
    database_path: Path
    manifest: dict[str, Any]
    metadata: dict[str, Any]


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={"User-Agent": "kakarayan-api/0.1 (+https://formosanbank.github.io/kakarayan/)"},
    )


def _fetch_bytes(url: str, limit: int) -> bytes:
    with urllib.request.urlopen(_request(url), timeout=30) as response:
        final_url = response.geturl()
        if not final_url.startswith("https://"):
            raise ReleaseError("Release download redirected away from HTTPS")
        length = response.headers.get("Content-Length")
        if length and int(length) > limit:
            raise ReleaseError("Release response exceeds the configured size limit")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ReleaseError("Release response exceeds the configured size limit")
    return data


def _load_manifest(settings: Settings) -> dict[str, Any]:
    if settings.manifest_path is not None:
        try:
            raw = settings.manifest_path.read_bytes()
        except OSError as error:
            raise ReleaseError(f"Cannot read release manifest: {error}") from error
        if len(raw) > _MANIFEST_LIMIT:
            raise ReleaseError("Release manifest exceeds the size limit")
    elif settings.manifest_url:
        raw = _fetch_bytes(settings.manifest_url, _MANIFEST_LIMIT)
    else:
        raise ReleaseError("No release manifest is configured")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("Release manifest is not valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ReleaseError("Release manifest must be a JSON object")
    if value.get("schema_version") != _SUPPORTED_SCHEMA_VERSION:
        raise ReleaseError(
            f"Unsupported release schema {value.get('schema_version')!r}; "
            f"expected {_SUPPORTED_SCHEMA_VERSION}"
        )
    return value


def _sqlite_artifact(manifest: dict[str, Any]) -> dict[str, Any]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        raise ReleaseError("Release manifest has no artifact list")
    matches = [
        item
        for item in artifacts
        if isinstance(item, dict) and item.get("path") == "formosanbank.sqlite"
    ]
    if len(matches) != 1:
        raise ReleaseError("Release manifest must name one formosanbank.sqlite artifact")
    artifact = matches[0]
    checksum = artifact.get("sha256")
    size = artifact.get("bytes")
    if (
        not isinstance(checksum, str)
        or len(checksum) != 64
        or not isinstance(size, int)
        or size <= 0
    ):
        raise ReleaseError("SQLite artifact metadata is incomplete")
    return artifact


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_database(settings: Settings, artifact: dict[str, Any]) -> None:
    if not settings.manifest_url:
        return
    if artifact["bytes"] > settings.max_download_bytes:
        raise ReleaseError("SQLite artifact exceeds the configured download limit")
    url = urllib.parse.urljoin(settings.manifest_url, "formosanbank.sqlite")
    if not url.startswith("https://"):
        raise ReleaseError("SQLite artifact URL must use HTTPS")
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    if (
        settings.database_path.is_file()
        and settings.database_path.stat().st_size == artifact["bytes"]
        and sha256_file(settings.database_path) == artifact["sha256"]
    ):
        return
    handle, temporary_name = tempfile.mkstemp(
        prefix=".formosanbank-",
        suffix=".sqlite",
        dir=settings.database_path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as output, urllib.request.urlopen(
            _request(url), timeout=60
        ) as response:
            final_url = response.geturl()
            if not final_url.startswith("https://"):
                raise ReleaseError("SQLite download redirected away from HTTPS")
            written = 0
            while chunk := response.read(1024 * 1024):
                written += len(chunk)
                if written > settings.max_download_bytes:
                    raise ReleaseError("SQLite download exceeds the configured limit")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if written != artifact["bytes"]:
            raise ReleaseError("SQLite download size does not match the manifest")
        if sha256_file(temporary) != artifact["sha256"]:
            raise ReleaseError("SQLite download checksum does not match the manifest")
        temporary.replace(settings.database_path)
    finally:
        temporary.unlink(missing_ok=True)


def readonly_connection(path: Path) -> sqlite3.Connection:
    uri_path = urllib.parse.quote(str(path), safe="/")
    connection = sqlite3.connect(
        f"file:{uri_path}?mode=ro&immutable=1",
        uri=True,
        check_same_thread=False,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def _validate_database(path: Path) -> dict[str, Any]:
    try:
        with closing(readonly_connection(path)) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            if not integrity or integrity[0] != "ok":
                raise ReleaseError("SQLite integrity check failed")
            table_names = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_schema WHERE type = 'table'"
                )
            }
            required = {
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
            }
            if not required.issubset(table_names):
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
    if (
        not isinstance(meta, dict)
        or meta.get("schema_version") != _SUPPORTED_SCHEMA_VERSION
    ):
        raise ReleaseError("SQLite metadata schema is unsupported")
    return metadata


def load_release(settings: Settings) -> ReleaseState:
    settings.validate()
    manifest = _load_manifest(settings)
    artifact = _sqlite_artifact(manifest)
    if settings.expected_sha256 and settings.expected_sha256 != artifact["sha256"]:
        raise ReleaseError("Configured SQLite checksum does not match the release manifest")
    _download_database(settings, artifact)
    if not settings.database_path.is_file():
        raise ReleaseError(f"SQLite release does not exist: {settings.database_path}")
    if settings.database_path.stat().st_size != artifact["bytes"]:
        raise ReleaseError("Local SQLite size does not match the release manifest")
    if sha256_file(settings.database_path) != artifact["sha256"]:
        raise ReleaseError("Local SQLite checksum does not match the release manifest")
    metadata = _validate_database(settings.database_path)
    meta = metadata["meta"]
    if meta.get("release_id") != manifest.get("release_id"):
        raise ReleaseError("SQLite and release manifest identify different releases")
    return ReleaseState(
        database_path=settings.database_path,
        manifest=manifest,
        metadata=metadata,
    )
