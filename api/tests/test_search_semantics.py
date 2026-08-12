from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from api.search import matches, normalize_surface, normalize_text


def _fixture() -> dict:
    return json.loads(
        (Path(__file__).parents[2] / "tests" / "fixtures" / "search-semantics.json").read_text(
            encoding="utf-8"
        )
    )


def test_search_semantics_fixture() -> None:
    fixture = _fixture()
    for case in fixture["surface"]:
        assert normalize_surface(case["input"]) == case["normalized"]
    for case in fixture["text"]:
        assert normalize_text(case["input"]) == case["normalized"]
    for case in fixture["matches"]:
        assert (
            matches(
                case["value"],
                case["query"],
                case["mode"],
                surface=case["surface"],
            )
            is case["matches"]
        )


def test_api_matches_golden_semantics(client: TestClient) -> None:
    release_id = client.get("/readyz").json()["release_id"]
    for case in _fixture()["api"]:
        response = client.get(
            f"/v1/releases/{release_id}/{case['route']}", params=case["parameters"]
        )
        assert response.status_code == 200, case["name"]
        values = [item[case["field"]] for item in response.json()["items"]]
        assert values == case["expected"], case["name"]
