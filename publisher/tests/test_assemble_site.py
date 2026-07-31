from pathlib import Path

import pytest

from publisher.assemble_site import assemble
from publisher.build import BuildError, build_release


def test_assemble_site_copies_api_and_release_data(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release")
    public = tmp_path / "site" / "public"
    assemble(release.output, public)

    assert (public / "api" / "v1" / "meta.json").is_file()
    assert (public / "data" / "release-manifest.json").is_file()
    assert not (public / "data" / "api").exists()

    with pytest.raises(BuildError, match="already exist"):
        assemble(release.output, public)
