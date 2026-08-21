# API contract

Kakarayan exposes two versioned public interfaces:

1. Small static metadata documents served with the site.
2. One required read-only query API for interactive corpus operations.

OpenAPI is available from the query service at `/openapi.json` and `/docs`.

## Release rule

The current static `meta.json` identifies the release the interface expects. Every
interactive route includes that release ID:

```text
/v1/releases/{release_id}/...
```

The API rejects a different release ID. Clients should call `/readyz` on startup and require
its `release_id` to match static metadata.

## Static metadata

Production base URL:

```text
https://formosanbank.github.io/kakarayan/api/v1/
```

| Document | Contents |
| --- | --- |
| `meta.json` | Release, source, schema, counts, and provenance |
| `languages.json` | Display names, identifiers, capabilities, and counts |
| `corpora.json` | Corpus scopes, languages, source paths, rights, and counts |
| `rights.json` | Reviewed central and corpus-specific rights decisions |
| `models.json` | Public MT and ASR model catalogue |
| `orthography.json` | Reviewed orthography tables |
| `content.json` | Reviewed learning-content registry |
| `downloads.json` | Curated prepared artifacts and checksums, added during Pages assembly |

Each document uses the envelope in `schemas/static-api.schema.json`. Consumers read its
`data` member only after checking `schema_version`, `release_id`, `source.commit`, and
`kakarayan.commit`.

## Service routes

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Process liveness only |
| `GET /readyz` | Active release readiness and identity |
| `GET /v1/meta` | Active release metadata |
| `GET /v1/languages` | Language catalogue |
| `GET /v1/corpora` | Corpus catalogue |
| `GET /v1/rights` | Rights catalogue |
| `GET /v1/models` | Model catalogue |
| `GET /v1/downloads` | Prepared-download catalogue |
| `GET /v1/releases/{release}/languages/{id}` | One language |
| `GET /v1/releases/{release}/corpora/{id}` | One corpus |
| `GET /v1/releases/{release}/texts/{id}` | One full text |
| `GET /v1/releases/{release}/sentences/{id}` | One full nested sentence |
| `GET /v1/releases/{release}/translation-languages` | Translation-language counts |
| `GET /v1/releases/{release}/dictionary` | Dictionary summaries |
| `GET /v1/releases/{release}/concordance` | Sentence summaries |
| `GET /v1/releases/{release}/frequencies` | Bounded token frequencies |
| `GET /v1/releases/{release}/summaries` | Corpus summary and distributions |
| `GET /v1/releases/{release}/datasets/preview` | At most 250 projected rows |
| `GET /v1/releases/{release}/datasets/export` | Streamed CSV, TSV, or JSON Lines export |
| `GET /v1/releases/{release}/datasets/export-package` | S/W/M tables in one ZIP |

## Search

Dictionary and concordance routes require:

- `q`: 1 to 2,048 characters;
- `language_id`: one FormosanBank display-language identifier;
- `direction`: `formosan` or `translation`;
- `match`: `exact`, `prefix`, or `contains`.

Optional filters are `corpus_id`, `dialect`, `translation_language`, and repeated
`requirement` values. Concordance requirements are `translation`, `audio`, `phonology`,
`interlinear`, or `unclear`.

Example reverse dictionary lookup:

```http
GET /v1/releases/fb-20260811-abcdef12/dictionary?q=good&language_id=lang_amis&direction=translation&translation_language=eng&match=exact&limit=25
```

Search meaning is defined in [search-semantics.md](search-semantics.md). The server queries
publisher-produced canonical columns; clients must not invent another normalization pass.

Initial dictionary results contain a headword, meanings, scope, counts, citations, and a
small example set. Concordance results contain sentence summaries and a detail identifier.
Full words, morphemes, forms, phonology, translations, and audio are returned only by the
sentence detail route.

## Pagination

`limit` is between 1 and 1,000 and defaults to 25. Search and frequency responses return an
opaque `next_cursor` when another page exists. Cursors are keyset positions bound to the
release and query. Do not decode them or reuse one after changing any query parameter.

