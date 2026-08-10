# Django dictionary application

The original Kakarayan application remains supported as an optional Django, HTMX, and
PostgreSQL development surface. It is not required by the GitHub Pages application.

Its corpus tables are a derived read model of FormosanBank XML. Rebuild them through the
ingestion command rather than editing them by hand.

## Stack

- Python 3.13 with dependencies locked by uv.
- PostgreSQL 16 as the canonical target. PostgreSQL 17 is also suitable for local work.
- PostgreSQL extensions `pg_trgm` and `btree_gin`, installed by migrations.
- A local public FormosanBank checkout configured through `FORMOSANBANK_REPO`.

## Setup

```bash
uv sync --locked --all-groups
docker compose up -d db
cp .env.example .env
```

Set `DATABASE_URL` and `FORMOSANBANK_REPO` in `.env`, then create and populate the derived
database:

```bash
uv run python manage.py migrate
uv run python manage.py seed_reference
uv run python manage.py ingest_corpus --all
```

Run the development server:

```bash
uv run python manage.py runserver
```

Open `http://localhost:8000/`. The interface supports English and Traditional Chinese.

## Ingestion commands

```bash
uv run python manage.py seed_reference
uv run python manage.py ingest_corpus --all
uv run python manage.py ingest_corpus --corpus Wikipedias
uv run python manage.py ingest_corpus --language Amis
uv run python manage.py ingest_corpus --corpus ePark --language Amis
uv run python manage.py ingest_corpus --all --defer-indexes
```

Corpus and language filters compose. A corpus ingest replaces that corpus in its own
transaction. A language-filtered ingest replaces only the matching language rows and keeps
other languages in the corpus. Each run records the FormosanBank commit it reflects.

## Data model

Containment follows `Corpus > Text > Sentence > Word > Morpheme`. Translation and audio
segments attach to one tier. Token is a derived per-occurrence concordance index with
denormalized corpus, language, and dialect fields plus trigram-search normalization.

The PostgreSQL search implementation remains useful for server-backed dictionary behavior.
The static site uses a separate deterministic projection and compressed browser shards.

## Tests

Start PostgreSQL before running the Django suite:

```bash
docker compose up -d db
DATABASE_URL=postgres://kakarayan:kakarayan@127.0.0.1:5432/kakarayan \
  uv run pytest corpus/tests
```

The tests create their own small object graph. They do not require a full corpus ingest.
CI supplies PostgreSQL and runs the complete suite.

## Relevant directories

```text
config/                         Django settings and URLs
corpus/models.py                corpus tables
corpus/migrations/              PostgreSQL extensions and schema
corpus/ingestion/               parsing, normalization, seeding, and loading
corpus/management/commands/     ingestion commands
corpus/views/dictionary.py      dictionary and concordance views
corpus/templates/               Django and HTMX templates
corpus/static/                  CSS, HTMX, and visual assets
corpus/tests/                   database and HTTP tests
locale/                         English and Traditional Chinese catalogues
```
