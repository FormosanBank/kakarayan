# Static and live APIs

## Static API

The static API is the primary public developer contract. It is immutable within a deployed
release and does not require a running server.

Base URL:

```text
https://formosanbank.github.io/kakarayan/api/v1/
```

Endpoints:

| Path | Purpose |
| --- | --- |
| `meta.json` | Schema version, release ID, generation time, and source commit |
| `languages.json` | Display identities, names, ISO codes, capabilities, and counts |
| `corpora.json` | Corpus scopes, language IDs, rights IDs, source paths, and counts |
| `rights.json` | Central terms and corpus-specific reviewed decisions |
| `models.json` | Public FormosanBank model and service catalogue |
| `orthography.json` | Public reviewed conversion-table projection |
| `downloads.json` | Prepared artifacts, checksums, rights, blockers, and release URLs |
| `releases.json` | Current release discovery |
| `search/manifest.json` | Compressed vocabulary-index and record-shard inventory |

Consumers should first fetch `meta.json`, pin `release_id`, and reject other payloads or
search manifests that identify a different release.

Every static response uses one validated envelope:

```json
{
  "schema_version": "1.0.0",
  "api_version": "v1",
  "endpoint": "languages",
  "generated_at": "2026-07-30T00:00:00Z",
  "kakarayan": {
    "repository": "FormosanBank/kakarayan",
    "version": "0.1.0",
    "commit": "40-character application commit"
  },
  "source": {
    "repository": "FormosanBank/FormosanBank",
    "commit": "40-character data-source commit"
  },
  "release_id": "fb-20260730-abcdef12",
  "canonical_url": "https://formosanbank.github.io/kakarayan/api/v1/languages.json",
  "data": []
}
```

Read endpoint content from `data`. `meta.json` also keeps the common release fields at the
top level so clients can pin the release before reading another response. All endpoint
envelopes validate against `schemas/static-api.schema.json`. The envelope distinguishes the
Kakarayan application commit that generated the bytes from the public FormosanBank source
commit represented by those bytes.

Search index and shard paths in the manifest are relative to the site `data/` directory.
Load the matching language and corpus vocabulary index first, then fetch only the shard
parts in its postings. Verify the compressed checksum when raw gzip bytes are returned. If
the host transparently decodes the response, verify `uncompressed_sha256`. Indexes are JSON
objects and sentence shards are JSON arrays.

## Optional live API

The live API is a convenience over the same immutable release. It may sleep or be absent.
Applications must keep a static fallback for essential catalogue and data access.

OpenAPI is available at `/openapi.json` and interactive documentation at `/docs`.

Core routes:

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Process liveness |
| `GET /readyz` | Verified release readiness |
| `GET /v1/meta` | Release metadata |
| `GET /v1/languages` | Language catalogue |
| `GET /v1/corpora` | Corpus catalogue |
| `GET /v1/rights` | Rights catalogue |
| `GET /v1/models` | Model catalogue |
| `GET /v1/downloads` | Prepared-download catalogue |
| `GET /v1/texts/{id}` | One text |
| `GET /v1/sentences/{id}` | One sentence |
| `GET /v1/dictionary` | Exact, prefix, contains, or translation search |
| `GET /v1/concordance` | Token concordance |
| `GET /v1/frequencies` | Bounded token frequencies |

The service constrains query strings, page sizes, offsets, and SQLite execution steps.
Cursors are opaque and bound to the query that created them. A cursor must not be reused
with different parameters.

Errors use a stable envelope:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable explanation",
    "request_id": "optional identifier"
  }
}
```

Clients should branch on `code`, not the prose message.

## Release acquisition

The service requires exactly one manifest source:

- `KAKARAYAN_RELEASE_MANIFEST_URL` for a pinned HTTPS GitHub release URL.
- `KAKARAYAN_RELEASE_MANIFEST_PATH` for local tests or development.

It finds the exact `formosanbank.sqlite.gz` release artifact, enforces compressed and
expanded size limits, downloads through HTTPS, verifies both SHA-256 values, validates
SQLite integrity and required tables, and checks embedded release metadata before becoming
ready. Local development may use an uncompressed `formosanbank.sqlite` artifact.

Optional settings:

| Variable | Meaning |
| --- | --- |
| `KAKARAYAN_DB_PATH` | Local immutable database path or cache destination |
| `KAKARAYAN_SQLITE_SHA256` | Independent expected database checksum |
| `KAKARAYAN_CORS_ORIGINS` | Comma-separated exact allowed origins |

## JavaScript client

The typed client has no runtime dependency beyond `fetch`.

```ts
import {KakarayanClient} from "@formosanbank/kakarayan-client";

const client = new KakarayanClient({
  baseUrl: "https://formosanbank.github.io/kakarayan",
  releaseId: "fb-20260730-abcdef12",
});

const languages = await client.getLanguages();
const manifest = await client.getSearchManifest();
const shard = manifest.shards[0];
const records = await client.getSearchShard(
  shard.path,
  shard.sha256,
  shard.uncompressed_sha256,
);
```

Set `mode: "live"` for bounded live routes. The client supports cursor iteration, timeouts,
structured errors, release checks, checksummed gzip search data, and download checksums.

## Python client and CLI

The Python client has no runtime dependencies:

```python
from kakarayan_client import KakarayanClient

client = KakarayanClient(
    "https://formosanbank.github.io/kakarayan",
    release_id="fb-20260730-abcdef12",
)
print(client.languages())
```

Build it with:

```bash
uv build clients/python --out-dir build/python-client
```

The `kakarayan` command exposes the same catalogue and query operations.

## R client

```r
client <- kakarayan_client(
  "https://formosanbank.github.io/kakarayan",
  release_id = "fb-20260730-abcdef12"
)
kakarayan_languages(client)
```

The R package uses `curl`, `jsonlite`, and `digest` for timeouts, JSON, and checksums.

## Compatibility rules

- API schema version `1.0.0` is the current contract.
- Additive fields may appear within a compatible schema version only where schemas allow.
- Breaking field, meaning, nullability, or route changes require a new API schema version.
- Release IDs identify data, not application code.
- Preserve unknown fields when relaying records when practical.
- Do not assume ISO code is a unique display-language key.
- Do not merge original and standard forms.
- Follow every rights ID attached to an artifact.
