"""Public Hugging Face model and service catalogue generation."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Any

from publisher.identifiers import dimension_id

HF_API = "https://huggingface.co/api"
ORGANIZATION = "FormosanBank"
FORMOSAN_CODES = {
    "ami",
    "bnn",
    "ckv",
    "dru",
    "pwn",
    "pyu",
    "ssf",
    "sxr",
    "szy",
    "tao",
    "tay",
    "trv",
    "tsu",
    "xnb",
    "xsy",
}
KNOWN_SPACES = {
    "FormosanBank/formosan-mt": ["translation"],
    "FormosanBank/formosan_asr": ["automatic-speech-recognition"],
    "FormosanBank/Amis_ASR_transcription": ["automatic-speech-recognition"],
    "FormosanBank/paiwan_transcription": ["automatic-speech-recognition"],
}


class CatalogueFetchError(RuntimeError):
    """Raised when strict public metadata collection cannot complete."""


def _get_json(url: str, timeout: float) -> Any:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "kakarayan-publisher/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise CatalogueFetchError(f"Cannot read public metadata from {url}: {exc}") from exc


def _direction(repository: str) -> str | None:
    name = repository.rsplit("/", 1)[-1]
    pairs = {
        "formosan-en": "Formosan → English",
        "en-formosan": "English → Formosan",
        "formosan-zh": "Formosan → Mandarin",
        "zh-formosan": "Mandarin → Formosan",
    }
    return next((label for marker, label in pairs.items() if marker in name), None)


def _model_row(item: dict[str, Any]) -> dict[str, object]:
    repository = str(item["id"])
    card = item.get("cardData") or {}
    languages = [str(value) for value in card.get("language") or []]
    task = str(item.get("pipeline_tag") or card.get("pipeline_tag") or "")
    tags = {str(value) for value in card.get("tags") or []}
    lineage = ""
    if "private-no-bible" in tags:
        lineage = (
            "The public model card identifies a private, no-Bible training build. "
            "Kakarayan does not access or redistribute that training data."
        )
    elif task == "automatic-speech-recognition":
        lineage = "Fine-tuned FormosanBank speech model; consult the public model card."
    service_id = (
        dimension_id("service", "formosan-mt")
        if task == "translation"
        else dimension_id("service", "formosan-asr")
        if task == "automatic-speech-recognition"
        else None
    )
    return {
        "id": dimension_id("model", repository),
        "repository": repository,
        "task": task,
        "url": f"https://huggingface.co/{repository}",
        "license": str(card.get("license") or "unknown"),
        "languages": languages or sorted(FORMOSAN_CODES),
        "direction": _direction(repository),
        "last_modified": item.get("lastModified"),
        "limitations": (
            "Machine output may be wrong. It is not expert review, a correction service, "
            "or evidence of community endorsement."
        ),
        "training_lineage": lineage,
        "browser_service_id": service_id,
    }


def build_model_catalog(*, timeout: float = 15.0) -> dict[str, object]:
    """Collect current public organization metadata from the official Hub API."""
    models = _get_json(f"{HF_API}/models?author={ORGANIZATION}&limit=100&full=true", timeout)
    spaces = _get_json(f"{HF_API}/spaces?author={ORGANIZATION}&limit=100&full=true", timeout)
    model_rows = [
        _model_row(item)
        for item in models
        if item.get("pipeline_tag") in {"translation", "automatic-speech-recognition"}
    ]
    present_spaces = {str(item["id"]): item for item in spaces}
    service_rows = []
    for repository, tasks in KNOWN_SPACES.items():
        present = repository in present_spaces
        slug = repository.rsplit("/", 1)[-1]
        service_rows.append(
            {
                "id": dimension_id("service", slug.replace("_", "-")),
                "space": repository,
                "url": f"https://huggingface.co/spaces/{repository}",
                "api_url": f"https://{ORGANIZATION.lower()}-{slug.replace('_', '-')}.hf.space",
                "tasks": tasks,
                "status": "unchecked" if present else "unavailable",
                "checked_at": None,
                "third_party_notice": (
                    "This action sends the text or audio you select directly to a public "
                    "Hugging Face Space operated by FormosanBank. Hugging Face may process "
                    "infrastructure logs under its own terms."
                ),
            }
        )
    return {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "provider": "Hugging Face",
        "models": sorted(model_rows, key=lambda row: str(row["repository"])),
        "services": service_rows,
    }
