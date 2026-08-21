from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Event

from fastapi.testclient import TestClient

from api.app import create_app
from api.release import load_release
from api.security import PerIpRateLimiter, RatePolicy
from api.store import CorpusStore


def release_path(client: TestClient, path: str) -> str:
    release_id = client.get("/readyz").json()["release_id"]
    return f"/v1/releases/{release_id}/{path}"


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_token_buckets_refill_and_separate_exports() -> None:
    clock = Clock()
    limiter = PerIpRateLimiter(
        RatePolicy(requests_per_minute=60, burst=2),
        RatePolicy(requests_per_minute=6, burst=1),
        clock=clock,
    )

    assert limiter.check("192.0.2.1", is_export=False).allowed
    assert limiter.check("192.0.2.1", is_export=False).allowed
    limited = limiter.check("192.0.2.1", is_export=False)
    assert not limited.allowed
    assert limited.retry_after == 1

    clock.now += 1
    assert limiter.check("192.0.2.1", is_export=False).allowed
    assert limiter.check("198.51.100.2", is_export=True).allowed
    export_limited = limiter.check("198.51.100.2", is_export=True)
    assert not export_limited.allowed
    assert export_limited.scope == "exports"
    assert export_limited.retry_after == 10


def test_api_rate_limits_are_per_ip_and_expose_retry_headers(settings) -> None:
    configured = replace(settings, request_burst=2)
    app = create_app(configured)
    origin = "https://formosanbank.github.io"
    with TestClient(app, client=("192.0.2.10", 50000)) as client:
        assert client.get("/v1/meta").status_code == 200
        second = client.get("/v1/meta")
        assert second.status_code == 200
        assert second.headers["x-ratelimit-remaining"] == "0"
        limited = client.get("/v1/meta", headers={"Origin": origin})
        assert limited.status_code == 429
        assert limited.json()["error"]["code"] == "rate_limited"
        assert limited.headers["retry-after"] == "1"
        assert limited.headers["cache-control"] == "no-store"
        assert limited.headers["access-control-allow-origin"] == origin

        for _ in range(5):
            assert client.get("/healthz").status_code == 200

    with TestClient(app, client=("198.51.100.10", 50000)) as another_client:
        assert another_client.get("/v1/meta").status_code == 200


def test_exports_have_a_separate_five_request_bucket(settings) -> None:
    configured = replace(settings, request_burst=20, export_burst=2)
    with TestClient(create_app(configured)) as client:
        url = release_path(client, "datasets/export")
        parameters = {"language_id": "lang_amis", "field": "id", "max_rows": 1}
        assert client.get(url, params=parameters).status_code == 200
        second = client.get(url, params=parameters)
        assert second.status_code == 200
        assert second.headers["x-ratelimit-scope"] == "exports"
        limited = client.get(url, params=parameters)
        assert limited.status_code == 429
        assert limited.headers["x-ratelimit-limit"] == "5"
        assert limited.headers["retry-after"] == "12"


def test_query_concurrency_queues_database_connections(settings) -> None:
    store = CorpusStore(load_release(settings), settings.query_step_limit, query_concurrency=1)
    entered = Event()

    def second_query() -> None:
        with store.connect():
            entered.set()

    with ThreadPoolExecutor(max_workers=1) as executor:
        with store.connect():
            future = executor.submit(second_query)
            assert not entered.wait(0.1)
        assert entered.wait(1)
        future.result(timeout=1)