Changing `limit` while retaining the same query and cursor does not duplicate or skip
records.

## Dataset preview and export

Dataset routes accept the same scope, direction, match, translation-language, and tier
requirements as search. Set `record_level=sentence|word|morpheme`. Repeated `field`
parameters select columns valid for that level. Shared columns include:

```text
id xml_id parent_id text_id sentence_id word_id position form standard original
alternate_forms translations phonology audio unclear language_id corpus_id dialect source_path
```

Sentence rows also support `tokens`, `token_count`, and `source`. W and M rows support
`class` and `sclass`. Invalid level and field combinations return 422. Tier values belong
only to the selected owner. Parent identifiers support lossless joins across S, W, and M.

Set `complete_fields=true` to exclude rows missing any selected optional tier or attribute.
The Research builder always uses this mode. The default remains `false` for compatibility
with earlier sentence API clients.

Preview returns at most 250 rows and reports `record_level`, `estimated_rows`,
`returned_rows`, and `truncated`. Export requires `max_rows` from 1 through 100,000 per
selected level and accepts `format=csv|tsv|jsonl`. Rows are streamed as they are read from
SQLite, so there is no fixed response-byte cap or full-result memory buffer. CSV and TSV
cells beginning with spreadsheet formula characters are escaped.

For `export-package`, repeat `record_level` and pass level-specific fields as
`sentence_field`, `word_field`, and `morpheme_field`. The response contains one table per
selected level plus `manifest.json`.

Full-corpus work still belongs to prepared downloads. Custom exports are finite and run in
the request, with no background job in v1.

Legacy `glosses`, `word_translations`, and `morpheme_translations` remain accepted on
sentence exports for existing recipes. New selections use W and M rows directly.

The UI recipe format is defined by `schemas/export-recipe.schema.json`. Publisher execution
and the HTTP export share the same level, column, completeness, and matching semantics.

## Errors

Errors use:

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "Human-readable explanation",
    "status": 422
  }
}
```

Clients should branch on `code`. Expected categories include invalid input, release
mismatch, missing records, excessive query work, rights denial, and service not ready.

## HTTP and privacy behavior

- Successful release-scoped GET responses use immutable public caching.
- Catalogue responses use a short public cache.
- Readiness and error responses are not treated as immutable data.
- CORS accepts only configured exact origins and never credentials.
- The surface is GET-only and uses parameterized SQL templates.
- Operational records include method, route template, status, duration, bytes, release ID,
  and a failure code when applicable. They exclude URLs, raw queries, sentence text,
  recordings, and model input.

## JavaScript example

```js
const release = "fb-20260811-abcdef12";
const query = new URLSearchParams({
  q: "fangcalay",
  language_id: "lang_amis",
  direction: "formosan",
  match: "exact",
  limit: "25",
});
const response = await fetch(
  `https://API_HOST/v1/releases/${release}/dictionary?${query}`,
);
if (!response.ok) throw new Error(`Kakarayan API ${response.status}`);
const page = await response.json();
```

Kakarayan does not maintain separate JavaScript, Python, or R client packages in v1. The
HTTP and schema contracts are the supported integration surface.

## Runtime configuration

The serving process requires a database and active manifest prepared before startup:

| Variable | Purpose |
| --- | --- |
| `KAKARAYAN_DB_PATH` | Local immutable SQLite path |
| `KAKARAYAN_RELEASE_MANIFEST_PATH` | Local active manifest path |
| `KAKARAYAN_SQLITE_SHA256` | Optional independently expected expanded checksum |
| `KAKARAYAN_CORS_ORIGINS` | Comma-separated exact origins |
| `KAKARAYAN_QUERY_STEP_LIMIT` | SQLite progress callbacks allowed per request; default 2,000,000 |

Use `python -m api.prepare_release` during deployment. Runtime startup never downloads or
decompresses a release.
