"""Text normalization for the search index.

The single place that defines how surfaces/glosses are folded into a search key.
Folding rules are intentionally conservative for Formosan orthographies:

- Unicode NFC + casefold + trim surrounding whitespace/punctuation.
- Diacritics and letters like ``ʉ ɬ ' lj`` are **kept** — they are phonemic here, not
  decoration, so stripping them would merge distinct words. If cross-orthography folding
  is later desired, add it here (and rebuild the index); nothing else changes.

``tokenize`` mirrors FormosanBank's ``corpus_counts.count_words`` splitting rule so the
derived token count matches the canonical corpus statistics.
"""

from __future__ import annotations

import re
import unicodedata

# Punctuation to trim from the ends of a token (kept if internal).
_EDGE_PUNCT = "".join(
    [
        r""" \t\n\r""",
        r"""!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~""",
        "…—–“”‘’„‚«»「」『』，。！？、；：（）〈〉《》【】",
    ]
)
_EDGE_RE = re.compile(f"^[{re.escape(_EDGE_PUNCT)}]+|[{re.escape(_EDGE_PUNCT)}]+$")
_WS_RE = re.compile(r"\s+")


def tokenize(text: str | None) -> list[str]:
    """Whitespace chunks containing at least one letter or digit.

    Matches ``corpus_counts.count_words``: ``len(tokenize(t)) == count_words(t)``.
    """
    if not text:
        return []
    return [chunk for chunk in text.split() if any(c.isalnum() for c in chunk)]


def normalize_surface(text: str | None) -> str:
    """Fold a single token surface into its search key."""
    if not text:
        return ""
    s = unicodedata.normalize("NFC", text)
    s = _EDGE_RE.sub("", s)
    return s.casefold()


def normalize_gloss(text: str | None) -> str:
    """Fold a translation/gloss for substring/fuzzy search (whitespace-collapsed)."""
    if not text:
        return ""
    s = unicodedata.normalize("NFC", text)
    s = _WS_RE.sub(" ", s).strip()
    return s.casefold()
