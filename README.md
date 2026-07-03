# kakarayan

Web application for exposing the [FormosanBank](https://github.com/FormosanBank/FormosanBank)
corpus of the 16 Formosan (indigenous Taiwanese) languages. Built on **Django + HTMX**.

**Current milestone: corpus ingestion.** This repo currently contains the data model and
the pipeline that loads the FormosanBank XML corpus into PostgreSQL. Web features (the
first will be a dictionary / concordance search) come in later milestones.

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
```
