# Kakarayan

Kakarayan is the public search, learning, research, download, and API interface for
[FormosanBank](https://github.com/FormosanBank/FormosanBank).

FormosanBank XML is canonical. Kakarayan turns one pinned public source commit into an
immutable SQLite query model, small static catalogues, prepared research downloads, and a
release manifest with checksums and rights decisions.

## Architecture

Kakarayan has three application parts:

- `site/`: the React interface, browser-local study cards, recordings, MT and ASR tools.
- `api/`: the required public, read-only FastAPI query service.
- `publisher/`: the deterministic XML projection and release builder.

The browser requests small dictionary, concordance, record-detail, summary, preview, and
finite-export responses from the query API. It does not download corpus indexes or scan the
corpus locally. Static catalogues, documentation, and prepared downloads remain usable if
the query service is unavailable.

See [docs/architecture.md](docs/architecture.md) and [docs/api.md](docs/api.md).

## Repository map

```text
api/                  read-only HTTP API, query store, activation, and tests
content/              reviewed learning-content registry
docs/                 current architecture, contracts, and runbooks
publisher/            source projection, artifacts, manifests, and verification
schemas/              release, static API, content, and export-recipe contracts
site/                 React interface, local learner state, unit tests, and Playwright
tests/fixtures/       invented public data and shared semantic fixtures
.github/workflows/    CI, publication, API deployment, and Pages deployment
```

Generated corpus data belongs under `build/` and is ignored by Git. Do not commit a full
FormosanBank projection to this repository.

## Requirements

- Python 3.13
- [uv](https://docs.astral.sh/uv/)
- Node.js 22 and npm
- Chromium for the focused browser suite
- Docker only for the API image check

Install the locked dependencies:

```bash
uv sync --locked --all-groups
npm ci --prefix site
```

## Run locally with invented data

Build the small test release and assemble its static metadata:

```bash
uv run python -m publisher.fixture_cli \
  --output build/fixture-release \
  --include-prepared
uv run python -m publisher.verify_release \
  --release build/fixture-release
uv run python -m publisher.assemble_site \
  --release build/fixture-release \
  --public site/public
```

Start the query API in one terminal:

```bash
KAKARAYAN_DB_PATH=build/fixture-release/formosanbank.sqlite \
KAKARAYAN_RELEASE_MANIFEST_PATH=build/fixture-release/release-manifest.json \
KAKARAYAN_CORS_ORIGINS=http://127.0.0.1:5173 \
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

Start the site in another terminal:

```bash
VITE_KAKARAYAN_API_URL=http://127.0.0.1:8000 \
npm --prefix site run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/kakarayan/`.

Publisher outputs are immutable. If the named fixture or public API directory already
exists, list and remove only these generated targets before rebuilding:

```bash
for target in build/fixture-release site/public/api site/dist; do
  if test -e "$target"; then
    printf '%s\n' "$target"
    rm -r -- "$target"
  fi
done
```

## Checks

Run the pull-request checks locally:

```bash
uv run ruff format --check api publisher
uv run ruff check .
uv run mypy api publisher
uv run pytest api/tests publisher/tests
uv run pip-audit --local --progress-spinner=off

npm --prefix site audit --audit-level=high
npm --prefix site run lint
npm --prefix site run typecheck
npm --prefix site test
npm --prefix site run build
uv run python -m publisher.verify_site --site site/dist
```

After building the fixture, assembling `site/public`, and building `site/dist`, install
Chromium once and run the browser contract journey:

```bash
npx --prefix site playwright install chromium
npm --prefix site run test:e2e -- --project=desktop-chromium
```

The unfiltered Playwright command runs the wider Chromium, Firefox, WebKit, and mobile
matrix used by the scheduled check.

## Build a public release

Use a clean local FormosanBank checkout at the exact intended commit:

```bash
uv run python -m publisher.cli \
  --repo /absolute/path/to/FormosanBank \
  --output build/data-release \
  --source-commit <40-character-commit> \
  --refresh-models \
  --compress-database \
  --release-only

uv run python -m publisher.verify_release \
  --release build/data-release \
  --max-artifact-mib 2048
```

The publisher refuses a dirty source checkout, a source mismatch, an existing nonempty
output, malformed XML, invalid schemas, failed integrity checks, and disallowed release
rights.

Production publication and deployment use the guarded workflows documented in
[docs/publication.md](docs/publication.md). The required order is data release, query API,
then Pages.

## Public boundaries

- The query API is public, read-only, bounded, and release-scoped.
- Study cards stay in IndexedDB and can be backed up by the user.
- Recordings remain local unless the user explicitly submits one to a named ASR service.
- MT and ASR are external Hugging Face integrations with consent, timeouts, and cancellation.
- Prepared data retains corpus-specific rights, citations, provenance, and checksums.
- Kakarayan software and project-produced materials use
  [CC BY-NC 4.0](LICENSE.md), subject to upstream terms for corpus materials.

Use the private GitHub advisory form for security reports. Use
[docs/rights-citation-privacy.md](docs/rights-citation-privacy.md) for attribution, rights,
privacy, correction, or takedown concerns.
