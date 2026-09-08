# Kakarayan query API

FastAPI serves one immutable SQLite release. The frontend uses it for lookup,
record detail, summaries, previews, and finite exports. MT and ASR use separate
Hugging Face services.

- [API contract and examples](../docs/api.md)
- [Build and publish data](../docs/publication.md)
- [Lightsail activation, configuration, and rollback](../docs/lightsail.md)
- [Search semantics](../docs/search-semantics.md)

## Local fixture

From the repository root:

```bash
uv run python -m publisher.fixture_cli --output build/api-fixture-release --include-prepared

KAKARAYAN_RELEASE_MANIFEST_PATH=build/api-fixture-release/release-manifest.json \
KAKARAYAN_DB_PATH=build/api-fixture-release/formosanbank.sqlite \
uv run uvicorn api.app:app --port 8000 --no-access-log
```

Readiness is at `/readyz`; generated endpoint documentation is at `/docs` and
`/openapi.json`. Production uses the CI-tested image and the atomic generation
activation procedure in the Lightsail runbook, not an embedded database image.
