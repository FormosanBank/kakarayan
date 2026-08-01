from __future__ import annotations

from typing import cast
from unittest.mock import patch

from publisher.model_catalog import build_model_catalog


def test_public_model_catalog_maps_models_and_services() -> None:
    models = [
        {
            "id": "FormosanBank/nllb200-formosan-en-spm8k",
            "pipeline_tag": "translation",
            "lastModified": "2026-07-16T18:33:01.000Z",
            "cardData": {
                "license": "cc-by-nc-4.0",
                "language": ["ami", "eng"],
                "tags": ["private-no-bible"],
            },
        },
        {
            "id": "FormosanBank/formosan-asr-amis",
            "pipeline_tag": "automatic-speech-recognition",
            "lastModified": "2026-07-28T06:48:44.000Z",
            "cardData": {"license": "cc-by-4.0", "language": ["ami"]},
        },
    ]
    spaces = [
        {
            "id": "FormosanBank/formosan-mt",
            "host": "https://formosanbank-formosan-mt.hf.space",
            "runtime": {"stage": "RUNNING", "domains": [{"stage": "READY"}]},
        },
        {
            "id": "FormosanBank/formosan_asr",
            "host": "https://formosanbank-formosan-asr.hf.space",
            "runtime": {"stage": "SLEEPING", "domains": []},
        },
    ]
    with patch("publisher.model_catalog._get_json", side_effect=[models, spaces]):
        catalog = build_model_catalog()

    model_rows = cast(list[dict[str, object]], catalog["models"])
    service_rows = cast(list[dict[str, object]], catalog["services"])
    assert [row["task"] for row in model_rows] == [
        "automatic-speech-recognition",
        "translation",
    ]
    translation = next(row for row in model_rows if row["task"] == "translation")
    assert translation["license"] == "cc-by-nc-4.0"
    assert translation["direction"] == "Formosan → English"
    assert "private" in str(translation["training_lineage"]).lower()
    assert service_rows[0]["status"] == "available"
    assert service_rows[0]["api_name"] == "/translate"
    assert service_rows[0]["api_url"] == "https://formosanbank-formosan-mt.hf.space"
    assert service_rows[0]["checked_at"]
    assert service_rows[1]["status"] == "sleeping"
    assert service_rows[1]["api_name"] == "/transcribe"
    assert "Hugging Face" in str(service_rows[0]["third_party_notice"])
