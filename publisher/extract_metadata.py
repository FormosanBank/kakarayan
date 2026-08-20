"""Verify and extract the static site metadata from a published release."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from jsonschema.exceptions import ValidationError

from publisher.build import BuildError, validate_document

MAX_FILES = 100
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024


def _artifact(manifest: dict[str, Any]) -> dict[str, Any]:
    matches = [
        item
        for item in manifest.get("artifacts", [])
        if isinstance(item, dict) and item.get("path") == "site-metadata.zip"
    ]
    if len(matches) != 1:
        raise BuildError("Release manifest must contain one site-metadata.zip artifact")
    artifact = matches[0]
    if artifact.get("asset_name") != "site-metadata.zip":
        raise BuildError("Static metadata has an unsafe release asset name")
    return artifact


def _safe_name(info: zipfile.ZipInfo) -> PurePosixPath:
    name = info.filename
    path = PurePosixPath(name)
    mode = info.external_attr >> 16
    if (
        info.is_dir()
        or not name
        or "\\" in name
        or path.is_absolute()
        or ".." in path.parts
        or path.parts[0] != "v1"
        or path.suffix != ".json"
        or stat.S_ISLNK(mode)
    ):
        raise BuildError(f"Static metadata archive has an unsafe member: {name!r}")
    return path


def extract_metadata(manifest_path: Path, archive_path: Path, output: Path) -> str:
    """Verify one published metadata asset and materialize a site release tree."""
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise BuildError(f"Metadata output must be absent or empty: {output}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        schema_root = Path(__file__).resolve().parents[1] / "schemas"
        validate_document(manifest, schema_root / "release-manifest.schema.json")
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        raise BuildError(f"Invalid published release manifest: {error}") from error

    artifact = _artifact(manifest)
    try:
        size = archive_path.stat().st_size
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    except OSError as error:
        raise BuildError(f"Cannot read the static metadata asset: {error}") from error
    if size != artifact["bytes"]:
        raise BuildError("Static metadata asset size does not match the release manifest")
    if digest != artifact["sha256"]:
        raise BuildError("Static metadata asset checksum does not match the release manifest")

    output.mkdir(parents=True, exist_ok=True)
    api_root = output / "api"
    total = 0
    seen: set[PurePosixPath] = set()
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES:
                raise BuildError("Static metadata archive contains too many files")
            for info in members:
                path = _safe_name(info)
                if path in seen:
                    raise BuildError(f"Static metadata archive repeats {path.as_posix()}")
                seen.add(path)
                if info.file_size > MAX_FILE_BYTES:
                    raise BuildError(f"Static metadata member is too large: {path.as_posix()}")
                total += info.file_size
                if total > MAX_TOTAL_BYTES:
                    raise BuildError("Static metadata archive exceeds its expanded size limit")
                destination = api_root.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
    except (OSError, zipfile.BadZipFile) as error:
        raise BuildError(f"Invalid static metadata archive: {error}") from error

    required = {
        "content.json",
        "corpora.json",
        "languages.json",
        "meta.json",
        "models.json",
        "orthography.json",
        "rights.json",
    }
    actual = {path.name for path in (api_root / "v1").glob("*.json")}
    if actual != required:
        raise BuildError(
            f"Static metadata endpoint set differs: missing={sorted(required - actual)}, "
            f"extra={sorted(actual - required)}"
        )
    for endpoint_path in (api_root / "v1").glob("*.json"):
        try:
            document = json.loads(endpoint_path.read_text(encoding="utf-8"))
            validate_document(document, schema_root / "static-api.schema.json")
        except (OSError, json.JSONDecodeError, ValidationError) as error:
            raise BuildError(
                f"Invalid static metadata endpoint {endpoint_path.name}: {error}"
            ) from error
        if document.get("release_id") != manifest["release_id"]:
            raise BuildError(f"Static metadata release mismatch in {endpoint_path.name}")

    shutil.copy2(manifest_path, output / "release-manifest.json")
    return str(manifest["release_id"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    release_id = extract_metadata(args.manifest, args.archive, args.output)
    print(json.dumps({"release_id": release_id, "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as error:
        raise SystemExit(f"metadata extraction failed: {error}") from error
