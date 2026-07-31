"""Stable identifiers for derived Kakarayan records."""

from __future__ import annotations

import hashlib
import re
import unicodedata

IDENTIFIER_VERSION = "kakarayan-id-v1"
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slug(value: str) -> str:
    """Return a stable ASCII slug suitable for a human-readable dimension ID."""
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return _SLUG_RE.sub("_", normalized.casefold()).strip("_") or "unknown"


def dimension_id(kind: str, name: str) -> str:
    """Create a readable stable identifier for a controlled dimension."""
    return f"{slug(kind)}_{slug(name)}"


def record_id(
    kind: str,
    *,
    corpus: str,
    source_path: str,
    local_id: str = "",
    ordinal: int = 0,
) -> str:
    """Create a stable opaque ID without coupling it to a release commit.

    Source commit provenance belongs in release metadata. Keeping it out of this hash lets
    an unchanged record retain its locator across FormosanBank releases.
    """
    parts = (
        IDENTIFIER_VERSION,
        kind,
        corpus,
        source_path.replace("\\", "/"),
        local_id,
        str(ordinal),
    )
    digest = hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()[:24]
    return f"{slug(kind)}_{digest}"
