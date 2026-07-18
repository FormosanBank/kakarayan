# kakarayan

Web application for exposing the [FormosanBank](https://github.com/FormosanBank/FormosanBank)
corpus of the 16 Formosan (indigenous Taiwanese) languages. Built on **Django + HTMX**.

The primary audience is language learners and researchers. The interface is available in
both English and Traditional Chinese (繁體中文), with search across Formosan word forms and
their English or Chinese translations.

**Current milestone: dictionary search.** The app exposes a bilingual dictionary and
concordance search across all 16 languages. Earlier work established the data model and
the pipeline that loads the FormosanBank XML corpus into PostgreSQL.

The corpus tables are a **derived read-model** of the FormosanBank XML — they are rebuilt
by the ingestion command and never hand-edited. The XML in the FormosanBank repo stays
canonical.

## Stack & reproducibility

- **Python 3.13** + dependencies managed by [uv](https://docs.astral.sh/uv/)
  (`.python-version`, `pyproject.toml`, committed `uv.lock`).
- **PostgreSQL 16** is the canonical target (`docker-compose.yml`); any running Postgres
  16/17 works for local dev. Extensions `pg_trgm` + `btree_gin` are enabled by migrations.
- Reads the corpus from a local **FormosanBank checkout** (`FORMOSANBANK_REPO`); imports
  its QC parsers for canonical tokenization/language rules (see `corpus/ingestion/parse.py`).

## Setup

```bash
# 1. Install uv, then sync the environment (installs Python 3.13 + deps)
uv sync

# 2. Start PostgreSQL 16 (Docker) — or point DATABASE_URL at any running PG 16/17
docker compose up -d db

# 3. Configure environment
cp .env.example .env
#   edit .env: set DATABASE_URL and FORMOSANBANK_REPO (path to a FormosanBank checkout)

# 4. Create the schema
uv run python manage.py migrate

# 5. Seed dimensions (languages, dialects, corpora) and ingest the corpus
uv run python manage.py seed_reference
uv run python manage.py ingest_corpus --all
```

## Running the development server

```bash
# Start Postgres first (if using Docker)
docker compose up -d db

# Run the app (hot-reload by default)
uv run python manage.py runserver
```

Open `http://localhost:8000/` in a browser. The dictionary search page loads immediately;
results require a populated corpus (see ingestion commands below).

To switch the interface language, use the language selector in the top-right corner of
the page. Supported: English (`en`) and Traditional Chinese (`zh-hant`).

## Running tests

```bash
# Full suite (~1 s, no external dependencies required)
uv run pytest

# Single test module
uv run pytest corpus/tests/test_views.py

# Single test
uv run pytest corpus/tests/test_views.py::TestDictionarySearch::test_meaning_search_en

# With verbose output
uv run pytest -v
```

Tests use `pytest-django` and an in-process PostgreSQL database (the same one configured
in `.env`). No corpus data needs to be ingested — the test fixtures build a minimal
object graph directly. The `pg_trgm` and `btree_gin` extensions must exist (created by
migration `0001`).

## Ingestion commands

```bash
uv run python manage.py seed_reference                # languages, dialects, corpora
uv run python manage.py ingest_corpus --all           # every corpus
uv run python manage.py ingest_corpus --corpus Wikipedias        # one corpus (repeatable)
uv run python manage.py ingest_corpus --language Amis            # one language, all corpora
uv run python manage.py ingest_corpus --corpus ePark --language Amis  # both filters
uv run python manage.py ingest_corpus --all --defer-indexes      # faster full rebuild
```

`--corpus` and `--language` compose: `--language` alone loads that language across every
corpus; combined with `--corpus` it scopes to that corpus. Re-running is always safe: a
plain corpus ingest is **delete-and-reloaded** in its own transaction, and a
language-filtered ingest wipes/reloads only that language's rows within each corpus,
leaving other languages untouched.
When a corpus changes or a new one is added to FormosanBank, `git pull` the checkout and
re-run `ingest_corpus` for that corpus (or `--all`). Each run records the FormosanBank
commit it reflects on an `IngestionRun` row.

## Data model

Containment: `Corpus → Text → Sentence → Word → Morpheme`. `Translation` and
`AudioSegment` attach to exactly one tier (CHECK-constrained). `Token` is a derived
per-occurrence concordance index (one row per `<W>` for segmented corpora, else per
whitespace chunk of the sentence FORM) with denormalized corpus/language/dialect and
GIN-trigram-indexed `surface_norm` for exact/prefix/substring/fuzzy lookup. See
`corpus/models.py`.

## Project layout

```
config/                     Django project (settings, urls)
corpus/
  models.py                 all corpus tables
  migrations/               incl. 0001_extensions (pg_trgm, btree_gin)
  ingestion/
    parse.py                FormosanBank QC bridge + XML → dict tree
    normalize.py            surface_norm / gloss folding + tokenize
    seed.py                 languages / dialects / corpora
    loader.py               corpus → tiers → tokens → bulk load
  management/commands/
    seed_reference.py
    ingest_corpus.py
  views/
    dictionary.py           word + meaning search, HTMX card expand, pagination
  templates/corpus/
    base.html               topbar, language switcher, HTMX wiring
    dictionary/             index, results partial, card partials, pagination
  static/corpus/
    css/tokens.css          design-system custom properties (colors, type, spacing)
    css/components.css      component classes (.kk-card, .kk-pagination, …)
    js/htmx.min.js          HTMX 2.0.4 (served locally, no CDN)
    assets/                 weave-pattern SVGs (5 accent colours)
  tests/
    conftest.py             shared DB fixtures
    test_normalize.py       normalization invariants
    test_search.py          query helper functions
    test_views.py           HTTP + HTMX response behaviour, pagination
    test_i18n.py            language switching, bilingual UI
locale/
  en/LC_MESSAGES/           English UI catalog
  zh_Hant/LC_MESSAGES/      Traditional Chinese translations
```
