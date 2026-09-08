"""Prepare and atomically activate a checksummed SQLite release before service startup."""

from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO, cast

from api.config import Settings
from api.release import ReleaseError, load_release

_BUFFER_SIZE = 1024 * 1024
_MAX_ARTIFACT_BYTES = 2_000_000_000
_MAX_DATABASE_BYTES = 8 * 1024 * 1024 * 1024


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
        with Path(source).resolve().open("rb") as stream:
            raw = stream.read(10_000_001)
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
    for size, limit in (
        (artifact["bytes"], _MAX_ARTIFACT_BYTES),
        (artifact.get("content_bytes", artifact["bytes"]), _MAX_DATABASE_BYTES),
    ):
        if type(size) is not int or not 0 < size <= limit:
            raise ReleaseError("SQLite artifact size is invalid or exceeds the activation limit")
    for digest in (artifact["sha256"], artifact.get("content_sha256", artifact["sha256"])):
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ReleaseError("SQLite artifact digest is invalid")
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
                    written = _copy_limited(response, output, _MAX_ARTIFACT_BYTES)
            elif parsed.scheme:
                raise ReleaseError("Artifact source must be a local path or HTTPS URL")
            else:
                with Path(source).resolve().open("rb") as input_stream:
                    written = _copy_limited(input_stream, output, _MAX_ARTIFACT_BYTES)
            output.flush()
            os.fsync(output.fileno())
        if written != expected_bytes:
            raise ReleaseError("SQLite artifact size does not match the manifest")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _stage_release(
    manifest_source: str, manifest: dict[str, Any], manifest_url: str | None, stage: Path
) -> None:
    artifact = _artifact(manifest)
    artifact_path = stage / f".download-{artifact['path']}"
    source = (
        urllib.parse.urljoin(manifest_url, artifact["path"])
        if manifest_url
        else str(Path(manifest_source).resolve().parent / artifact["path"])
    )
    _acquire(source, artifact_path, int(artifact["bytes"]))
    if _sha256(artifact_path) != artifact["sha256"]:
        artifact_path.unlink(missing_ok=True)
        raise ReleaseError("SQLite artifact checksum does not match the manifest")
    handle, name = tempfile.mkstemp(prefix=".database-", dir=stage)
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
                    if expanded > _MAX_DATABASE_BYTES:
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
        candidate.replace(stage / "formosanbank.sqlite")
        with (stage / "release-manifest.json").open("x", encoding="utf-8") as output:
            json.dump(manifest, output, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        _validate_generation(stage, manifest)
    finally:
        candidate.unlink(missing_ok=True)
        artifact_path.unlink(missing_ok=True)


def _validate_generation(directory: Path, manifest: dict[str, Any]) -> None:
    state = load_release(
        Settings(
            manifest_path=directory / "release-manifest.json",
            database_path=directory / "formosanbank.sqlite",
            expected_sha256=None,
            cors_origins=(),
        )
    )
    if state.manifest != manifest:
        raise ReleaseError("Existing generation has different immutable metadata")


def _sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _select_generation(root: Path, generation: Path) -> None:
    """Replace the one pointer, never the files used by a running process."""
    current = root / "current"
    previous = current.resolve() if current.is_symlink() else None
    if current.exists() and not current.is_symlink():
        raise ReleaseError("The current release selector must be a symlink")
    if previous == generation:
        return
    for name, target in (("previous", previous), ("current", generation)):
        if target is None:
            continue
        temporary = root / f".{name}-{os.getpid()}"
        try:
            temporary.symlink_to(os.path.relpath(target, root), target_is_directory=True)
            os.replace(temporary, root / name)
        finally:
            temporary.unlink(missing_ok=True)
    _sync_directory(root)


def prepare_release(manifest_source: str, data_root: Path) -> Path:
    """Stage and select a generation under an exclusive local activation lock."""
    root = data_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if root.stat().st_uid != os.geteuid() or not os.access(root, os.W_OK):
        raise ReleaseError("Data directory must be writable and owned by the activation user")
    with (root / ".activation.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReleaseError("Another release activation is running") from error
        manifest, manifest_url = _read_manifest(manifest_source)
        release_id = manifest["release_id"]
        if not re.fullmatch(r"fb-[0-9]{8}-[0-9a-f]{7,12}", release_id):
            raise ReleaseError("Invalid release ID")
        artifact = _artifact(manifest)
        generations = root / "generations"
        generations.mkdir(exist_ok=True)
        generation = generations / release_id
        if generation.exists():
            _validate_generation(generation, manifest)
            if _sha256(generation / "formosanbank.sqlite") != artifact.get(
                "content_sha256", artifact["sha256"]
            ):
                raise ReleaseError("Retained database checksum does not match its manifest")
        else:
            required = (
                artifact["bytes"]
                + artifact.get("content_bytes", artifact["bytes"])
                + 256 * 1024 * 1024
            )
            if shutil.disk_usage(root).free < required:
                raise ReleaseError(f"Not enough free disk for activation: need {required} bytes")
            stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=root))
            try:
                _stage_release(manifest_source, manifest, manifest_url, stage)
                _sync_directory(stage)
                stage.replace(generation)
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
        _sync_directory(generations)
        _select_generation(root, generation)
        return generation


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    args = parser.parse_args(argv)
    generation = prepare_release(args.manifest, args.data_root)
    print(f"Selected {generation.name}. Restart the API to use this generation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
