from __future__ import annotations

import hashlib
import json
import zipfile

import pytest

from publisher.build import BuildError, build_release
from publisher.extract_metadata import extract_metadata


def test_extracts_verified_release_metadata(public_repo, tmp_path) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        compress_database=True,
        release_only=True,
    )
    output = tmp_path / "site-release"
    assert (
        extract_metadata(
            release.output / "release-manifest.json",
            release.output / "site-metadata.zip",
            output,
        )
        == release.release_id
    )
    assert (output / "api" / "v1" / "meta.json").is_file()
    assert json.loads((output / "release-manifest.json").read_text())["release_id"] == (
        release.release_id
    )


def test_rejects_tampered_or_unsafe_metadata(public_repo, tmp_path) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        compress_database=True,
        release_only=True,
    )
    archive = release.output / "site-metadata.zip"
    archive.write_bytes(archive.read_bytes() + b"tampered")
    with pytest.raises(BuildError, match="size"):
        extract_metadata(
            release.output / "release-manifest.json",
            archive,
            tmp_path / "tampered",
        )

    unsafe = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(unsafe, "w") as target:
        target.writestr("../escape.json", "{}")
    manifest = json.loads((release.output / "release-manifest.json").read_text())
    artifact = next(item for item in manifest["artifacts"] if item["path"] == "site-metadata.zip")
    artifact["bytes"] = unsafe.stat().st_size
    artifact["sha256"] = hashlib.sha256(unsafe.read_bytes()).hexdigest()
    manifest_path = tmp_path / "unsafe-manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(BuildError, match="unsafe member"):
        extract_metadata(manifest_path, unsafe, tmp_path / "unsafe-output")
