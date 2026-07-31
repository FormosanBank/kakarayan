from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

from api.app import create_app
from api.config import Settings


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
