"""Machine-readable rights policy with fail-closed corpus defaults."""

from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from publisher.identifiers import dimension_id

CENTRAL_TERMS = {
    "use_summary": (
        "FormosanBank resources are intended for noncommercial research, education, "
        "language documentation, cultural work, and revitalization, subject to each "
        "corpus and component notice."
    ),
    "commercial_ai": "prohibited",
    "attribution_required": True,
    "evidence": [
        "https://github.com/FormosanBank/FormosanBank/blob/main/LICENSE.md",
        "https://github.com/FormosanBank/FormosanBank/blob/main/AI-USE-ADDENDUM.md",
        "https://github.com/FormosanBank/FormosanBank/blob/main/NOTICE-AI.md",
    ],
}


def _load_overrides(path: Path | None) -> dict[str, dict[str, object]]:
    if path is None or not path.exists():
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    return {str(entry["corpus"]): entry for entry in document.get("entries", [])}


def build_rights_catalog(
    corpus_names: list[str],
    *,
    overrides_path: Path | None = None,
) -> dict[str, object]:
    """Build one explicit entry per corpus.

    Unknown or unreviewed redistribution terms are intentionally `review_required`. The
    publisher may expose metadata for such a corpus but must not generate new bulk packages
    that imply permission.
    """
    overrides = _load_overrides(overrides_path)
    entries: list[dict[str, object]] = []
    for corpus in sorted(corpus_names):
        default: dict[str, object] = {
            "id": dimension_id("rights", corpus),
            "corpus": corpus,
            "redistribution": "review_required",
            "commercial_use": "unknown",
            "attribution": "Cite FormosanBank and the corpus-specific source.",
            "license_expression": None,
            "notes": "Corpus-specific redistribution terms require maintainer review.",
            "evidence": [
                (
                    "https://github.com/FormosanBank/FormosanBank/blob/main/"
                    f"Corpora/{corpus}/README.md"
                )
            ],
            "review_status": "review_required",
            "reviewed_at": None,
        }
        default.update(overrides.get(corpus, {}))
        entries.append(default)
    return {"schema_version": "1.0.0", "central_terms": CENTRAL_TERMS, "entries": entries}


def validate_rights_catalog(document: dict[str, object], schema_path: Path) -> None:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)
