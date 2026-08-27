from __future__ import annotations

import gzip
import io
import json
import logging
import sqlite3
import zipfile
from contextlib import closing
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app import create_app
from api.config import Settings
from api.exports import spreadsheet_safe
from api.limits import (
    DATASET_EXPORT_MAX_ROWS,
    DATASET_PREVIEW_MAX_ROWS,
    QUERY_MAX_CHARS,
    SEARCH_PAGE_MAX_ROWS,
)
from api.store import CorpusStore


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
    assert language.headers["cache-control"] == "public, max-age=300"

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
    assert body["audio"][0]["playback_urls"] == [
        "https://huggingface.co/datasets/FormosanBank/TestCorpusAudio/resolve/"
        "1111111111111111111111111111111111111111/sentence.wav"
    ]
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
        assert len(dictionary["meanings"][0]["text"]) == 320
        assert dictionary["meanings"][0]["text"].endswith("…")


def test_bidirectional_dictionary_and_concordance(client: TestClient) -> None:
    url = release_path(client, "dictionary")
    dictionary = client.get(url, params={"q": "li", "language_id": "lang_amis", "match": "prefix"})
    assert dictionary.status_code == 200
    assert dictionary.json()["items"][0]["headword"] == "lima"
    assert dictionary.json()["items"][0]["summary_truncated"] is False
    assert dictionary.json()["items"][0]["meanings"] == [
        {"text": "FIVE", "xml_lang": "eng"},
        {"text": "five.word", "xml_lang": "eng"},
    ]

    chinese_meaning = client.get(
        url,
        params={"q": "rima", "language_id": "lang_amis", "match": "exact"},
    )
    assert chinese_meaning.status_code == 200
    assert chinese_meaning.json()["items"][0]["meanings"] == [
        {"text": "虛構測試句", "xml_lang": "zho"}
    ]

    formosan_sentence = client.get(
        release_path(client, "concordance"),
        params={"q": "ima", "language_id": "lang_amis", "match": "contains"},
    )
    assert formosan_sentence.status_code == 200
    assert formosan_sentence.json()["items"]

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

    for query, match in (("fi", "prefix"), ("ive", "contains")):
        flexible_reverse = client.get(
            url,
            params={
                "q": query,
                "language_id": "lang_amis",
                "direction": "translation",
                "translation_language": "eng",
                "match": match,
            },
        )
        assert flexible_reverse.status_code == 200
        assert flexible_reverse.json()["items"][0]["headword"] == "lima"

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

    tier_match = client.get(
        release_path(client, "concordance"),
        params={
            "q": "five.word",
            "language_id": "lang_amis",
            "direction": "translation",
            "translation_language": "eng",
            "match": "exact",
        },
    )
    assert tier_match.status_code == 200
    assert tier_match.json()["items"][0]["match_evidence"] == [
        {
            "tier": "word",
            "field": "translation",
            "text": "five.word",
            "xml_lang": "eng",
            "kind": "gloss",
        }
    ]
    languages = client.get(
        release_path(client, "translation-languages"),
        params={"language_id": "lang_amis"},
    ).json()
    assert {item["xml_lang"] for item in languages} == {"eng", "zho"}


