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

`api/Dockerfile` builds the same service for a public container host. The current guarded
workflow can publish a release-pinned Hugging Face Docker Space. Other hosts must preserve
the same activation, immutable-release, health-check, CORS, and rollback contracts.
