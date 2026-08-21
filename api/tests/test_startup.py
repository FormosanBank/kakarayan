from __future__ import annotations

import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.config import Settings
from api.limits import DEFAULT_SQLITE_PROGRESS_CALLBACKS


def test_release_mismatch_stays_unready(settings, tmp_path) -> None:
    manifest = json.loads(settings.manifest_path.read_text())
    manifest["release_id"] = "different-release"
    path = tmp_path / "active-release.json"
    path.write_text(json.dumps(manifest))
    with TestClient(create_app(replace(settings, manifest_path=path))) as client:
        assert client.get("/healthz").status_code == 200
        response = client.get("/readyz")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "service_not_ready"


def test_missing_local_manifest_stays_unready(settings, tmp_path) -> None:
    configured = replace(settings, manifest_path=tmp_path / "missing.json")
    with TestClient(create_app(configured)) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 503


def test_startup_never_acquires_a_remote_database(settings, monkeypatch) -> None:
    def fail(*_args, **_kwargs):
        raise AssertionError("startup attempted network access")

    monkeypatch.setattr("urllib.request.urlopen", fail)
    with TestClient(create_app(settings)) as client:
        assert client.get("/readyz").status_code == 200


def test_query_work_limit_is_configurable(monkeypatch) -> None:
    monkeypatch.delenv("KAKARAYAN_QUERY_STEP_LIMIT", raising=False)
    assert Settings.from_environment().query_step_limit == DEFAULT_SQLITE_PROGRESS_CALLBACKS

    monkeypatch.setenv("KAKARAYAN_QUERY_STEP_LIMIT", "3000000")
    assert Settings.from_environment().query_step_limit == 3_000_000

    monkeypatch.setenv("KAKARAYAN_QUERY_STEP_LIMIT", "0")
    with pytest.raises(ValueError, match="positive integer"):
        Settings.from_environment()
