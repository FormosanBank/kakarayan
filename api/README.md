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
  to `4`.

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
and CORS preflights are exempt. The SQLite semaphore queues database work above the global
concurrency setting instead of starting more simultaneous queries.

`api/Dockerfile` builds the same service for a public container host. The current guarded
workflow can publish a release-pinned Hugging Face Docker Space. Other hosts must preserve
the same activation, immutable-release, health-check, CORS, and rollback contracts.
