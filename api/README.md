# Kakarayan query API

This required public service exposes bounded, read-only queries over one immutable
FormosanBank release. The React site uses it for dictionary and sentence lookup, record
detail, summaries, dataset previews, and finite exports.

## Activation and startup

Prepare a release before starting the server:

```bash
uv run python -m api.prepare_release \
  --manifest /absolute/path/to/release-manifest.json \
  --database /absolute/path/to/active/formosanbank.sqlite \
  --activate /absolute/path/to/active/release-manifest.json
```

Activation accepts a local or pinned HTTPS manifest. It downloads or copies exactly one
declared SQLite artifact, enforces compressed and expanded size limits, verifies both
checksums, runs `PRAGMA integrity_check`, and atomically replaces the active database and
manifest. Keep the prior immutable release available for rollback.

The serving process then needs only:

- `KAKARAYAN_RELEASE_MANIFEST_PATH`: active local manifest path.
- `KAKARAYAN_DB_PATH`: active local SQLite path.
- `KAKARAYAN_CORS_ORIGINS`: comma-separated exact browser origins.
- `KAKARAYAN_SQLITE_SHA256`: optional independently pinned expanded checksum.
- `KAKARAYAN_QUERY_STEP_LIMIT`: SQLite progress callbacks allowed per request; defaults to
  `2000000` for long analytical requests.
- `KAKARAYAN_REQUESTS_PER_MINUTE`: sustained request rate per client IP; defaults to `60`.
- `KAKARAYAN_REQUEST_BURST`: immediately available general-request tokens; defaults to `20`.
- `KAKARAYAN_EXPORTS_PER_MINUTE`: sustained export rate per client IP; defaults to `5`.
- `KAKARAYAN_EXPORT_BURST`: immediately available export tokens; defaults to `5`.
- `KAKARAYAN_QUERY_CONCURRENCY`: SQLite connections allowed to execute together; defaults
  to `2`.
- `KAKARAYAN_ANALYTICAL_QUERY_CONCURRENCY`: dataset, frequency, and summary queries allowed
  to execute together; defaults to `1` so lookup retains one query lane.
- `KAKARAYAN_QUERY_QUEUE_WAIT_SECONDS`: maximum wait for a query slot; defaults to `1`.
- `KAKARAYAN_QUERY_TIMEOUT_SECONDS`: normal query deadline; defaults to `10`.
- `KAKARAYAN_DATASET_PREVIEW_TIMEOUT_SECONDS`: preview deadline; defaults to `15`.
- `KAKARAYAN_DATASET_EXPORT_TIMEOUT_SECONDS`: streamed export deadline; defaults to `120`.
- `KAKARAYAN_SQLITE_CACHE_MIB`: persistent page cache per pooled SQLite connection;
  defaults to `128`.
- `KAKARAYAN_SQLITE_MMAP_MIB`: maximum shared immutable database mapping per connection;
  defaults to `2048`.

Startup performs no network request, decompression, or full integrity scan. It checks the
schema and release identities, opens SQLite immutable and read-only, and exposes `/readyz`
only when the active files agree.

## Local fixture

From the repository root:

```bash
uv run python -m publisher.fixture_cli \
  --output build/api-fixture-release \
  --include-prepared

KAKARAYAN_RELEASE_MANIFEST_PATH=build/api-fixture-release/release-manifest.json \
KAKARAYAN_DB_PATH=build/api-fixture-release/formosanbank.sqlite \
uv run uvicorn api.app:app --port 8000 --no-access-log
```

The API has no write route, arbitrary SQL, regular-expression query, user-supplied URL, or
audio upload. Query text and corpus content are not logged. OpenAPI is available at `/docs`
and `/openapi.json`.

Search pages allow up to 1,000 records, previews up to 250 rows, and exports up to 100,000
rows per selected XML level. Exports stream directly from immutable SQLite into CSV, TSV,
JSON Lines, or ZIP output, without collecting the complete file in API memory.

Rate limits use in-process token buckets keyed by the client address supplied by Uvicorn's
trusted proxy handling. Export requests consume both a general token and an export token.
When a bucket is empty the API returns `429` with `Retry-After`. Health and readiness checks
and CORS preflights are exempt. Readiness uses the validated active manifest and never takes
a query slot. Database work above the global concurrency setting waits briefly, then returns
`503 server_busy` with `Retry-After`. Deadlines and client cancellation interrupt SQLite
through its progress handler.

The service keeps two read-only SQLite connections open instead of rebuilding a tiny cache
for every request. On the production 4 GiB host, each connection has a 128 MiB SQLite page
cache and may memory-map up to 2 GiB of the shared immutable file. Analytical work uses at
most one of the two global query slots, leaving the other available for dictionary,
sentence, and record-detail requests.

Current releases also include compact, language-scoped `formosan_sentence_terms` and
`translation_sentence_terms` search projections. They resolve matching sentences before
loading complete records, avoiding scattered joins across millions of tier rows.
`reverse_dictionary_terms` similarly resolves translation-to-Formosan headwords without
rejoining the tier hierarchy for each query. The API retains compatible paths for already
published releases that predate these projections.

`api/Dockerfile` builds the service deployed on the Tokyo Lightsail host. Any future host
must preserve the same activation, immutable-release, health-check, CORS, and rollback
contracts. Hugging Face remains separate and is used only by the optional MT and ASR tools.
