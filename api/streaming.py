"""Bounded export batching and completion metrics, without collecting the file."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator, Iterator
from contextlib import suppress
from dataclasses import dataclass

from api.errors import ApiError
from api.limits import DATASET_EXPORT_MAX_BYTES
from api.store import QueryBudget


@dataclass
class StreamProgress:
    rows_serialized: int = 0
    bytes_yielded: int = 0
    outcome: str = "started"
    failure_code: str | None = None


def _batch(chunks: Iterator[bytes], budget: QueryBudget) -> tuple[bool, bytes]:
    output = bytearray()
    for _ in range(256):
        reason = budget.interruption_reason()
        if reason:
            raise ApiError(
                408 if reason == "cancelled" else 504,
                "query_cancelled" if reason == "cancelled" else "query_timed_out",
                "The export was interrupted. Retry with a smaller selection.",
            )
        try:
            output.extend(next(chunks))
        except StopIteration:
            return True, bytes(output)
        if len(output) >= 64 * 1024:
            break
    return False, bytes(output)


async def controlled_chunks(
    chunks: Iterator[bytes],
    budget: QueryBudget,
    progress: StreamProgress,
    *,
    max_bytes: int = DATASET_EXPORT_MAX_BYTES,
) -> AsyncGenerator[bytes]:
    pending: asyncio.Task[tuple[bool, bytes]] | None = None
    try:
        while True:
            # Shield the worker so cancellation can await its exit before closing
            # the generator and returning its SQLite connection to the pool.
            pending = asyncio.create_task(asyncio.to_thread(_batch, chunks, budget))
            complete, chunk = await asyncio.shield(pending)
            if chunk:
                if progress.bytes_yielded + len(chunk) > max_bytes:
                    raise ApiError(
                        422,
                        "export_too_large",
                        "The export exceeds the byte limit. Use a smaller selection.",
                    )
                progress.bytes_yielded += len(chunk)
                yield chunk
            if complete:
                progress.outcome = "completed"
                return
    except (asyncio.CancelledError, GeneratorExit):
        progress.outcome = "disconnected"
        raise
    except Exception as error:
        progress.outcome = "failed"
        progress.failure_code = error.code if isinstance(error, ApiError) else "serialization_error"
        raise
    finally:
        budget.cancel()
        if pending and not pending.done():
            with suppress(ApiError, asyncio.CancelledError):
                await asyncio.shield(pending)
        close = getattr(chunks, "close", None)
        if close:
            await asyncio.to_thread(close)


def elapsed_ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)
