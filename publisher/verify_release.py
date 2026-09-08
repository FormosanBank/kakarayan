"""Verify a complete Kakarayan release before publication."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path, PurePosixPath
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from api.release import REQUIRED_DATABASE_TABLES


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


def _verify_database(path: Path, manifest: dict[str, Any]) -> None:
    if not path.is_file():
        return
    uri = f"file:{path}?mode=ro&immutable=1"
    try:
        with closing(sqlite3.connect(uri, uri=True)) as database:
            if database.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise VerificationError("SQLite integrity check failed")
            tables = {
                str(row[0])
                for row in database.execute("SELECT name FROM sqlite_schema WHERE type = 'table'")
            }
            missing = REQUIRED_DATABASE_TABLES - tables
            if missing:
                raise VerificationError(
                    f"SQLite release is missing required tables: {', '.join(sorted(missing))}"
                )
            metadata = database.execute(
                "SELECT value_json FROM publication_metadata WHERE key='meta'"
            ).fetchone()
            if metadata is None:
                raise VerificationError("SQLite publication identity is missing")
            identity = json.loads(metadata[0])
            for key in ("release_id", "read_model_version", "source", "kakarayan"):
                if identity.get(key) != manifest[key]:
                    raise VerificationError(f"SQLite publication {key} does not match the manifest")
    except sqlite3.Error as error:
        raise VerificationError(f"Cannot verify SQLite release: {error}") from error


def _verify_compressed_database(
    path: Path, artifact: dict[str, Any], destination: Path, manifest: dict[str, Any]
) -> None:
    digest = hashlib.sha256()
    size = 0
    created = False
    expected_bytes = artifact.get("content_bytes", 0)
    if not 0 < expected_bytes <= 8 * 1024**3:
        raise VerificationError("Expanded SQLite size is outside the supported bound")
    if shutil.disk_usage(destination.parent).free < expected_bytes + 256 * 1024**2:
        raise VerificationError("Insufficient space to verify the SQLite release")
    try:
        with destination.open("xb") as output:
            created = True
            with gzip.open(path, "rb") as source:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > expected_bytes:
                        raise VerificationError("Expanded SQLite exceeds the manifest size")
                    digest.update(chunk)
                    output.write(chunk)
            output.flush()
            if size != artifact.get("content_bytes"):
                raise VerificationError("Expanded SQLite size does not match the manifest")
            if digest.hexdigest() != artifact.get("content_sha256"):
                raise VerificationError("Expanded SQLite checksum does not match the manifest")
            _verify_database(destination, manifest)
    except BaseException:
        if created:
            destination.unlink(missing_ok=True)
        raise


def verify_release(
    root: Path,
    *,
    required_scopes: set[str] | None = None,
    max_artifact_bytes: int | None = None,
    database_output: Path | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    if database_output is not None:
        database_output = database_output.resolve()
        if database_output.is_relative_to(root) or database_output.exists():
            raise VerificationError(
                "Verified database output must be a new file outside the release"
            )
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
    release_assets = [artifact for artifact in artifacts if "asset_name" in artifact]
    if release_assets:
        if len(release_assets) != len(artifacts):
            raise VerificationError("Release asset mappings must cover every artifact")
        asset_names = [artifact["asset_name"] for artifact in release_assets]
        if len(set(asset_names)) != len(asset_names):
            raise VerificationError("Release manifest has duplicate GitHub asset names")
        release_id = manifest["release_id"]
        prefix = f"https://github.com/FormosanBank/kakarayan/releases/download/data-{release_id}/"
        for artifact in release_assets:
            if (
                PurePosixPath(artifact["path"]).name != artifact["asset_name"]
                or artifact.get("download_url") != f"{prefix}{artifact['asset_name']}"
            ):
                raise VerificationError(f"Unsafe GitHub Release mapping for {artifact['path']}")

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
        if max_artifact_bytes is not None and artifact["bytes"] >= max_artifact_bytes:
            raise VerificationError(
                f"Artifact is too large for publication: {relative} ({artifact['bytes']} bytes)"
            )

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

    database = by_path.get("formosanbank.sqlite")
    compressed_database = by_path.get("formosanbank.sqlite.gz")
    if database and compressed_database:
        raise VerificationError("Release contains both compressed and uncompressed SQLite")
    if compressed_database:
        if database_output is not None:
            _verify_compressed_database(
                root / "formosanbank.sqlite.gz", compressed_database, database_output, manifest
            )
        else:
            with tempfile.TemporaryDirectory(prefix="kakarayan-verify-") as temporary:
                _verify_compressed_database(
                    root / "formosanbank.sqlite.gz",
                    compressed_database,
                    Path(temporary) / "verified.sqlite",
                    manifest,
                )
    elif database:
        _verify_database(root / "formosanbank.sqlite", manifest)
        if database_output is not None:
            shutil.copyfile(root / "formosanbank.sqlite", database_output)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument(
        "--require-publishable-scope",
        action="append",
        default=[],
        choices=["site-metadata", "release-core", "prepared-download"],
    )
    parser.add_argument(
        "--max-artifact-mib",
        type=int,
        help="Fail when an artifact is at least this many MiB",
    )
    args = parser.parse_args(argv)
    manifest = verify_release(
        args.release,
        required_scopes=set(args.require_publishable_scope),
        max_artifact_bytes=(args.max_artifact_mib * 1024 * 1024 if args.max_artifact_mib else None),
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
