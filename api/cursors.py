"""Opaque keyset pagination cursors bound to a query."""

from __future__ import annotations

import base64
import hashlib
import json
import math

from api.errors import ApiError


def query_fingerprint(parts: object) -> str:
    value = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode()).hexdigest()[:16]


CursorValue = str | int | float


def encode_cursor(position: list[CursorValue], fingerprint: str) -> str:
    payload = json.dumps(
        {"v": 2, "p": position, "q": fingerprint},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str | None, fingerprint: str) -> list[CursorValue] | None:
    if not cursor:
        return None
    try:
        if len(cursor) > 2048:
            raise ValueError
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.b64decode(padded.encode(), altchars=b"-_", validate=True))
        if (
            not isinstance(value, dict)
            or value.get("v") != 2
            or value.get("q") != fingerprint
            or not isinstance(value.get("p"), list)
            or len(value["p"]) > 4
            or any(
                not isinstance(item, str | int | float)
                or isinstance(item, bool)
                or (isinstance(item, float) and not math.isfinite(item))
                for item in value["p"]
            )
        ):
            raise ValueError
        return value["p"]
    except (ValueError, TypeError, json.JSONDecodeError):
        raise ApiError(400, "invalid_cursor", "The cursor is invalid for this query") from None
