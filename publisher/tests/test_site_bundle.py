from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from publisher.build import build_release
from publisher.site_bundle import (
    SITE_BUNDLE_NAME,
    SiteBundleError,
    attach_site_bundle,
    create_site_bundle,
    verify_and_extract_site_bundle,
)
from publisher.verify_release import verify_release


def test_site_bundle_is_deterministic_and_attaches_to_data_release(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    site = build_release(
        public_repo,
        tmp_path / "site",
        include_prepared=False,
        site_only=True,
    )
    data = build_release(
        public_repo,
        tmp_path / "data",
        compress_database=True,
        release_only=True,
    )
    first = tmp_path / "first.tar"
    second = tmp_path / "second.tar"
    create_site_bundle(site.output, first)
    create_site_bundle(site.output, second)
    assert (
        hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(second.read_bytes()).digest()
    )

    manifest = attach_site_bundle(data.output, first)
    artifact = next(item for item in manifest["artifacts"] if item["path"] == SITE_BUNDLE_NAME)
    assert artifact["asset_name"] == SITE_BUNDLE_NAME
    assert artifact["scope"] == "site-query-data"
    assert artifact["publishable"] is True
    assert artifact["sha256"] == hashlib.sha256(first.read_bytes()).hexdigest()
    assert verify_release(data.output)["release_id"] == site.release_id

    extracted = tmp_path / "extracted"
    extracted_manifest = verify_and_extract_site_bundle(
        data.output / "release-manifest.json",
        data.output / SITE_BUNDLE_NAME,
        extracted,
    )
    assert extracted_manifest == json.loads(
        (site.output / "release-manifest.json").read_text(encoding="utf-8")
    )
    assert (extracted / "api" / "v1" / "meta.json").is_file()
    assert next((extracted / "search" / "shards").rglob("*.json.gz")).is_file()


def test_downloaded_site_bundle_must_match_published_manifest(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    site = build_release(
        public_repo,
        tmp_path / "site",
        include_prepared=False,
        site_only=True,
    )
    data = build_release(
        public_repo,
        tmp_path / "data",
        compress_database=True,
        release_only=True,
    )
    bundle = tmp_path / "site.tar"
    create_site_bundle(site.output, bundle)
    attach_site_bundle(data.output, bundle)
    bundle.write_bytes(bundle.read_bytes() + b"tampered")

    with pytest.raises(SiteBundleError, match="does not match"):
        verify_and_extract_site_bundle(
            data.output / "release-manifest.json",
            bundle,
            tmp_path / "rejected",
        )
