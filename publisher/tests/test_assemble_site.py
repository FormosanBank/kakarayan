import json
from pathlib import Path

import pytest

from publisher import PUBLIC_DOWNLOAD_PATHS
from publisher.assemble_site import assemble
from publisher.build import BuildError, build_release


def test_assemble_site_copies_only_small_metadata(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
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
    assert not (public / "data").exists()
    assert not (public / "api" / "v1" / "search").exists()
    assert (release.output / "tables").exists()
    assert (release.output / "formosanbank.sqlite").is_file()
    download_catalog = json.loads(
        (public / "api" / "v1" / "downloads.json").read_text(encoding="utf-8")
    )
    assert download_catalog["release_id"] == release.release_id
    assert {artifact["path"] for artifact in download_catalog["data"]["artifacts"]} == set(
        PUBLIC_DOWNLOAD_PATHS
    )

    with pytest.raises(BuildError, match="already exists"):
        assemble(release.output, public)
