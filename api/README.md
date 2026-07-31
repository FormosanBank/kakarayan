# Kakarayan live API

This optional service exposes bounded, read-only queries over one immutable FormosanBank
release. The GitHub Pages static API remains the primary and free access path. Nothing in
the public site requires this service to be online.

## Startup contract

Set exactly one manifest source:

- `KAKARAYAN_RELEASE_MANIFEST_URL`: pinned HTTPS URL for `release-manifest.json`.
- `KAKARAYAN_RELEASE_MANIFEST_PATH`: local manifest path for development and tests.

The service locates `formosanbank.sqlite` in that manifest, downloads it beside the remote
manifest when needed, verifies its size and SHA-256, runs `PRAGMA integrity_check`, checks
the schema version, opens it immutable and read-only, and only then passes `/readyz`.

Optional settings:

- `KAKARAYAN_SQLITE_SHA256`: independently pin the expected database checksum.
- `KAKARAYAN_DB_PATH`: database cache path. Default: `/data/formosanbank.sqlite`.
- `KAKARAYAN_CORS_ORIGINS`: comma-separated exact origins.

Run locally from the repository root:

```bash
KAKARAYAN_RELEASE_MANIFEST_PATH=build/fixture-release/release-manifest.json \
KAKARAYAN_DB_PATH=build/fixture-release/formosanbank.sqlite \
uv run uvicorn api.app:app --port 8000 --no-access-log
```

The API deliberately has no write route, arbitrary SQL, regular-expression query, user
supplied URL, or audio upload. Query text and corpus content are not logged. OpenAPI is at
`/docs` and `/openapi.json`.

## No-cost deployment boundary

The Docker image is suitable for a public Hugging Face Docker Space. Deployment is allowed
only after merge to `main` or by an explicit guarded workflow dispatch. A FormosanBank
maintainer must create or authorize the public Space and add its narrowly scoped write
credential. Pull requests never receive or use that credential.
