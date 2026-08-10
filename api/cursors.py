"""Opaque pagination cursors bound to a query."""

from __future__ import annotations

import base64
import hashlib
import json

from api.errors import ApiError


def query_fingerprint(parts: object) -> str:
    value = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode()).hexdigest()[:16]


def encode_cursor(offset: int, fingerprint: str) -> str:
    payload = json.dumps(
        {"v": 1, "o": offset, "q": fingerprint},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str | None, fingerprint: str) -> int:
    if not cursor:
        return 0
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        if (
            value.get("v") != 1
            or value.get("q") != fingerprint
            or not isinstance(value.get("o"), int)
            or value["o"] < 0
            or value["o"] > 1_000_000
        ):
            raise ValueError
        return int(value["o"])
    except (ValueError, TypeError, json.JSONDecodeError):
        raise ApiError(400, "invalid_cursor", "The cursor is invalid for this query") from None
