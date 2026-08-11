"""Prepare and atomically activate a checksummed SQLite release before service startup."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO, cast

from api.release import ReleaseError

_BUFFER_SIZE = 1024 * 1024
_MAX_BYTES = 5_000_000_000


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(_BUFFER_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_limited(source: BinaryIO, target: BinaryIO, limit: int) -> int:
    written = 0
    while chunk := source.read(_BUFFER_SIZE):
        written += len(chunk)
        if written > limit:
            raise ReleaseError("Release artifact exceeds the activation size limit")
        target.write(chunk)
    return written


def _read_manifest(source: str) -> tuple[dict[str, Any], str | None]:
    parsed = urllib.parse.urlparse(source)
    if parsed.scheme == "https":
        request = urllib.request.Request(source, headers={"User-Agent": "kakarayan-activator/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            if not response.geturl().startswith("https://"):
                raise ReleaseError("Manifest redirected away from HTTPS")
            raw = response.read(10_000_001)
        base_url = source
    elif parsed.scheme:
        raise ReleaseError("Manifest source must be a local path or HTTPS URL")
    else:
        raw = Path(source).resolve().read_bytes()
        base_url = None
    if len(raw) > 10_000_000:
        raise ReleaseError("Release manifest exceeds the activation size limit")
    value = json.loads(raw)
    if not isinstance(value, dict) or not isinstance(value.get("release_id"), str):
        raise ReleaseError("Release manifest is invalid")
    return value, base_url


def _artifact(manifest: dict[str, Any]) -> dict[str, Any]:
    matches = [
        item
        for item in manifest.get("artifacts", [])
        if item.get("path") in {"formosanbank.sqlite", "formosanbank.sqlite.gz"}
    ]
    if len(matches) != 1:
        raise ReleaseError("Release manifest must contain one SQLite artifact")
    artifact = matches[0]
    required = ("path", "bytes", "sha256")
    if any(not artifact.get(key) for key in required):
        raise ReleaseError("SQLite artifact metadata is incomplete")
    return artifact


def _acquire(source: str, target: Path, expected_bytes: int) -> None:
    parsed = urllib.parse.urlparse(source)
    handle, name = tempfile.mkstemp(prefix=".release-", dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(handle, "wb") as output:
            if parsed.scheme == "https":
                request = urllib.request.Request(
                    source, headers={"User-Agent": "kakarayan-activator/1"}
                )
                with urllib.request.urlopen(request, timeout=120) as response:
                    if not response.geturl().startswith("https://"):
                        raise ReleaseError("Artifact redirected away from HTTPS")
                    written = _copy_limited(response, output, _MAX_BYTES)
            elif parsed.scheme:
                raise ReleaseError("Artifact source must be a local path or HTTPS URL")
            else:
                with Path(source).resolve().open("rb") as input_stream:
                    written = _copy_limited(input_stream, output, _MAX_BYTES)
            output.flush()
            os.fsync(output.fileno())
        if written != expected_bytes:
            raise ReleaseError("SQLite artifact size does not match the manifest")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_release(manifest_source: str, database_path: Path, active_manifest: Path) -> None:
    manifest, manifest_url = _read_manifest(manifest_source)
    artifact = _artifact(manifest)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    active_manifest.parent.mkdir(parents=True, exist_ok=True)
    artifact_path = database_path.parent / f".{artifact['path']}"
    source = (
        urllib.parse.urljoin(manifest_url, artifact["path"])
        if manifest_url
        else str(Path(manifest_source).resolve().parent / artifact["path"])
    )
    _acquire(source, artifact_path, int(artifact["bytes"]))
    if _sha256(artifact_path) != artifact["sha256"]:
        artifact_path.unlink(missing_ok=True)
        raise ReleaseError("SQLite artifact checksum does not match the manifest")
    handle, name = tempfile.mkstemp(prefix=".database-", dir=database_path.parent)
    candidate = Path(name)
    try:
        digest = hashlib.sha256()
        expanded = 0
        with os.fdopen(handle, "wb") as output:
            source_stream: BinaryIO
            if artifact.get("compression") == "gzip":
                source_stream = cast(BinaryIO, gzip.open(artifact_path, "rb"))
            else:
                source_stream = artifact_path.open("rb")
            with source_stream:
                while chunk := source_stream.read(_BUFFER_SIZE):
                    expanded += len(chunk)
                    if expanded > _MAX_BYTES:
                        raise ReleaseError("Expanded database exceeds the activation size limit")
                    digest.update(chunk)
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        expected_bytes = int(artifact.get("content_bytes", artifact["bytes"]))
        expected_sha256 = artifact.get("content_sha256", artifact["sha256"])
        if expanded != expected_bytes or digest.hexdigest() != expected_sha256:
            raise ReleaseError("Expanded database does not match the release manifest")
        connection = sqlite3.connect(candidate)
        try:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ReleaseError("SQLite integrity check failed during activation")
        finally:
            connection.close()
        candidate.replace(database_path)
        handle, manifest_name = tempfile.mkstemp(prefix=".active-", dir=active_manifest.parent)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as output:
                json.dump(
                    manifest, output, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                )
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            Path(manifest_name).replace(active_manifest)
        finally:
            Path(manifest_name).unlink(missing_ok=True)
    finally:
        candidate.unlink(missing_ok=True)
        artifact_path.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--activate", type=Path, required=True)
    args = parser.parse_args(argv)
    prepare_release(args.manifest, args.database, args.activate)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
