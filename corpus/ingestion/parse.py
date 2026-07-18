"""Adapter over the canonical FormosanBank XML + QC parsing rules.

This is the *only* place that reaches into the FormosanBank repo. It imports the
project's canonical counting/language rules from ``QC/corpus_counts.py`` (so we stay in
lock-step with the source of truth) and parses each ``<TEXT>`` file into a plain-dict
tree the loader turns into ORM rows.

Switching from the path-pin approach to an installed FormosanBank package would only
change ``_ensure_qc_on_path`` / ``get_corpus_counts`` here.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

from django.conf import settings

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


# --------------------------------------------------------------------------- #
# FormosanBank QC bridge
# --------------------------------------------------------------------------- #
def _ensure_qc_on_path() -> None:
    repo = settings.FORMOSANBANK_REPO
    if not repo:
        raise RuntimeError("FORMOSANBANK_REPO is not set; point it at a FormosanBank checkout.")
    qc = str(Path(repo) / "QC")
    if qc not in sys.path:
        sys.path.insert(0, qc)


@lru_cache(maxsize=1)
def get_corpus_counts():
    """Import and return FormosanBank's ``corpus_counts`` module (canonical rules)."""
    _ensure_qc_on_path()
    import corpus_counts  # noqa: PLC0415  (deferred: needs sys.path set first)

    return corpus_counts


def corpora_path() -> Path:
    path = settings.CORPORA_PATH or (
        str(Path(settings.FORMOSANBANK_REPO) / "Corpora") if settings.FORMOSANBANK_REPO else ""
    )
    if not path:
        raise RuntimeError("CORPORA_PATH / FORMOSANBANK_REPO not configured.")
    return Path(path)


def git_commit() -> str:
    """Best-effort HEAD commit of the FormosanBank checkout, for provenance."""
    import subprocess

    repo = settings.FORMOSANBANK_REPO
    if not repo:
        return ""
    try:
        out = subprocess.run(
            ["git", "-C", repo, "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return out.stdout.strip()
    except Exception:
        return ""


# --------------------------------------------------------------------------- #
# Discovery (mirrors validate_xml.discover_corpus_canonical_xml: prefer XML/)
# --------------------------------------------------------------------------- #
def discover_corpus_xml(corpus_root: Path) -> list[Path]:
    """Canonical XML files for one corpus: under ``XML/`` if present, else the tree."""
    xml_subdir = corpus_root / "XML"
    base = xml_subdir if xml_subdir.is_dir() else corpus_root
    return sorted(p for p in base.rglob("*.xml"))


def list_corpora() -> list[Path]:
    """Directories directly under Corpora/ that hold XML."""
    root = corpora_path()
    out = []
    for child in sorted(root.iterdir()):
        if child.is_dir() and discover_corpus_xml(child):
            out.append(child)
    return out


# --------------------------------------------------------------------------- #
# XML -> dict tree
# --------------------------------------------------------------------------- #
def _to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _forms(elem) -> dict[str, str]:
    out: dict[str, str] = {}
    for form in elem.findall("FORM"):
        kind = form.get("kindOf") or ""
        if kind in ("original", "standard", "alternate"):
            out[kind] = (form.text or "").strip()
    return out


def _phons(elem) -> dict[str, str]:
    out: dict[str, str] = {}
    for phon in elem.findall("PHON"):
        kind = phon.get("kindOf") or ""
        if kind in ("original", "standard"):
            out[kind] = (phon.text or "").strip()
    return out


def _translations(elem) -> list[dict]:
    out = []
    for t in elem.findall("TRANSL"):
        out.append(
            {
                "xml_lang": (t.get(XML_LANG) or "").strip(),
                "kind_of": (t.get("kindOf") or "").strip(),
                "ver": (t.get("ver") or "").strip(),
                "notes": (t.get("notes") or "").strip(),
                "text": (t.text or "").strip(),
            }
        )
    return out


def _audios(elem) -> list[dict]:
    """Direct-child ``<AUDIO>`` elements of ``elem`` that carry a file/url."""
    out = []
    for a in elem.findall("AUDIO"):
        if not (a.get("file") or a.get("url")):
            continue
        out.append(
            {
                "file": (a.get("file") or "").strip(),
                "url": (a.get("url") or "").strip(),
                "start": _to_float(a.get("start")),
                "end": _to_float(a.get("end")),
                "source": (a.get("source") or "").strip(),
            }
        )
    return out


def _morpheme(m) -> dict:
    return {
        "xml_id": m.get("id") or "",
        "cls": m.get("class") or "",
        "sclass": m.get("sclass") or "",
        "forms": _forms(m),
        "phons": _phons(m),
        "translations": _translations(m),
        "audios": _audios(m),
    }


def _word(w) -> dict:
    return {
        "xml_id": w.get("id") or "",
        "cls": w.get("class") or "",
        "sclass": w.get("sclass") or "",
        "forms": _forms(w),
        "phons": _phons(w),
        "translations": _translations(w),
        "audios": _audios(w),
        "morphemes": [_morpheme(m) for m in w.findall("M")],
    }


def _sentence(s) -> dict:
    return {
        "xml_id": s.get("id") or "",
        "forms": _forms(s),
        "phons": _phons(s),
        "translations": _translations(s),
        "audios": _audios(s),
        "words": [_word(w) for w in s.findall("W")],
    }


def parse_text_file(xml_path: Path) -> dict | None:
    """Parse one ``<TEXT>`` XML file into a plain-dict tree, or None if not a TEXT."""
    root = ET.parse(xml_path).getroot()
    if root.tag != "TEXT":
        return None
    return {
        "text_xml_id": root.get("id") or "",
        "xml_lang": (root.get(XML_LANG) or "").strip(),
        "dialect": (root.get("dialect") or "").strip(),
        "citation": (root.get("citation") or "").strip(),
        "bibtex_citation": (root.get("BibTeX_citation") or "").strip(),
        "copyright": (root.get("copyright") or "").strip(),
        "source": (root.get("source") or "").strip(),
        "audio_mode": (root.get("audio") or "").strip(),
        "glottocode": (root.get("glottocode") or "").strip(),
        "text_audios": _audios(root),  # untranscribed, direct children of TEXT
        "sentences": [_sentence(s) for s in root.findall("S")],
    }
