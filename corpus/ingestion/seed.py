"""Seed the dimension tables: languages, dialects, corpora.

Idempotent (uses ``update_or_create`` / ``get_or_create``). Run once before the first
ingest and any time ``dialects.csv`` or the set of corpora changes.
"""

from __future__ import annotations

import csv
from pathlib import Path

from django.conf import settings
from django.utils.text import slugify

from corpus.ingestion import parse
from corpus.models import Corpus, Dialect, Language

# trv is shared by Seediq and Truku (disambiguated by dialect at ingest time).
TRUKU_NAME = "Truku"
TRUKU_ISO = "trv"


def seed_languages() -> dict[str, Language]:
    """Create/refresh the 16 languages + Truku. Returns {name: Language}."""
    cc = parse.get_corpus_counts()
    result: dict[str, Language] = {}
    for iso, name in cc.LANG_CODE_TO_NAME.items():
        lang, _ = Language.objects.update_or_create(
            name=name, defaults={"iso639_3": iso}
        )
        result[name] = lang
    truku, _ = Language.objects.update_or_create(
        name=TRUKU_NAME, defaults={"iso639_3": TRUKU_ISO}
    )
    result[TRUKU_NAME] = truku
    return result


def seed_dialects() -> int:
    """Seed dialects from FormosanBank/dialects.csv. Returns count created/updated."""
    csv_path = Path(settings.FORMOSANBANK_REPO) / "dialects.csv"
    if not csv_path.is_file():
        return 0
    by_name = {lang.name: lang for lang in Language.objects.all()}
    n = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            lang_name = (row.get("Language") or "").strip()
            official = (row.get("Official") or "").strip()
            language = by_name.get(lang_name)
            if not language or not official:
                continue
            Dialect.objects.update_or_create(
                language=language,
                name=official,
                defaults={
                    "official_name": official,
                    "chinese_name": (row.get("Chinese") or "").strip(),
                    "glottocode": (row.get("glottocode") or "").strip(),
                    "other_names": (row.get("OtherNames") or "").strip(),
                },
            )
            n += 1
    return n


def seed_corpora() -> int:
    """Create a Corpus row for each directory under Corpora/ that holds XML."""
    n = 0
    for corpus_dir in parse.list_corpora():
        name = corpus_dir.name
        Corpus.objects.update_or_create(
            name=name, defaults={"slug": slugify(name)}
        )
        n += 1
    return n


def seed_all() -> dict[str, int]:
    langs = seed_languages()
    dialects = seed_dialects()
    corpora = seed_corpora()
    return {
        "languages": len(langs),
        "dialects": dialects,
        "corpora": corpora,
    }