def test_reverse_dictionary_prioritizes_the_matching_translation(settings: Settings) -> None:
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        owner_type, owner_id = connection.execute(
            "SELECT owner_type, owner_id FROM translations WHERE normalized = 'five.word'"
        ).fetchone()
        connection.execute("UPDATE translations SET position = 100 WHERE normalized = 'five.word'")
        connection.executemany(
            """
            INSERT INTO translations (
              id, owner_type, owner_id, position, text, unclear, xml_lang,
              kind, version, notes, normalized, attributes_json, inline_markup_json
            ) VALUES (?, ?, ?, ?, ?, 0, 'eng', '', '', '', ?, '{}', '[]')
            """,
            [
                (
                    f"translation_decoy_{position}",
                    owner_type,
                    owner_id,
                    position,
                    f"decoy {position:02d}",
                    f"decoy {position:02d}",
                )
                for position in range(13)
            ],
        )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            release_path(client, "dictionary"),
            params={
                "q": "five.word",
                "language_id": "lang_amis",
                "direction": "translation",
                "translation_language": "eng",
                "match": "exact",
            },
        )

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["headword"] == "lima"
    assert item["meanings"][0] == {"text": "five.word", "xml_lang": "eng"}


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

    longer_query = client.get(
        release_path(client, "dictionary"),
        params={"q": "x" * 257, "language_id": "lang_amis"},
    )
    assert longer_query.status_code == 200

    too_long = client.get(
        release_path(client, "dictionary"),
        params={"q": "x" * (QUERY_MAX_CHARS + 1), "language_id": "lang_amis"},
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
        ("max_rows", "1"),
    ]
    preview = client.get(release_path(client, "datasets/preview"), params=params)
    assert preview.status_code == 200
    assert preview.json()["estimated_rows"] == 2
    assert preview.json()["returned_rows"] == 1
    assert preview.json()["truncated"] is True
    item = preview.json()["items"][0]
    assert list(item) == ["id", "standard", "translation_eng_1"]
    assert item["translation_eng_1"] == "A fictional translated line."

    exported = client.get(
        release_path(client, "datasets/export"), params=[*params, ("format", "tsv")]
    )
    assert exported.status_code == 200
    assert exported.headers["x-kakarayan-row-count"] == "1"
    assert exported.text.startswith("id\tstandard\ttranslation_eng_1\n")

    larger_export = client.get(
        release_path(client, "datasets/export"),
        params={"language_id": "lang_amis", "max_rows": 1001},
    )
    assert larger_export.status_code == 200

    unbounded = client.get(
        release_path(client, "datasets/export"),
        params={"language_id": "lang_amis", "max_rows": DATASET_EXPORT_MAX_ROWS + 1},
    )
    assert unbounded.status_code == 422


def test_dataset_translations_expand_by_language_and_xml_order(
    settings: Settings,
) -> None:
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        connection.execute(
            """
            INSERT INTO translations
            SELECT id || '-alternative', owner_type, owner_id, position + 100,
                   'A second English rendering.', unclear, xml_lang, kind, version,
                   notes, 'a second english rendering.', attributes_json, inline_markup_json
            FROM translations
            WHERE owner_type = 'sentence' AND xml_lang = 'eng'
            ORDER BY position
            LIMIT 1
            """
        )

    with TestClient(create_app(settings)) as client:
        params = [
            ("language_id", "lang_amis"),
            ("field", "id"),
            ("field", "translations"),
            ("max_rows", "2"),
        ]
        preview = client.get(release_path(client, "datasets/preview"), params=params)
        exported = client.get(
            release_path(client, "datasets/export"),
            params=[*params, ("format", "csv")],
        )

    assert preview.status_code == 200
    body = preview.json()
    assert body["fields"] == [
        "id",
        "translation_eng_1",
        "translation_eng_2",
        "translation_zho_1",
    ]
    first, second = body["items"]
    assert first["translation_eng_1"] == "A fictional translated line."
    assert first["translation_eng_2"] == "A second English rendering."
    assert first["translation_zho_1"] == ""
    assert second["translation_eng_1"] == ""
    assert second["translation_eng_2"] == ""
    assert second["translation_zho_1"] == "虛構測試句"
    assert exported.status_code == 200
    assert exported.text.splitlines()[0] == (
        "id,translation_eng_1,translation_eng_2,translation_zho_1"
    )


def test_complete_translations_require_owner_level_translation(
    client: TestClient,
) -> None:
    response = client.get(
        release_path(client, "datasets/preview"),
        params=[
            ("language_id", "lang_amis"),
            ("record_level", "word"),
            ("complete_fields", "true"),
            ("field", "id"),
            ("field", "translations"),
            ("max_rows", "10"),
        ],
    )

    assert response.status_code == 200
    assert response.json()["estimated_rows"] == 1
    assert response.json()["fields"] == ["id", "translation_eng_1"]
    assert response.json()["items"][0]["translation_eng_1"] == "five.word"


def test_dataset_rejects_pathologically_wide_translation_output(settings: Settings) -> None:
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        connection.execute(
            """
            WITH RECURSIVE numbers(value) AS (
              SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 256
            )
            INSERT INTO translations
            SELECT tr.id || '-wide-' || numbers.value, tr.owner_type, tr.owner_id,
                   tr.position + numbers.value, 'alternative ' || numbers.value,
                   tr.unclear, tr.xml_lang, tr.kind, tr.version, tr.notes,
                   'alternative ' || numbers.value, tr.attributes_json, tr.inline_markup_json
            FROM translations tr CROSS JOIN numbers
            WHERE tr.owner_type = 'sentence' AND tr.xml_lang = 'eng'
            ORDER BY tr.position
            LIMIT 256
            """
        )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            release_path(client, "datasets/preview"),
            params=[
                ("language_id", "lang_amis"),
                ("field", "translations"),
                ("max_rows", "1"),
            ],
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "dataset_too_wide"


