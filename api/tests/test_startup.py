from __future__ import annotations

from dataclasses import replace
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.app import create_app
from api.config import Settings
from api.release import load_release
from publisher.build import build_release


class Response(BytesIO):
    def __init__(self, data: bytes, url: str) -> None:
        super().__init__(data)
        self.url = url
        self.headers = {"Content-Length": str(len(data))}

    def geturl(self) -> str:
        return self.url

    def __enter__(self) -> Response:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


def test_checksum_mismatch_stays_unready(settings: Settings) -> None:
    configured = replace(settings, expected_sha256="0" * 64)
    with TestClient(create_app(configured)) as client:
        assert client.get("/healthz").status_code == 200
        response = client.get("/readyz")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "service_not_ready"


def test_configuration_requires_one_manifest_source(settings: Settings) -> None:
    configured = replace(settings, manifest_path=None, manifest_url=None)
    with TestClient(create_app(configured)) as client:
        assert client.get("/readyz").status_code == 503


def test_remote_compressed_database_is_verified_and_expanded(
    public_repo: Path,
    tmp_path: Path,
) -> None:
    release = build_release(
        public_repo,
        tmp_path / "release",
        include_prepared=False,
        compress_database=True,
    )
    manifest_url = "https://github.com/FormosanBank/kakarayan/releases/download/data-test/release-manifest.json"
    manifest = (release.output / "release-manifest.json").read_bytes()
    database = (release.output / "formosanbank.sqlite.gz").read_bytes()
    settings = Settings(
        manifest_url=manifest_url,
        manifest_path=None,
        database_path=tmp_path / "cache" / "formosanbank.sqlite",
        expected_sha256=None,
        cors_origins=(),
    )
    responses = [
        Response(manifest, manifest_url),
        Response(database, manifest_url.replace("release-manifest.json", "formosanbank.sqlite.gz")),
    ]
    with patch("api.release.urllib.request.urlopen", side_effect=responses):
        state = load_release(settings)

    assert state.database_path.is_file()
    assert state.metadata["meta"]["release_id"] == release.release_id
