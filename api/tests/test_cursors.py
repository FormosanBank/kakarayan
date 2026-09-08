from __future__ import annotations

import base64
import json
import math

import pytest
from fastapi.testclient import TestClient

from api.cursors import decode_cursor, encode_cursor, query_fingerprint
from api.errors import ApiError


@pytest.mark.parametrize("value", [[], None, 1, "cursor", True])
def test_cursor_requires_an_object(value: object) -> None:
    cursor = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    with pytest.raises(ApiError, match="invalid"):
        decode_cursor(cursor, "query")


@pytest.mark.parametrize("position", [[math.nan], [math.inf], [True], [{}]])
def test_cursor_rejects_invalid_positions(position: list[object]) -> None:
    cursor = base64.urlsafe_b64encode(
        json.dumps({"v": 2, "p": position, "q": "query"}).encode()
    ).decode()
    with pytest.raises(ApiError):
        decode_cursor(cursor, "query")


def test_cursor_is_strictly_encoded_and_query_bound() -> None:
    fingerprint = query_fingerprint(["release-one", "dictionary", "word"])
    cursor = encode_cursor(["word"], fingerprint)
    assert decode_cursor(cursor, fingerprint) == ["word"]
    for invalid in (f"!{cursor}", "a" * 2049):
        with pytest.raises(ApiError):
            decode_cursor(invalid, fingerprint)
    with pytest.raises(ApiError):
        decode_cursor(cursor, query_fingerprint(["release-two", "dictionary", "word"]))


def test_invalid_cursor_returns_a_client_error(client: TestClient) -> None:
    release = client.get("/readyz").json()["release_id"]
    response = client.get(
        f"/v1/releases/{release}/concordance",
        params={"q": "lima", "language_id": "lang_amis", "cursor": "W10"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_cursor"
