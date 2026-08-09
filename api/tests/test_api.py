from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_catalogues_and_contract(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "alive"}
    ready = client.get("/readyz")
    assert ready.status_code == 200
    assert ready.json()["release_id"].startswith("fb-20240102-")
    assert ready.headers["x-content-type-options"] == "nosniff"

    meta = client.get("/v1/meta")
    assert meta.status_code == 200
    assert meta.headers["cache-control"] == "public, max-age=300"
    assert meta.headers["x-kakarayan-release"] == meta.json()["release_id"]
    languages = client.get("/v1/languages").json()
    amis = next(item for item in languages if item["name"] == "Amis")
    assert client.get(f"/v1/languages/{amis['id']}").json()["name"] == "Amis"

    corpora = client.get("/v1/corpora").json()
    assert corpora[0]["name"] == "TestCorpus"
    assert client.get(f"/v1/corpora/{corpora[0]['id']}").json()["name"] == "TestCorpus"
    assert client.get("/v1/downloads").json()["artifacts"]
    assert "entries" in client.get("/v1/rights").json()
    assert "models" in client.get("/v1/models").json()
    assert client.get("/openapi.json").json()["info"]["title"].startswith("Kakarayan")
    assert client.get("/docs").status_code == 200


def test_record_endpoints_preserve_tiers(client: TestClient) -> None:
    result = client.get(
        "/v1/concordance",
        params={
            "q": "lima",
            "language_id": "lang_amis",
            "field": "form",
            "match": "exact",
        },
    )
    assert result.status_code == 200
    sentence_id = result.json()["items"][0]["id"]
    sentence = client.get(f"/v1/sentences/{sentence_id}").json()
    assert sentence["tiers"]["forms"][0]["kind"] == "standard"
    assert sentence["tiers"]["forms"][1]["kind"] == "original"
    assert sentence["words"][0]["morphemes"][0]["tiers"]["translations"][0]["text"] == "FIVE"

    text = client.get(f"/v1/texts/{sentence['parent_id']}").json()
    assert text["source_path"] == "Corpora/TestCorpus/XML/fixture.xml"
    assert text["sentence_count"] == 2


def test_dictionary_concordance_and_frequencies(client: TestClient) -> None:
    dictionary = client.get(
        "/v1/dictionary",
        params={"q": "li", "language_id": "lang_amis", "match": "prefix"},
    )
    assert dictionary.status_code == 200
    assert dictionary.json()["items"][0]["headword"] == "lima"

    translated = client.get(
        "/v1/concordance",
        params={
            "q": "fictional",
            "language_id": "lang_amis",
            "field": "translation",
            "match": "contains",
        },
    )
    assert translated.status_code == 200
    assert translated.json()["items"][0]["tiers"]["translations"][0]["xml_lang"] == "eng"

    frequencies = client.get(
        "/v1/frequencies",
        params={"language_id": "lang_amis", "sort": "count", "limit": 1},
    )
    assert frequencies.status_code == 200
    body = frequencies.json()
    assert len(body["items"]) == 1
    assert body["next_cursor"]
    second = client.get(
        "/v1/frequencies",
        params={
            "language_id": "lang_amis",
            "sort": "count",
            "limit": 1,
            "cursor": body["next_cursor"],
        },
    )
    assert second.status_code == 200
    assert second.json()["items"]


def test_bounds_errors_cors_and_read_only_surface(client: TestClient) -> None:
    too_long = client.get(
        "/v1/dictionary",
        params={"q": "x" * 257, "language_id": "lang_amis"},
    )
    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "invalid_parameter"
    assert too_long.json()["error"]["field"] == "q"

    bad_cursor = client.get(
        "/v1/frequencies",
        params={"language_id": "lang_amis", "cursor": "not-a-cursor"},
    )
    assert bad_cursor.status_code == 400
    assert bad_cursor.json()["error"]["code"] == "invalid_cursor"
    assert client.post("/v1/dictionary").status_code == 405

    preflight = client.options(
        "/v1/meta",
        headers={
            "Origin": "https://formosanbank.github.io",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "https://formosanbank.github.io"
    denied = client.options(
        "/v1/meta",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in denied.headers
