from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.config import Settings
from publisher.build import BuildResult, build_release


@pytest.fixture
def release(public_repo: Path, tmp_path: Path) -> BuildResult:
    return build_release(public_repo, tmp_path / "release")


@pytest.fixture
def settings(release: BuildResult) -> Settings:
    return Settings(
        manifest_url=None,
        manifest_path=release.output / "release-manifest.json",
        database_path=release.output / "formosanbank.sqlite",
        expected_sha256=None,
        cors_origins=("https://formosanbank.github.io", "http://localhost:5173"),
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as value:
        yield value
