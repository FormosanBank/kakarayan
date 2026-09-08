"""Canonical text normalization and matching for published corpus queries."""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

MatchMode = Literal["exact", "prefix", "contains"]

_EDGE_PUNCTUATION = "".join(
    [
        " \t\n\r",
        '!"#$%&()*+,-./:;<=>?@[\\]^_`{|}~',
        "…—–“”‘’„‚«»「」『』，。！？、；：（）〈〉《》【】",
    ]
)
_EDGE_RE = re.compile(f"^[{re.escape(_EDGE_PUNCTUATION)}]+|[{re.escape(_EDGE_PUNCTUATION)}]+$")
_SPACE_RE = re.compile(r"\s+")


def normalize_surface(value: str | None) -> str:
    """Normalize one orthographic form without discarding phonemic marks."""
    if not value:
        return ""
    normalized = unicodedata.normalize("NFC", value)
    return _EDGE_RE.sub("", normalized).casefold()


def normalize_text(value: str | None) -> str:
    """Normalize a translation or multi-word query without outer punctuation."""
    if not value:
        return ""
    normalized = unicodedata.normalize("NFC", value)
    collapsed = _SPACE_RE.sub(" ", normalized).strip()
    return _EDGE_RE.sub("", collapsed).casefold()


def match_snippet(text: str, query: str, maximum: int) -> tuple[str, bool]:
    """Keep a bounded source-spelling window around a normalized match."""
    if len(text) <= maximum:
        return text, False
    needle = normalize_text(query)
    normalized = normalize_text(text)
    match_at = normalized.find(needle) if needle else -1
    if match_at < 0:
        return text[: maximum - 1] + "…", True

    # Prefix lengths locate source offsets even when casefold/NFC expands or
    # contracts characters. Context covers a partially composed boundary.
    low, high = 0, len(text)
    while low < high:
        middle = (low + high) // 2
        if len(normalize_text(text[:middle])) < match_at:
            low = middle + 1
        else:
            high = middle
    start = max(0, low - min(40, (maximum - len(needle)) // 2))
    end = min(len(text), start + maximum - 2)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else ""), True


def tokenize(value: str | None) -> list[str]:
    """Return whitespace chunks containing at least one letter or number."""
    if not value:
        return []
    return [chunk for chunk in value.split() if any(character.isalnum() for character in chunk)]


def matches(value: str, query: str, mode: MatchMode, *, surface: bool = False) -> bool:
    """Apply the public exact, prefix, or contains contract to one value."""
    normalize = normalize_surface if surface else normalize_text
    candidate = normalize(value)
    needle = normalize(query)
    if not needle:
        return False
    if mode == "exact":
        return candidate == needle
    if mode == "prefix":
        return candidate.startswith(needle)
    return needle in candidate
