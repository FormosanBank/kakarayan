from __future__ import annotations

import json
from pathlib import Path

from api.search import matches, normalize_surface, normalize_text


def test_search_semantics_fixture() -> None:
    fixture = json.loads(
        (Path(__file__).parents[2] / "tests" / "fixtures" / "search-semantics.json").read_text(
            encoding="utf-8"
        )
    )
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
