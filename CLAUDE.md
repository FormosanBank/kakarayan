# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Django web app to expose the [FormosanBank](https://github.com/FormosanBank/FormosanBank)
corpus (16 Formosan indigenous Taiwanese languages). **Milestone 1 (current): corpus
ingestion** — the data model and the pipeline that loads FormosanBank XML into PostgreSQL.
Web features (dictionary / concordance search, HTMX UI) come later — `corpus/views.py`,
`corpus/admin.py`, `corpus/tests.py` are still empty stubs.

## Commands

Everything runs through `uv` (Python 3.13, deps pinned in `uv.lock`).

```bash
uv sync                                          # install Python + deps
DB_PORT=5433 docker compose up -d db             # Postgres 16 (DB_PORT optional, defaults 5432)
uv run python manage.py migrate                  # create schema (0001 enables pg_trgm + btree_gin)
uv run python manage.py seed_reference           # languages, dialects, corpora (idempotent)
uv run python manage.py ingest_corpus --all      # ingest; --defer-indexes for faster full rebuild

uv run pytest                                    # run tests (pytest-django; DJANGO_SETTINGS_MODULE preset)
uv run pytest corpus/tests.py::test_name         # single test
```

`ingest_corpus` requires at least one of `--all`, `--corpus NAME` (repeatable), or
`--language NAME` (repeatable). `--language` alone loads that language across every
corpus; with `--corpus` it scopes to that corpus. Re-running is always safe (see below).

## Configuration

Copy `.env.example` → `.env`. Two settings matter beyond the DB URL:

- **`FORMOSANBANK_REPO`** — path to a local FormosanBank checkout. Ingestion is inert
  without it. The app reads canonical XML from `$FORMOSANBANK_REPO/Corpora` (override
  with `CORPORA_PATH`) **and** imports QC parsing code from `$FORMOSANBANK_REPO/QC`.
- `INGEST_BATCH_SIZE` — bulk-insert batch size (default 2000).

PostgreSQL only — the trigram/GIN indexes and `django.contrib.postgres` features have no
SQLite fallback.

## Architecture

**The corpus tables are a derived, rebuildable read-model of the FormosanBank XML.** They
are never hand-edited — the ingestion command wipes and rebuilds them; the XML in the
FormosanBank repo stays canonical. Any future user-generated data (favorites, edits)
must live in *separate* models so these stay cleanly regenerable.

**FormosanBank is an external dependency reached in exactly one place:**
`corpus/ingestion/parse.py`. It pins `$FORMOSANBANK_REPO/QC` onto `sys.path` and imports
`corpus_counts` to reuse FormosanBank's *canonical* language-resolution
(`resolve_language`, `LANG_CODE_TO_NAME`) and word-counting rules — this keeps kakarayan
in lock-step with the source of truth. `normalize.tokenize` deliberately mirrors
`corpus_counts.count_words` so `Sentence.token_count` reconciles with FormosanBank's
published corpus statistics. If you change tokenization, that invariant must hold.

### Ingestion flow (`corpus/ingestion/`)

`ingest_corpus` command → `seed.seed_all()` → per-corpus `loader.load_corpus()`:

- **`parse.py`** — the FormosanBank bridge + XML→plain-dict-tree parser. `discover_corpus_xml`
  prefers a corpus's `XML/` subdir. `git_commit()` records the checkout's HEAD for provenance.
- **`normalize.py`** — the single definition of how surfaces/glosses fold into search
  keys (`surface_norm`, `text_norm`). Folding is intentionally conservative: NFC +
  casefold + edge-punctuation trim, but phonemic diacritics/letters (`ʉ ɬ ' lj`) are
  **kept** — stripping them would merge distinct words. Change folding → rebuild the index.
- **`seed.py`** — idempotent dimension seed (languages/dialects/corpora) via
  `update_or_create`. Dialects come from `$FORMOSANBANK_REPO/dialects.csv`.
- **`loader.py`** — parsed dicts → ORM rows via `bulk_create`.

**Delete-and-reload contract:** a plain corpus ingest deletes all `Text` rows of that
corpus (cascading to everything below) and rebuilds, inside one transaction per corpus. A
language-scoped ingest deletes/reloads only that language's `Text` rows, leaving other
languages untouched. This is why re-running is safe. Each run writes an `IngestionRun` row.

`--defer-indexes` drops the two GIN trigram indexes (`token_surface_norm_trgm`,
`translation_text_norm_trgm`) before load and recreates them after — much faster for a
full rebuild. The index names/tables are hardcoded in `_TRGM_INDEXES` in the command.

### Data model (`corpus/models.py`)

Containment: `Corpus → Text → Sentence → Word → Morpheme`. Notes worth internalizing:

- **FORM/PHON are columns, not rows** (`form_original`/`form_standard`/`form_alternate`,
  `phon_original`/`phon_standard`) because they're one-per-`kindOf` in the corpus.
- **`Translation` and `AudioSegment` use an exactly-one-owner pattern:** three nullable
  FKs (sentence/word/morpheme) guarded by a `CheckConstraint`. A morpheme-level
  Translation is an interlinear gloss. Set exactly one owner when creating these.
- **`Token` is the derived concordance/search index**, one row per occurrence: one per
  `<W>` for word-segmented sentences (linked via `word`), else per whitespace chunk of the
  sentence FORM (`word` null). It **denormalizes** corpus/language/dialect so the hot
  dictionary query filters without joins, and has a GIN-trigram index on `surface_norm`
  for exact/prefix/substring/fuzzy lookup.
- **`Language.iso639_3` is NOT unique** — `trv` maps to both Seediq and Truku
  (disambiguated by dialect at ingest); uniqueness is on `name`.
- **`Text`'s natural key is `(corpus, source_path)`**, not the XML `@id` — ids collide
  across files in some corpora (e.g. Wikipedias).
