"""Verify a complete Kakarayan release before publication."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path, PurePosixPath
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource


class VerificationError(RuntimeError):
    """Raised when a release fails an integrity or publication check."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _path(root: Path, value: str) -> Path:
    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise VerificationError(f"Unsafe artifact path: {value!r}")
    path = root.joinpath(*relative.parts)
    if path.is_symlink():
        raise VerificationError(f"Release artifacts cannot be symlinks: {value}")
    return path


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"Cannot read JSON from {path}: {error}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"Expected a JSON object in {path}")
    return value


def _checksums(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        checksum, separator, name = line.partition("  ")
        if separator != "  " or len(checksum) != 64 or name in result:
            raise VerificationError(f"Malformed checksum line: {line!r}")
        result[name] = checksum
    return result


def _verify_database(path: Path) -> None:
    if not path.is_file():
        return
    uri = f"file:{path}?mode=ro&immutable=1"
    try:
        with closing(sqlite3.connect(uri, uri=True)) as database:
            if database.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise VerificationError("SQLite integrity check failed")
    except sqlite3.Error as error:
        raise VerificationError(f"Cannot verify SQLite release: {error}") from error


def _verify_search(root: Path) -> None:
    manifest_path = root / "api" / "v1" / "search" / "manifest.json"
    if not manifest_path.is_file():
        raise VerificationError("Release is missing its search manifest")
    manifest = _json(manifest_path)
    for shard in manifest.get("shards", []):
        path = _path(root, str(shard["path"]))
        if _sha256(path) != shard["sha256"]:
            raise VerificationError(f"Compressed search checksum mismatch: {shard['path']}")
        try:
            content = gzip.decompress(path.read_bytes())
        except (OSError, EOFError) as error:
            raise VerificationError(f"Invalid gzip search shard: {shard['path']}") from error
        if len(content) != shard["uncompressed_bytes"]:
            raise VerificationError(f"Search shard size mismatch: {shard['path']}")
        if hashlib.sha256(content).hexdigest() != shard["uncompressed_sha256"]:
            raise VerificationError(f"Search content checksum mismatch: {shard['path']}")
        records = json.loads(content)
        if not isinstance(records, list) or len(records) != shard["records"]:
            raise VerificationError(f"Search record count mismatch: {shard['path']}")


def verify_release(root: Path, *, required_scopes: set[str] | None = None) -> dict[str, Any]:
    root = root.resolve()
    manifest_path = root / "release-manifest.json"
    checksum_path = root / "SHA256SUMS"
    manifest = _json(manifest_path)
    schema_path = Path(__file__).resolve().parents[1] / "schemas" / "release-manifest.schema.json"
    registry = Registry()
    for candidate in schema_path.parent.glob("*.schema.json"):
        schema = _json(candidate)
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    Draft202012Validator(
        _json(schema_path),
        registry=registry,
        format_checker=FormatChecker(),
    ).validate(manifest)
    artifacts = manifest["artifacts"]
    by_path = {artifact["path"]: artifact for artifact in artifacts}
    if len(by_path) != len(artifacts):
        raise VerificationError("Release manifest has duplicate artifact paths")

    expected_files = set(by_path) | {"release-manifest.json", "SHA256SUMS"}
    actual_files = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    if actual_files != expected_files:
        missing = sorted(expected_files - actual_files)
        extra = sorted(actual_files - expected_files)
        raise VerificationError(f"Release file set differs; missing={missing}, extra={extra}")

    checksum_rows = _checksums(checksum_path)
    expected_checksums = {
        **{path: artifact["sha256"] for path, artifact in by_path.items()},
        "release-manifest.json": _sha256(manifest_path),
    }
    if checksum_rows != expected_checksums:
        raise VerificationError("SHA256SUMS does not exactly match the release manifest")

    for relative, artifact in by_path.items():
        path = _path(root, relative)
        if path.stat().st_size != artifact["bytes"] or _sha256(path) != artifact["sha256"]:
            raise VerificationError(f"Artifact integrity mismatch: {relative}")

    required_scopes = required_scopes or set()
    blocked = [
        artifact
        for artifact in artifacts
        if artifact["scope"] in required_scopes and not artifact["publishable"]
    ]
    if blocked:
        details = "; ".join(
            f"{artifact['path']}: {', '.join(artifact['blocked_reasons'])}"
            for artifact in blocked[:20]
        )
        raise VerificationError(f"Rights review blocks publication: {details}")

    _verify_database(root / "formosanbank.sqlite")
    _verify_search(root)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument(
        "--require-publishable-scope",
        action="append",
        default=[],
        choices=["site-query-data", "release-core", "prepared-download"],
    )
    args = parser.parse_args(argv)
    manifest = verify_release(
        args.release,
        required_scopes=set(args.require_publishable_scope),
    )
    print(
        json.dumps(
            {
                "release_id": manifest["release_id"],
                "artifacts": len(manifest["artifacts"]),
                "verified": True,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VerificationError as error:
        raise SystemExit(f"release verification failed: {error}") from error
