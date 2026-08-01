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
LANGUAGE_SLUGS = {
    "amis": "ami",
    "atayal": "tay",
    "bunun": "bnn",
    "kanakanavu": "xnb",
    "kavalan": "ckv",
    "paiwan": "pwn",
    "puyuma": "pyu",
    "rukai": "dru",
    "saaroa": "sxr",
    "saisiyat": "xsy",
    "sakizaya": "szy",
    "seediq": "trv",
    "taroko": "trv",
    "thao": "ssf",
    "tsou": "tsu",
    "yami": "tao",
}
FORMOSAN_LANGUAGE_NAMES = [
    "Amis",
    "Atayal",
    "Bunun",
    "Kanakanavu",
    "Kavalan",
    "Paiwan",
    "Puyuma",
    "Rukai",
    "Saaroa",
    "Saisiyat",
    "Sakizaya",
    "Seediq",
    "Taroko",
    "Thao",
    "Tsou",
    "Yami / Tao",
]
KNOWN_SPACES: dict[str, dict[str, object]] = {
    "FormosanBank/formosan-mt": {
        "tasks": ["translation"],
        "api_name": "/translate",
        "supported_languages": FORMOSAN_LANGUAGE_NAMES,
    },
    "FormosanBank/formosan_asr": {
        "tasks": ["automatic-speech-recognition"],
        "api_name": "/transcribe",
        "supported_languages": FORMOSAN_LANGUAGE_NAMES,
    },
    "FormosanBank/Amis_ASR_transcription": {
        "tasks": ["automatic-speech-recognition"],
        "api_name": None,
        "supported_languages": ["Amis"],
    },
    "FormosanBank/paiwan_transcription": {
        "tasks": ["automatic-speech-recognition"],
        "api_name": None,
        "supported_languages": ["Paiwan"],
    },
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
    repository_slug = repository.rsplit("/", 1)[-1].casefold()
    inferred_languages = [code for slug, code in LANGUAGE_SLUGS.items() if slug in repository_slug]
    config = item.get("config") or {}
    framework = str(item.get("library_name") or card.get("library_name") or "unknown")
    model_family = str(config.get("model_type") or "unknown")
    used_storage = item.get("usedStorage")
    artifact_bytes = int(used_storage) if isinstance(used_storage, int | float) else None
    metric_rows: list[dict[str, object]] = []
    model_index = item.get("model-index") or card.get("model-index") or []
    if isinstance(model_index, list):
        for group in model_index:
            if not isinstance(group, dict):
                continue
            for result in group.get("results") or []:
                if not isinstance(result, dict):
                    continue
                for metric in result.get("metrics") or []:
                    if not isinstance(metric, dict) or "value" not in metric:
                        continue
                    metric_rows.append(
                        {
                            "name": str(metric.get("name") or metric.get("type") or "metric"),
                            "value": metric["value"],
                        }
                    )
    return {
        "id": dimension_id("model", repository),
        "repository": repository,
        "task": task,
        "url": f"https://huggingface.co/{repository}",
        "license": str(card.get("license") or "unknown"),
        "languages": languages or inferred_languages or sorted(FORMOSAN_CODES),
        "direction": _direction(repository),
        "framework": framework,
        "model_family": model_family,
        "artifact_bytes": artifact_bytes,
        "evaluation_metrics": metric_rows,
        "license_source": (
            "cardData.license" if card.get("license") else "not stated in structured metadata"
        ),
        "intended_use": str(
            card.get("intended-use")
            or card.get("intended_use")
            or "Not stated in structured public model metadata."
        ),
        "last_modified": item.get("lastModified"),
        "limitations": (
            "Machine output may be wrong. It is not expert review, a correction service, "
            "or evidence of community endorsement."
        ),
        "training_lineage": lineage,
        "browser_service_id": service_id,
    }


def _service_status(item: dict[str, Any] | None) -> str:
    if item is None:
        return "unavailable"
    if item.get("disabled"):
        return "unavailable"
    runtime = item.get("runtime") or {}
    stage = str(runtime.get("stage") or "").upper()
    domains = runtime.get("domains") or []
    if stage == "RUNNING" and any(
        str(domain.get("stage") or "").upper() == "READY"
        for domain in domains
        if isinstance(domain, dict)
    ):
        return "available"
    if stage in {"SLEEPING", "BUILDING", "STARTING"}:
        return "sleeping"
    return "unchecked"


def configured_services(
    present_spaces: dict[str, dict[str, Any]] | None = None,
    *,
    checked_at: str | None = None,
) -> list[dict[str, object]]:
    """Return browser-callable service configuration with optional current Hub state."""
    service_rows: list[dict[str, object]] = []
    for repository, configuration in KNOWN_SPACES.items():
        item = present_spaces.get(repository) if present_spaces is not None else None
        present = item is not None
        slug = repository.rsplit("/", 1)[-1]
        reported_host = item.get("host") if item else None
        api_url = (
            str(reported_host)
            if isinstance(reported_host, str) and reported_host.startswith("https://")
            else f"https://{ORGANIZATION.lower()}-{slug.replace('_', '-')}.hf.space"
        )
        service_rows.append(
            {
                "id": dimension_id("service", slug.replace("_", "-")),
                "space": repository,
                "url": f"https://huggingface.co/spaces/{repository}",
                "api_url": api_url,
                "api_name": configuration["api_name"],
                "tasks": configuration["tasks"],
                "supported_languages": configuration["supported_languages"],
                "status": _service_status(item) if present_spaces is not None else "unchecked",
                "checked_at": checked_at if present else None,
                "third_party_notice": (
                    "This action sends the text or audio you select directly to a public "
                    "Hugging Face Space operated by FormosanBank. Hugging Face may process "
                    "infrastructure logs under its own terms."
                ),
            }
        )
    return service_rows


def configured_model_catalog(generated_at: str) -> dict[str, object]:
    """Return deterministic service configuration without making a network request."""
    return {
        "schema_version": "1.0.0",
        "generated_at": generated_at,
        "provider": "Hugging Face",
        "models": [],
        "services": configured_services(),
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
    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": "1.0.0",
        "generated_at": generated_at,
        "provider": "Hugging Face",
        "models": sorted(model_rows, key=lambda row: str(row["repository"])),
        "services": configured_services(present_spaces, checked_at=generated_at),
    }
