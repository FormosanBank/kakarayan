"""Final ASGI response outcomes. Never record client addresses or request contents."""

import json
import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.streaming import elapsed_ms


class RequestTelemetry:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status, sent, completed = 500, 0, False
        failure = None

        async def record_send(message: Message) -> None:
            nonlocal status, sent, completed
            await send(message)
            if message["type"] == "http.response.start":
                status = message["status"]
            elif message["type"] == "http.response.body":
                sent += len(message.get("body", b""))
                completed = not message.get("more_body", False)

        try:
            await self.app(scope, receive, record_send)
        except Exception:
            failure = "response_failed"
            raise
        finally:
            state = scope.get("state", {})
            budget = state.get("query_budget")
            stream = state.get("stream_progress")
            failure = state.get("failure_code") or (stream.failure_code if stream else failure)
            event = {
                "event": "request",
                "method": scope["method"],
                "route": getattr(scope.get("route"), "path", "unmatched"),
                "status": status,
                "release_id": state.get("release_id"),
                "duration_ms": elapsed_ms(started),
                "queue_wait_ms": round(budget.queue_wait_seconds * 1000) if budget else 0,
                "database_slot_ms": round(budget.slot_seconds * 1000) if budget else 0,
                "response_bytes": sent,
                "rows_serialized": stream.rows_serialized if stream else None,
                "outcome": "completed" if completed else "failed" if failure else "disconnected",
                "failure_code": failure,
            }
            logging.getLogger("uvicorn.error").info(json.dumps(event, separators=(",", ":")))
