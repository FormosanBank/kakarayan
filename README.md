# Kakarayan

Kakarayan is the public web interface and publication toolkit for
[FormosanBank](https://github.com/FormosanBank/FormosanBank). It serves community learners,
linguists, educators, and developers without requiring a paid backend.

The primary application is a static React site for GitHub Pages. Corpus search, selected
exports, study decks, orthography tools, and recordings run in the browser. An optional
read-only FastAPI service adds convenient corpus queries when a no-cost Hugging Face Space
is available. The site remains useful when that service and every model service are offline.

FormosanBank XML is canonical. Everything Kakarayan publishes is a versioned, checksummed,
rebuildable projection of one exact public FormosanBank commit.

## What is included

- Separate word dictionary and sentence search across original and FormosanBank standard
  forms, tokens, phonology, translations, and morpheme glosses. Users choose the source
  Formosan language and any translation language present in that corpus scope.
- Corpus and language catalogues that keep Seediq and Truku as separate display identities.
- A bounded dataset builder, deterministic linguistic summaries in a Worker, and CSV, TSV,
  JSON, JSON Lines, Parquet, plain text, interlinear, audio-reference, and reproducible
  recipe exports for browser selections.
- Prepared research packages in canonical XML, relational CSV/TSV/JSONL, hierarchical
  JSONL, Parquet, XLSX, CLDF Generic, plain/interlinear text, EAF, TextGrid, WebVTT, and SRT
  where the source supports a defensible mapping.
- Learner tools with cited words and sentences, private local cards, deterministic spaced
  repetition, backup/restore, Anki TSV, local recording, and reviewed orthography tables.
  Cards can be saved only from dictionary or sentence results.
- Optional direct-browser FormosanBank MT and ASR calls with explicit consent and visible
  third-party boundaries.
- A versioned static JSON API, optional read-only live API, and JavaScript, Python, and R
  clients.
- Public-repository noncommercial distribution policy, stricter corpus overrides, source
  locators, checksums, release pinning, and deterministic synthetic-fixture tests.

The earlier Django and PostgreSQL dictionary application remains in the repository. It is
useful as an optional server-backed development surface and behavioral reference, but it is
not required by the public static site.

## Repository map

```text
site/                 React, TypeScript, Vite, PWA, Workers, unit tests, and Playwright checks
publisher/            deterministic XML projection, packages, manifests, and verification
schemas/              versioned JSON Schema contracts
content/              reviewed learning-content registry and contribution boundary
api/                  optional bounded read-only FastAPI service and Docker Space source
clients/              JavaScript, Python/CLI, and R clients
tests/fixtures/       invented public-repository fixture with no private corpus material
corpus/, config/      preserved Django/PostgreSQL application
.github/workflows/    CI and guarded Pages, data-release, and Space workflows
docs/                 architecture, data, API, operations, rights, privacy, and learning
```

Generated corpus data belongs under `build/` and is ignored by Git. Full FormosanBank
projections must never be committed to this repository.

## Requirements

- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- Node.js 22 and npm
- R for the R client check
- PostgreSQL 16 for the preserved Django test suite
- Docker for the optional API image check

Install the locked Python and frontend dependencies:

```bash
uv sync --locked --all-groups
npm ci --prefix site
```

## Run the static site with invented data

Use a new output path for every publisher run. The publisher refuses to overwrite existing
output.

```bash
uv run python -m publisher.fixture_cli --output build/fixture-release
uv run python -m publisher.verify_release --release build/fixture-release
uv run python -m publisher.assemble_site \
  --release build/fixture-release \
  --public site/public
npm --prefix site run build
uv run python -m publisher.verify_site --site site/dist
npm --prefix site run preview -- --host 127.0.0.1
```

Open `http://127.0.0.1:4173/kakarayan/`. The `/kakarayan/` subpath matches the production
GitHub Pages project path.

To rebuild locally, remove only the generated, ignored output directories you intend to
replace: `build/fixture-release`, `site/public/api`, `site/public/data`, and `site/dist`.

## Build from the public FormosanBank repository

Start with a clean public checkout and pin its exact commit:

```bash
git clone https://github.com/FormosanBank/FormosanBank.git build/formosanbank
SOURCE_COMMIT="$(git -C build/formosanbank rev-parse HEAD)"

uv run python -m publisher.cli \
  --repo build/formosanbank \
  --output build/data-release \
  --source-commit "$SOURCE_COMMIT" \
  --refresh-models \
  --compress-database \
  --release-only

uv run python -m publisher.verify_release \
  --release build/data-release \
  --max-artifact-mib 2048
```

The release profile builds research packages and the immutable SQLite snapshot, then keeps
only assets that can be uploaded to one flat GitHub Release. Its manifest records the
GitHub asset name and immutable URL for every file. The Pages profile omits bulk tables and
the live-API database:

```bash
uv run python -m publisher.cli \
  --repo build/formosanbank \
  --output build/pages-release \
  --source-commit "$SOURCE_COMMIT" \
  --refresh-models \
  --site-only
```

Publication workflows additionally require reviewed, machine-readable rights decisions.
Every corpus discovered in the canonical public FormosanBank checkout receives a reviewed
noncommercial distribution entry. An explicit metadata override can impose a stricter
source or community rule. Pages also requires the matching data release to be published,
then imports its validated manifest so the download interface cannot link to a draft or a
different corpus commit.

## Checks

Publisher, API, and Python client:

```bash
uv run pytest publisher/tests api/tests clients/python/tests
uv run ruff format --check corpus config publisher
uv run ruff check .
uv run mypy corpus config publisher api clients/python/kakarayan_client
```

Static application:

```bash
npm --prefix site run lint
npm --prefix site run typecheck
npm --prefix site test
npm --prefix site run build
npm --prefix site run test:e2e
npm --prefix site audit --audit-level=high
```

JavaScript, Python, and R clients:

```bash
npm --prefix clients/javascript test
uv run pytest clients/python/tests
uv build clients/python --out-dir build/python-client
R CMD build clients/R
R CMD check --no-manual --no-build-vignettes kakarayan_*.tar.gz
```

The complete Django suite needs PostgreSQL:

```bash
docker compose up -d db
DATABASE_URL=postgres://kakarayan:kakarayan@127.0.0.1:5432/kakarayan \
  uv run pytest
```

CI supplies PostgreSQL and also builds the API container.

## Publication boundaries

- Pull requests run checks only. They cannot deploy Pages, create releases, or access the
  Hugging Face credential.
- `deploy-pages.yml` runs only from `main` or an explicit dispatch. It pins the public source
  commit, checks rights, enforces a 900 MiB site budget and 50 MiB file budget, reruns browser
  checks, and deploys one saved Pages artifact.
- `publish-data.yml` defaults to a dry run. A real dispatch rechecks all artifact bytes and
  rights in a separate write-enabled job, then creates a draft GitHub release. It never
  publishes that draft automatically.
- `deploy-api.yml` is manual, environment-gated, and accepts only a published immutable data
  release. It pins that release in the Docker Space source.
- Kakarayan original work is licensed under CC BY-NC 4.0. Corpus records retain the
  displayed FormosanBank, source, citation, and community terms.
- The browser MT and ASR tools use the catalogued public FormosanBank Hugging Face Spaces
  directly. They need no repository secret or Kakarayan backend.

Repository administrators must enable Pages with GitHub Actions before the first deploy.
See [publication operations](docs/publication.md) for the exact launch order and current
settings status.

## Documentation

- [Architecture](docs/architecture.md)
- [Data model and formats](docs/data-and-formats.md)
- [Static and live APIs](docs/api.md)
- [Publication operations](docs/publication.md)
- [Rights, citation, and privacy](docs/rights-citation-privacy.md)
- [Learning tools and model services](docs/learning-and-models.md)
- [Original Django dictionary application](docs/legacy-django.md)

The implementation contract and durable work record are in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), [`GOAL.md`](GOAL.md), and
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Corrections and responsible use

Corpus records are attestations from named sources, not universal grammar rules. Machine
translation and ASR are drafts, not expert corrections. Original and FormosanBank standard
orthography are always distinct fields.

For a correction, rights concern, attribution issue, or takedown request, open an issue in
the [Kakarayan repository](https://github.com/FormosanBank/kakarayan/issues) and identify
the release ID, corpus, source path, and record ID. Do not include private personal
information in a public issue.

Public FormosanBank corpus data is available for noncommercial use under the displayed
central, corpus-specific, upstream-source, citation, and community terms. A stricter term
controls for the affected material.
