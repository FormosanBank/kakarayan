from __future__ import annotations

import gzip
import json
import logging
import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient

from api.app import _spreadsheet_safe, create_app
from api.config import Settings
from api.dataset_fields import project_record


def release_path(client: TestClient, path: str) -> str:
    release_id = client.get("/readyz").json()["release_id"]
    return f"/v1/releases/{release_id}/{path}"


def test_health_catalogues_and_contract(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "alive"}
    ready = client.get("/readyz")
    assert ready.status_code == 200
    release_id = ready.json()["release_id"]
    assert release_id.startswith("fb-20240102-")
    assert ready.headers["x-content-type-options"] == "nosniff"

    meta = client.get("/v1/meta")
    assert meta.headers["cache-control"] == "public, max-age=300"
    assert meta.headers["x-kakarayan-release"] == meta.json()["release_id"]
    languages = client.get("/v1/languages").json()
    amis = next(item for item in languages if item["name"] == "Amis")
    language = client.get(f"/v1/releases/{release_id}/languages/{amis['id']}")
    assert language.json()["name"] == "Amis"
    assert "immutable" in language.headers["cache-control"]

    corpora = client.get("/v1/corpora").json()
    assert corpora[0]["name"] == "TestCorpus"
    assert client.get(f"/v1/releases/{release_id}/corpora/{corpora[0]['id']}").status_code == 200
    assert client.get("/v1/downloads").json()["artifacts"]
    assert "entries" in client.get("/v1/rights").json()
    assert "models" in client.get("/v1/models").json()
    assert client.get("/openapi.json").json()["info"]["title"].startswith("Kakarayan")
    assert client.get("/docs").status_code == 200


def test_record_summary_then_detail(client: TestClient) -> None:
    result = client.get(
        release_path(client, "concordance"),
        params={"q": "lima", "language_id": "lang_amis", "match": "exact"},
        headers={"Accept-Encoding": "gzip"},
    )
    assert result.status_code == 200
    assert result.headers["content-encoding"] == "gzip"
    assert len(gzip.compress(result.content)) <= 100 * 1024
    summary = result.json()["items"][0]
    assert "words" not in summary
    assert summary["translation_count"] == len(summary["translations"])
    assert summary["summary_truncated"] is False
    sentence = client.get(release_path(client, f"sentences/{summary['id']}"))
    assert sentence.status_code == 200
    body = sentence.json()
    assert body["standard"] == "lima waco"
    assert body["forms"][0]["kind"] == "standard"
    assert body["words"][0]["morphemes"][0]["id"]
    assert any(item["text"] == "FIVE" for item in body["tier_translations"])

    text = client.get(release_path(client, f"texts/{body['parent_id']}"))
    assert text.json()["source_path"] == "Corpora/TestCorpus/XML/fixture.xml"
    assert text.json()["sentence_count"] == 2


def test_summary_is_bounded_without_truncating_record_detail(settings: Settings) -> None:
    complete_text = "x" * 5000
    complete_gloss = "g" * 5000
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        sentence_id = connection.execute(
            "SELECT owner_id FROM forms WHERE owner_type = 'sentence' AND text = 'lima waco'"
        ).fetchone()[0]
        connection.execute(
            "UPDATE forms SET text = ? WHERE owner_type = 'sentence' AND owner_id = ?",
            (complete_text, sentence_id),
        )
        connection.execute(
            "UPDATE translations SET text = ? WHERE owner_type = 'morpheme' AND text = 'FIVE'",
            (complete_gloss,),
        )
    with TestClient(create_app(settings)) as client:
        result = client.get(
            release_path(client, "concordance"),
            params={"q": "lima", "language_id": "lang_amis", "match": "exact"},
        )
        summary = result.json()["items"][0]
        assert summary["summary_truncated"] is True
        assert len(summary["standard"]) == 480
        assert summary["standard"].endswith("…")
        detail = client.get(release_path(client, f"sentences/{summary['id']}")).json()
        assert detail["standard"] == complete_text
        assert any(item["text"] == complete_gloss for item in detail["tier_translations"])
        dictionary = client.get(
            release_path(client, "dictionary"),
            params={"q": "lima", "language_id": "lang_amis", "match": "exact"},
        ).json()["items"][0]
        assert dictionary["summary_truncated"] is True
        assert len(dictionary["meanings"][0]) == 320
        assert dictionary["meanings"][0].endswith("…")


def test_bidirectional_dictionary_and_concordance(client: TestClient) -> None:
    url = release_path(client, "dictionary")
    dictionary = client.get(url, params={"q": "li", "language_id": "lang_amis", "match": "prefix"})
    assert dictionary.status_code == 200
    assert dictionary.json()["items"][0]["headword"] == "lima"
    assert dictionary.json()["items"][0]["summary_truncated"] is False

    reverse = client.get(
        url,
        params={
            "q": "five",
            "language_id": "lang_amis",
            "direction": "translation",
            "translation_language": "eng",
            "match": "exact",
        },
    )
    assert reverse.status_code == 200
    assert reverse.json()["items"][0]["headword"] == "lima"

    translated = client.get(
        release_path(client, "concordance"),
        params={
            "q": "fictional",
            "language_id": "lang_amis",
            "direction": "translation",
            "translation_language": "eng",
            "match": "contains",
        },
    )
    assert translated.status_code == 200
    assert translated.json()["items"][0]["translations"][0]["xml_lang"] == "eng"
    languages = client.get(
        release_path(client, "translation-languages"),
        params={"language_id": "lang_amis"},
    ).json()
    assert {item["xml_lang"] for item in languages} == {"eng", "zho"}


