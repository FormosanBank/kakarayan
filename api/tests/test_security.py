from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Event
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app import create_app
from api.errors import ApiError
from api.release import load_release
from api.security import PerIpRateLimiter, RatePolicy
from api.store import CorpusStore, QueryBudget, use_query_budget


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


def test_query_concurrency_rejects_work_after_a_bounded_wait(settings) -> None:
    with CorpusStore(
        load_release(settings),
        settings.query_step_limit,
        query_concurrency=1,
        query_queue_wait_seconds=0.05,
    ) as store:
        entered = Event()

        def second_query() -> None:
            with pytest.raises(ApiError) as busy:
                with store.connect():
                    entered.set()
            assert busy.value.status == 503
            assert busy.value.code == "server_busy"
            assert busy.value.headers["Retry-After"] == "1"

        with ThreadPoolExecutor(max_workers=1) as executor:
            with store.connect():
                future = executor.submit(second_query)
                assert not entered.wait(0.1)
            future.result(timeout=1)


def test_analytical_work_leaves_one_slot_for_interactive_queries(settings) -> None:
    store = CorpusStore(
        load_release(settings),
        settings.query_step_limit,
        query_concurrency=2,
        query_queue_wait_seconds=0.05,
        analytical_query_concurrency=1,
    )
    blocked_budget = QueryBudget.for_timeout(2, workload="analytical")

    def second_analytical_query() -> None:
        with use_query_budget(blocked_budget), pytest.raises(ApiError) as busy:
            with store.connect():
                pass
        assert busy.value.status == 503
        assert busy.value.code == "server_busy"

    active_budget = QueryBudget.for_timeout(2, workload="analytical")
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            with use_query_budget(active_budget), store.connect():
                future = executor.submit(second_analytical_query)
                with store.connect(QueryBudget.for_timeout(2)) as connection:
                    assert connection.execute("SELECT 1").fetchone()[0] == 1
                future.result(timeout=1)
    finally:
        store.close()


def test_store_reuses_tuned_sqlite_connections(settings) -> None:
    store = CorpusStore(
        load_release(settings),
        settings.query_step_limit,
        query_concurrency=1,
        sqlite_cache_mib=64,
        sqlite_mmap_mib=256,
    )
    try:
        with store.connect() as first:
            identifier = id(first)
            assert first.execute("PRAGMA cache_size").fetchone()[0] == -(64 * 1024)
            assert first.execute("PRAGMA mmap_size").fetchone()[0] == 256 * 1024 * 1024
            assert first.execute("PRAGMA temp_store").fetchone()[0] == 2
        with store.connect() as second:
            assert id(second) == identifier
    finally:
        store.close()


def test_ready_does_not_wait_for_a_query_slot(settings) -> None:
    configured = replace(
        settings,
        query_concurrency=1,
        query_queue_wait_seconds=0.05,
    )
    with TestClient(create_app(configured)) as client:
        store = cast(FastAPI, client.app).state.store
        with store.connect():
            started = time.monotonic()
            response = client.get("/readyz")
            elapsed = time.monotonic() - started

    assert response.status_code == 200
    assert elapsed < 0.05


def test_busy_query_returns_503_instead_of_waiting(settings) -> None:
    configured = replace(
        settings,
        query_concurrency=1,
        query_queue_wait_seconds=0.01,
    )
    with TestClient(create_app(configured)) as client:
        release_id = client.get("/readyz").json()["release_id"]
        store = cast(FastAPI, client.app).state.store
        with store.connect():
            response = client.get(
                f"/v1/releases/{release_id}/dictionary",
                params={"q": "toki", "language_id": "lang_amis"},
                headers={"Origin": "https://formosanbank.github.io"},
            )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "server_busy"
    assert response.headers["retry-after"] == "1"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["access-control-allow-origin"] == "https://formosanbank.github.io"


def test_dataset_work_cannot_consume_the_interactive_lane(settings) -> None:
    configured = replace(
        settings,
        query_concurrency=2,
        analytical_query_concurrency=1,
        query_queue_wait_seconds=0.01,
    )
    with TestClient(create_app(configured)) as client:
        release_id = client.get("/readyz").json()["release_id"]
        store = cast(FastAPI, client.app).state.store
        budget = QueryBudget.for_timeout(2, workload="analytical")
        with use_query_budget(budget), store.connect():
            preview = client.get(
                f"/v1/releases/{release_id}/datasets/preview",
                params={"language_id": "lang_amis", "field": "id", "max_rows": 1},
            )
            lookup = client.get(
                f"/v1/releases/{release_id}/dictionary",
                params={"q": "toki", "language_id": "lang_amis"},
            )

    assert preview.status_code == 503
    assert preview.json()["error"]["code"] == "server_busy"
    assert lookup.status_code == 200
    assert lookup.json()["items"]


def test_query_deadline_interrupts_sqlite_and_releases_slot(settings) -> None:
    with CorpusStore(
        load_release(settings), settings.query_step_limit, query_concurrency=1
    ) as store:
        budget = QueryBudget.for_timeout(0.001)

        with pytest.raises(ApiError) as timed_out, use_query_budget(budget):
            with store.connect() as connection:
                connection.execute(
                    "WITH RECURSIVE counter(value) AS ("
                    "SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 100000000"
                    ") SELECT SUM(value) FROM counter"
                ).fetchone()

        assert timed_out.value.status == 504
        assert timed_out.value.code == "query_timed_out"
        with store.connect() as connection:
            assert connection.execute("SELECT 1").fetchone()[0] == 1


def test_cancelled_query_interrupts_sqlite(settings) -> None:
    with CorpusStore(load_release(settings), settings.query_step_limit) as store:
        budget = QueryBudget.for_timeout(10)

        with pytest.raises(ApiError) as cancelled, use_query_budget(budget):
            with store.connect() as connection:
                budget.cancel()
                connection.execute(
                    "WITH RECURSIVE counter(value) AS ("
                    "SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 100000000"
                    ") SELECT SUM(value) FROM counter"
                ).fetchone()

        assert cancelled.value.status == 408
        assert cancelled.value.code == "query_cancelled"