def test_dataset_rejects_removed_and_duplicate_fields(client: TestClient) -> None:
    removed = client.get(
        release_path(client, "datasets/preview"),
        params={"language_id": "lang_amis", "field": "translation_columns"},
    )
    duplicate = client.get(
        release_path(client, "datasets/preview"),
        params=[("language_id", "lang_amis"), ("field", "id"), ("field", "id")],
    )

    assert removed.status_code == 422
    assert duplicate.status_code == 422


def test_streaming_export_is_not_limited_to_five_mebibytes(settings: Settings) -> None:
    large_translation = "a" * (5 * 1024 * 1024 + 1)
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        connection.execute(
            "UPDATE translations SET text = ? WHERE owner_type = 'sentence' AND xml_lang = 'eng'",
            (large_translation,),
        )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            release_path(client, "datasets/export"),
            params=[
                ("language_id", "lang_amis"),
                ("field", "id"),
                ("field", "translations"),
                ("max_rows", "2"),
                ("format", "jsonl"),
            ],
        )

    assert response.status_code == 200
    assert len(response.content) > 5 * 1024 * 1024
    assert response.headers["x-kakarayan-row-count"] == "2"


def test_public_capacity_limits_accept_larger_queries(client: TestClient) -> None:
    release = release_path(client, "dictionary")
    assert (
        client.get(
            release,
            params={"q": "lima", "language_id": "lang_amis", "limit": 101},
        ).status_code
        == 200
    )
    assert (
        client.get(
            release,
            params={
                "q": "lima",
                "language_id": "lang_amis",
                "limit": SEARCH_PAGE_MAX_ROWS + 1,
            },
        ).status_code
        == 422
    )
    preview = release_path(client, "datasets/preview")
    assert (
        client.get(
            preview,
            params={"language_id": "lang_amis", "max_rows": 26},
        ).status_code
        == 200
    )
    assert (
        client.get(
            preview,
            params={"language_id": "lang_amis", "max_rows": DATASET_PREVIEW_MAX_ROWS + 1},
        ).status_code
        == 422
    )


def test_dataset_xml_levels_preserve_owners_and_complete_selected_fields(
    client: TestClient,
) -> None:
    sentence = client.get(
        release_path(client, "datasets/preview"),
        params=[
            ("language_id", "lang_amis"),
            ("record_level", "sentence"),
            ("complete_fields", "true"),
            ("field", "id"),
            ("field", "original"),
            ("field", "standard"),
        ],
    )
    assert sentence.status_code == 200
    assert sentence.json()["record_level"] == "sentence"
    assert sentence.json()["estimated_rows"] == 1
    assert sentence.json()["items"][0]["original"].startswith("Lima waco")

    word = client.get(
        release_path(client, "datasets/preview"),
        params=[
            ("language_id", "lang_amis"),
            ("record_level", "word"),
            ("complete_fields", "true"),
            ("q", "lima"),
            ("match", "exact"),
            ("field", "id"),
            ("field", "sentence_id"),
            ("field", "form"),
            ("field", "translations"),
        ],
    )
    assert word.status_code == 200
    word_item = word.json()["items"][0]
    assert word.json()["estimated_rows"] == 1
    assert word_item["form"] == "lima"
    assert word_item["translation_eng_1"] == "five.word"
    assert word_item["sentence_id"]

    morpheme = client.get(
        release_path(client, "datasets/preview"),
        params=[
            ("language_id", "lang_amis"),
            ("record_level", "morpheme"),
            ("complete_fields", "true"),
            ("q", "lima"),
            ("match", "exact"),
            ("field", "id"),
            ("field", "word_id"),
            ("field", "sentence_id"),
            ("field", "form"),
            ("field", "translations"),
        ],
    )
    assert morpheme.status_code == 200
    morpheme_item = morpheme.json()["items"][0]
    assert morpheme_item["form"] == "lima"
    assert morpheme_item["translation_eng_1"] == "FIVE"
    assert morpheme_item["word_id"] != morpheme_item["sentence_id"]


