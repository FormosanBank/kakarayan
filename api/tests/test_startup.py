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

    monkeypatch.setenv("KAKARAYAN_REQUESTS_PER_MINUTE", "90")
    monkeypatch.setenv("KAKARAYAN_REQUEST_BURST", "30")
    monkeypatch.setenv("KAKARAYAN_EXPORTS_PER_MINUTE", "8")
    monkeypatch.setenv("KAKARAYAN_EXPORT_BURST", "4")
    monkeypatch.setenv("KAKARAYAN_QUERY_CONCURRENCY", "3")
    monkeypatch.setenv("KAKARAYAN_ANALYTICAL_QUERY_CONCURRENCY", "1")
    monkeypatch.setenv("KAKARAYAN_QUERY_QUEUE_WAIT_SECONDS", "0.5")
    monkeypatch.setenv("KAKARAYAN_QUERY_TIMEOUT_SECONDS", "8")
    monkeypatch.setenv("KAKARAYAN_DATASET_PREVIEW_TIMEOUT_SECONDS", "12")
    monkeypatch.setenv("KAKARAYAN_DATASET_EXPORT_TIMEOUT_SECONDS", "90")
    monkeypatch.setenv("KAKARAYAN_SQLITE_CACHE_MIB", "96")
    monkeypatch.setenv("KAKARAYAN_SQLITE_MMAP_MIB", "1024")
    configured = Settings.from_environment()
    assert configured.requests_per_minute == 90
    assert configured.request_burst == 30
    assert configured.exports_per_minute == 8
    assert configured.export_burst == 4
    assert configured.query_concurrency == 3
    assert configured.analytical_query_concurrency == 1
    assert configured.query_queue_wait_seconds == 0.5
    assert configured.query_timeout_seconds == 8
    assert configured.dataset_preview_timeout_seconds == 12
    assert configured.dataset_export_timeout_seconds == 90
    assert configured.sqlite_cache_mib == 96
    assert configured.sqlite_mmap_mib == 1024

    monkeypatch.setenv("KAKARAYAN_QUERY_STEP_LIMIT", "0")
    with pytest.raises(ValueError, match="positive integer"):
        Settings.from_environment()


def test_analytical_concurrency_cannot_exceed_total(monkeypatch) -> None:
    monkeypatch.setenv("KAKARAYAN_QUERY_CONCURRENCY", "1")
    monkeypatch.setenv("KAKARAYAN_ANALYTICAL_QUERY_CONCURRENCY", "2")
    with pytest.raises(ValueError, match="cannot exceed"):
        Settings.from_environment().validate()
