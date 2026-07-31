from pathlib import Path

import pytest

from publisher.assemble_site import assemble
from publisher.build import build_release
from publisher.verify_release import VerificationError, verify_release
from publisher.verify_site import verify_site


def test_release_and_site_verification(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        include_prepared=False,
        site_only=True,
    )
    manifest = verify_release(release.output)
    assert manifest["release_id"] == release.release_id
    with pytest.raises(VerificationError, match="Rights review blocks"):
        verify_release(release.output, required_scopes={"site-query-data"})

    site = tmp_path / "site"
    assemble(release.output, site)
    for name in ("index.html", "404.html", "manifest.webmanifest", "sw.js"):
        (site / name).write_text(name, encoding="utf-8")
    result = verify_site(site, total_limit=1_000_000, file_limit=1_000_000)
    assert result["files"] > 4


def test_release_verification_rejects_tampering(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        include_prepared=False,
        site_only=True,
    )
    shard = next((release.output / "search" / "shards").rglob("*.json.gz"))
    shard.write_bytes(shard.read_bytes() + b"tampered")
    with pytest.raises(VerificationError, match="integrity mismatch"):
        verify_release(release.output)