def test_word_and_morpheme_translation_searches_start_from_indexed_candidates(
    client: TestClient,
) -> None:
    for level in ("word", "morpheme"):
        response = client.get(
            release_path(client, "datasets/preview"),
            params=[
                ("language_id", "lang_amis"),
                ("record_level", level),
                ("q", "ive"),
                ("direction", "translation"),
                ("translation_language", "eng"),
                ("match", "contains"),
                ("field", "id"),
                ("field", "form"),
                ("field", "translations"),
            ],
        )
        assert response.status_code == 200
        assert response.json()["estimated_rows"] == 1

    store = cast(FastAPI, client.app).state.store
    assert isinstance(store, CorpusStore)
    query = store._dataset_query(
        language_id="lang_amis",
        corpus_id=None,
        dialect=None,
        q="ive",
        direction="translation",
        translation_language="eng",
        match="contains",
        requirements=(),
        fields=("id", "form", "translations"),
        record_level="word",
        complete_fields=True,
    )
    assert query.prefix.startswith("WITH candidate_ids AS MATERIALIZED")
    assert "FROM translations term" in query.prefix
    assert "JOIN tier_scope ts" in query.prefix
    assert "term.owner_id AS record_id" in query.prefix
    assert "candidate.record_id" in query.source
    assert "normalized" not in query.where


def test_unclear_requirement_includes_translation_and_phonology_tiers(
    settings: Settings,
) -> None:
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        connection.execute("UPDATE forms SET unclear = 0")
        connection.execute("UPDATE phonology SET unclear = 0")
        connection.execute("UPDATE translations SET unclear = 0")
        connection.execute(
            "UPDATE translations SET unclear = 1 WHERE owner_type = 'sentence' AND xml_lang = 'zho'"
        )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            release_path(client, "datasets/preview"),
            params=[
                ("language_id", "lang_amis"),
                ("requirement", "unclear"),
                ("field", "id"),
                ("field", "form"),
            ],
        )

    assert response.status_code == 200
    assert response.json()["estimated_rows"] == 1
    assert response.json()["items"][0]["form"] == "toki rima"


def test_dataset_multi_level_package_has_one_table_per_xml_level(client: TestClient) -> None:
    response = client.get(
        release_path(client, "datasets/export-package"),
        params=[
            ("language_id", "lang_amis"),
            ("record_level", "sentence"),
            ("record_level", "word"),
            ("record_level", "morpheme"),
            ("sentence_field", "id"),
            ("sentence_field", "form"),
            ("word_field", "id"),
            ("word_field", "sentence_id"),
            ("word_field", "form"),
            ("morpheme_field", "id"),
            ("morpheme_field", "word_id"),
            ("morpheme_field", "form"),
            ("format", "csv"),
        ],
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == [
            "sentences.csv",
            "words.csv",
            "morphemes.csv",
            "manifest.json",
        ]
        assert archive.read("words.csv").decode().startswith("id,sentence_id,form\n")
        manifest = json.loads(archive.read("manifest.json"))
        assert [table["record_level"] for table in manifest["tables"]] == [
            "sentence",
            "word",
            "morpheme",
        ]


def test_spreadsheet_export_cells_are_formula_safe() -> None:
    for prefix in ("=", "+", "-", "@", "\t", "\r"):
        assert spreadsheet_safe(f"{prefix}danger") == f"'{prefix}danger"
    assert spreadsheet_safe("ordinary text") == "ordinary text"


def test_request_records_use_route_templates_without_raw_queries(
    client: TestClient, caplog
) -> None:
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    secret_query = "fictional private phrase"
    response = client.get(
        release_path(client, "concordance"),
        params={
            "q": secret_query,
            "language_id": "lang_amis",
            "direction": "translation",
            "match": "contains",
        },
    )
    assert response.headers["server-timing"].startswith("app;dur=")
    records = [
        json.loads(record.message)
        for record in caplog.records
        if record.name == "uvicorn.error" and record.message.startswith("{")
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
        params={"q": "x" * (QUERY_MAX_CHARS + 1), "language_id": "lang_amis"},
    )
    failure = next(
        item
        for item in (
            json.loads(record.message)
            for record in caplog.records
            if record.name == "uvicorn.error" and record.message.startswith("{")
        )
        if item.get("event") == "request" and item.get("failure_code") == "invalid_parameter"
    )
    assert failure["status"] == 422
    assert secret_query not in caplog.text
