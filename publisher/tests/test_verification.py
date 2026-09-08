import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from publisher.assemble_site import assemble
from publisher.build import build_release
from publisher.verify_release import VerificationError, _verify_database, verify_release
from publisher.verify_site import verify_site


def test_release_and_site_verification(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    manifest = verify_release(release.output)
    assert manifest["release_id"] == release.release_id
    verified = verify_release(release.output, required_scopes={"site-metadata"})
    assert all(
        artifact["publishable"]
        for artifact in verified["artifacts"]
        if artifact["scope"] == "site-metadata"
    )

    site = tmp_path / "site"
    assemble(release.output, site)
    for name in (
        "index.html",
        "404.html",
        "manifest.webmanifest",
        "robots.txt",
        "sitemap.xml",
        "sw.js",
    ):
        (site / name).write_text(name, encoding="utf-8")
    result = verify_site(site, total_limit=1_000_000, file_limit=1_000_000)
    assert result["files"] > 4


def test_release_verification_rejects_tampering(public_repo: Path, tmp_path: Path) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    metadata = release.output / "api" / "v1" / "meta.json"
    metadata.write_bytes(metadata.read_bytes() + b"tampered")
    with pytest.raises(VerificationError, match="integrity mismatch"):
        verify_release(release.output)


def test_database_verification_rejects_an_old_search_schema(
    public_repo: Path, tmp_path: Path
) -> None:
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    database = release.output / "formosanbank.sqlite"
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.execute("DROP TABLE reverse_dictionary_terms")

    with pytest.raises(VerificationError, match="reverse_dictionary_terms"):
        _verify_database(
            database, json.loads((release.output / "release-manifest.json").read_text())
        )


def test_verified_output_never_overwrites_a_previous_candidate(public_repo, tmp_path):
    release = build_release(public_repo, tmp_path / "release", compress_database=True)
    destination = tmp_path / "verified.sqlite"
    destination.write_bytes(b"previous")
    with pytest.raises(VerificationError, match="new file"):
        verify_release(release.output, database_output=destination)
    assert destination.read_bytes() == b"previous"


def test_database_identity_is_checked_even_when_schema_is_valid(public_repo, tmp_path):
    release = build_release(public_repo, tmp_path / "release", include_prepared=False)
    manifest = json.loads((release.output / "release-manifest.json").read_text())
    manifest["kakarayan"]["commit"] = "f" * 40
    with pytest.raises(VerificationError, match="kakarayan"):
        _verify_database(release.output / "formosanbank.sqlite", manifest)
