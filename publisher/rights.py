"""Machine-readable rights policy for the public FormosanBank repository."""

from __future__ import annotations

import json
from pathlib import Path

from publisher.identifiers import dimension_id

CENTRAL_TERMS = {
    "use_summary": (
        "Public FormosanBank resources may be redistributed for noncommercial research, "
        "education, language documentation, cultural work, and revitalization. Preserve "
        "all corpus-specific and upstream notices."
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
    """Build one explicit entry per corpus in the validated public source checkout.

    Inclusion in the canonical public FormosanBank repository is the project-level approval
    for Kakarayan's noncommercial redistribution profile. An explicit corpus override may
    still encode a stricter source or community requirement.
    """
    overrides = _load_overrides(overrides_path)
    entries: list[dict[str, object]] = []
    for corpus in sorted(corpus_names):
        default: dict[str, object] = {
            "id": dimension_id("rights", corpus),
            "corpus": corpus,
            "redistribution": "allowed",
            "commercial_use": "prohibited",
            "attribution": (
                "Cite FormosanBank and every corpus-specific or upstream source supplied "
                "with the record."
            ),
            "license_expression": "CC-BY-NC-4.0",
            "notes": (
                "Approved for Kakarayan's noncommercial public distribution because the "
                "corpus is included in the canonical public FormosanBank repository. "
                "Corpus-specific and upstream terms remain in force."
            ),
            "evidence": [
                (
                    "https://github.com/FormosanBank/FormosanBank/blob/main/"
                    f"Corpora/{corpus}/README.md"
                )
            ],
            "review_status": "reviewed",
            "reviewed_at": "2026-07-31",
        }
        default.update(overrides.get(corpus, {}))
        entries.append(default)
    return {"schema_version": "1.0.0", "central_terms": CENTRAL_TERMS, "entries": entries}