def test_keyset_pages_and_query_identity(client: TestClient) -> None:
    url = release_path(client, "frequencies")
    first = client.get(url, params={"language_id": "lang_amis", "limit": 1})
    body = first.json()
    assert body["next_cursor"]
    second = client.get(
        url,
        params={"language_id": "lang_amis", "limit": 1, "cursor": body["next_cursor"]},
    )
    assert second.status_code == 200
    assert second.json()["items"] != body["items"]
    wrong_query = client.get(
        url,
        params={
            "language_id": "lang_amis",
            "prefix": "l",
            "limit": 1,
            "cursor": body["next_cursor"],
        },
    )
    assert wrong_query.status_code == 400


def test_search_cursors_do_not_duplicate_or_skip_when_page_size_changes(
    client: TestClient,
) -> None:
    for route in ("dictionary", "concordance"):
        url = release_path(client, route)
        parameters = {
            "q": "a",
            "language_id": "lang_amis",
            "match": "contains",
        }
        complete = client.get(url, params={**parameters, "limit": 100}).json()["items"]
        first = client.get(url, params={**parameters, "limit": 1}).json()
        assert first["next_cursor"]
        rest = client.get(
            url,
            params={**parameters, "limit": 100, "cursor": first["next_cursor"]},
        ).json()
        paged = [*first["items"], *rest["items"]]
        assert [item["id"] for item in paged] == [item["id"] for item in complete]
        assert len({item["id"] for item in paged}) == len(paged)


def test_summaries_bounds_errors_cors_and_read_only(client: TestClient) -> None:
    summary = client.get(release_path(client, "summaries"), params={"language_id": "lang_amis"})
    assert summary.status_code == 200
    assert summary.json()["sentences"] == 2
    assert summary.json()["source_types"] >= len(summary.json()["source_frequencies"])

    too_long = client.get(
        release_path(client, "dictionary"),
        params={"q": "x" * 257, "language_id": "lang_amis"},
    )
    assert too_long.status_code == 422
    assert too_long.json()["error"]["field"] == "q"
    assert (
        client.get(
            "/v1/releases/not-active/dictionary", params={"q": "x", "language_id": "lang_amis"}
        ).status_code
        == 404
    )
    assert client.post(release_path(client, "dictionary")).status_code == 405

    preflight = client.options(
        "/v1/meta",
        headers={
            "Origin": "https://formosanbank.github.io",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.headers["access-control-allow-origin"] == "https://formosanbank.github.io"
    denied = client.options(
        "/v1/meta",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in denied.headers


def test_bounded_dataset_preview_and_export(client: TestClient) -> None:
    params = [
        ("language_id", "lang_amis"),
        ("field", "id"),
        ("field", "standard"),
        ("field", "translations"),
        ("field", "glosses"),
        ("max_rows", "1"),
    ]
    preview = client.get(release_path(client, "datasets/preview"), params=params)
    assert preview.status_code == 200
    assert preview.json()["estimated_rows"] == 2
    assert preview.json()["returned_rows"] == 1
    assert preview.json()["truncated"] is True
    item = preview.json()["items"][0]
    assert list(item) == ["id", "standard", "translations", "glosses"]
    assert "FIVE" not in item["translations"]
    assert "FIVE" in item["glosses"]
    detail = client.get(release_path(client, f"sentences/{item['id']}")).json()
    assert item == project_record(detail, ["id", "standard", "translations", "glosses"])

    exported = client.get(
        release_path(client, "datasets/export"), params=[*params, ("format", "tsv")]
    )
    assert exported.status_code == 200
    assert exported.headers["x-kakarayan-row-count"] == "1"
    assert exported.text.startswith("id\tstandard\ttranslations\tglosses\n")

    unbounded = client.get(
        release_path(client, "datasets/export"),
        params={"language_id": "lang_amis", "max_rows": 1001},
    )
    assert unbounded.status_code == 422


def test_spreadsheet_export_cells_are_formula_safe() -> None:
    for prefix in ("=", "+", "-", "@", "\t", "\r"):
        assert _spreadsheet_safe(f"{prefix}danger") == f"'{prefix}danger"
    assert _spreadsheet_safe("ordinary text") == "ordinary text"


def test_request_records_use_route_templates_without_raw_queries(
    client: TestClient, caplog
) -> None:
    caplog.set_level(logging.INFO, logger="kakarayan.api")
    secret_query = "fictional private phrase"
    client.get(
        release_path(client, "concordance"),
        params={
            "q": secret_query,
            "language_id": "lang_amis",
            "direction": "translation",
            "match": "contains",
        },
    )
    records = [
        json.loads(record.message)
        for record in caplog.records
        if record.name == "kakarayan.api" and record.message.startswith("{")
    ]
    request = next(
        item
        for item in records
        if item.get("event") == "request" and str(item.get("route", "")).endswith("/concordance")
    )
    assert request["route"].endswith("/concordance")
    assert request["status"] == 200
    assert "duration_ms" in request
    assert secret_query not in caplog.text

    client.get(
        release_path(client, "dictionary"),
        params={"q": "x" * 257, "language_id": "lang_amis"},
    )
    failure = next(
        item
        for item in (
            json.loads(record.message)
            for record in caplog.records
            if record.name == "kakarayan.api" and record.message.startswith("{")
        )
        if item.get("event") == "request" and item.get("failure_code") == "invalid_parameter"
    )
    assert failure["status"] == 422
    assert secret_query not in caplog.text
