import json
from pathlib import Path

import pytest

from publisher import PUBLIC_DOWNLOAD_PATHS
from publisher.assemble_site import assemble
from publisher.build import BuildError, build_release


def test_assemble_site_copies_api_and_release_data(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        include_prepared=False,
        site_only=True,
    )
    downloads = build_release(
        public_repo,
        tmp_path / "downloads",
        compress_database=True,
        release_only=True,
    )
    public = tmp_path / "site" / "public"
    assemble(
        release.output,
        public,
        download_manifest=downloads.output / "release-manifest.json",
    )

    assert (public / "api" / "v1" / "meta.json").is_file()
    assert next((public / "data" / "search" / "shards").rglob("*.json.gz")).is_file()
    assert next((public / "data" / "search" / "indexes").rglob("*.json.gz")).is_file()
    assert not (public / "data" / "search" / "sentences.jsonl").exists()
    assert not (public / "data" / "formosanbank.sqlite").exists()
    assert not (public / "data" / "prepared").exists()
    assert not (public / "data" / "api").exists()
    assert not (release.output / "tables").exists()
    assert not (release.output / "formosanbank.sqlite").exists()
    download_catalog = json.loads(
        (public / "api" / "v1" / "downloads.json").read_text(encoding="utf-8")
    )
    assert download_catalog["release_id"] == release.release_id
    assert download_catalog["kakarayan"]["commit"]
    assert download_catalog["canonical_url"].endswith("/api/v1/downloads.json")
    assert {artifact["path"] for artifact in download_catalog["data"]["artifacts"]} == set(
        PUBLIC_DOWNLOAD_PATHS
    )
    assert all(
        artifact["download_url"].startswith(
            "https://github.com/FormosanBank/kakarayan/releases/download/"
        )
        for artifact in download_catalog["data"]["artifacts"]
    )

    with pytest.raises(BuildError, match="already exist"):
        assemble(release.output, public)
