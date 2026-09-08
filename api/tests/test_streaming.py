import asyncio
import io
import json
import logging
import time
import tracemalloc
import zipfile
from collections.abc import Iterator
from dataclasses import replace
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app import create_app
from api.config import Settings
from api.errors import ApiError
from api.exports import dataset_chunks, zip_chunks
from api.store import CorpusStore, DatasetStream, QueryBudget
from api.streaming import StreamProgress, controlled_chunks


def test_export_preflight_validates_without_scanning_or_consuming_export_bucket(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    with TestClient(create_app(replace(settings, exports_per_minute=1, export_burst=1))) as client:
        store = cast(CorpusStore, cast(FastAPI, client.app).state.store)
        route = f"/v1/releases/{store.release_id}/datasets/export"
        params = {"language_id": "lang_amis", "field": "id", "max_rows": 2}
        original = store.stream_dataset
        monkeypatch.setattr(
            store, "stream_dataset", lambda **_kwargs: pytest.fail("preflight scanned")
        )
        for _ in range(3):
            assert (
                client.get(route, params={**params, "preflight": True}).json()["status"] == "ready"
            )
        assert (
            client.get(route, params={**params, "preflight": True, "field": "nope"}).status_code
            == 422
        )
        assert (
            client.get(
                route, params={**params, "preflight": True, "language_id": "unknown"}
            ).status_code
            == 404
        )
        monkeypatch.setattr(store, "stream_dataset", original)
        assert client.get(route, params=params).status_code == 200
        assert client.get(route, params=params).status_code == 429


def test_stream_outcomes_batching_deadline_and_cleanup() -> None:
    async def run() -> None:
        closed = []

        def chunks() -> Iterator[bytes]:
            try:
                for _ in range(10_000):
                    yield b"x" * 100
            finally:
                closed.append(True)

        progress = StreamProgress()
        result = [
            chunk
            async for chunk in controlled_chunks(chunks(), QueryBudget.for_timeout(10), progress)
        ]
        assert b"".join(result) == b"x" * 1_000_000
        assert len(result) < 50  # Not one worker submission per row.
        assert progress.outcome == "completed" and closed == [True]

        for timeout, limit, code in [(0, 1000, "query_timed_out"), (10, 10, "export_too_large")]:
            progress = StreamProgress()
            with pytest.raises(ApiError) as error:
                async for _ in controlled_chunks(
                    chunks(), QueryBudget.for_timeout(timeout), progress, max_bytes=limit
                ):
                    pass
            assert error.value.code == code
            assert progress.outcome == "failed"

        progress = StreamProgress()
        stream = controlled_chunks(chunks(), QueryBudget.for_timeout(10), progress)
        await anext(stream)
        started = time.monotonic()
        await stream.aclose()
        assert time.monotonic() - started < 0.5
        assert progress.outcome == "disconnected"
        assert closed[-1] is True

        def broken() -> Iterator[bytes]:
            yield b"prefix"
            raise ValueError("invalid serialization")

        progress = StreamProgress()
        with pytest.raises(ValueError):
            async for _ in controlled_chunks(broken(), QueryBudget.for_timeout(10), progress):
                pass
        assert progress.outcome == "failed" and progress.failure_code == "serialization_error"

    asyncio.run(run())


@pytest.mark.parametrize("format", ["csv", "tsv", "jsonl"])
def test_large_serialization_is_bounded_and_zip_is_complete(format: str) -> None:
    from typing import Literal

    kind = cast(Literal["csv", "tsv", "jsonl"], format)
    count = 25_000
    progress = StreamProgress()
    result = DatasetStream(
        "fb-test",
        "sentence",
        False,
        count,
        count,
        False,
        ("id", "text"),
        ({"id": str(i), "text": '中文,\t"\n' + "a" * 512} for i in range(count)),
    )
    tracemalloc.start()
    size = sum(len(chunk) for chunk in dataset_chunks(result, kind, progress=progress))
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert size > 10_000_000 and peak < 2 * 1024 * 1024
    assert progress.rows_serialized == count
    archive_bytes = b"".join(zip_chunks((("test.txt", iter([b"first\n", b"second\n"])),), b"{}"))
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.testzip() is None
        assert archive.read("test.txt") == b"first\nsecond\n"
        assert json.loads(archive.read("manifest.json")) == {}


def test_logs_describe_final_bytes_without_user_contents(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    release = client.get("/readyz").json()["release_id"]
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    response = client.get(
        f"/v1/releases/{release}/datasets/export",
        params={"language_id": "lang_amis", "field": "id"},
        headers={"Accept-Encoding": "identity"},
    )
    client.get("/not-a-route-user-secret")
    events = [
        json.loads(record.message) for record in caplog.records if record.message.startswith("{")
    ]
    export = next(event for event in events if event.get("route", "").endswith("/export"))
    assert export["outcome"] == "completed"
    assert export["response_bytes"] == len(response.content) > 0
    assert export["rows_serialized"] == 2
    assert export["queue_wait_ms"] >= 0
    assert events[-1]["route"] == "unmatched"
    assert "user-secret" not in json.dumps(events)
