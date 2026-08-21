# Architecture

Kakarayan v1 is a modular monolith with three parts:

- `site/`: the React interface and browser-local learning state.
- `api/`: one required public, read-only query application.
- `publisher/`: one deterministic projection from FormosanBank XML to immutable releases.

FormosanBank XML remains canonical. The query database, static metadata, and downloads are
derived artifacts that can be rebuilt from a pinned source commit.

## Data flow

```text
clean FormosanBank checkout at one commit
  -> publisher validates XML, paths, rights, and source identity
  -> publisher builds one normalized SQLite read model
  -> publisher derives small static catalogues and prepared downloads
  -> publisher records checksums, citations, rights, and release identity

browser
  -> Pages serves the React shell and small static catalogues
  -> query API returns summaries, details, previews, and streamed exports
  -> GitHub Releases serves prepared research downloads
  -> named Hugging Face services receive MT or ASR input only after consent
```

The browser never downloads a corpus-wide index or scans the corpus. A lookup sends a small
request to the query application, receives at most one bounded result page, and requests a
full nested sentence only when the user expands it.

## Release identity

Every release has an ID derived from both its FormosanBank source commit and the Kakarayan
publisher commit. The final twelve hexadecimal characters combine the first six characters
of each revision. This keeps a rebuilt projection immutable and distinct when publisher
logic changes without a new corpus commit. Its manifest records:

- the exact FormosanBank commit;
- the Kakarayan commit that produced it;
- schema version and counts;
- every artifact path, size, SHA-256, media type, and rights scope;
- compressed and expanded identity for the query database.

The site requires all static envelopes to agree on release ID, source commit, and Kakarayan
commit. It then checks `/readyz` and enables interactive queries only when the API serves the
same release. Static documentation, catalogues, downloads, and local cards remain usable if
the query service is unavailable. A static or API release mismatch fails closed.

## React boundary

The client owns routing, bilingual presentation, form state, request cancellation, local
cards, recordings, and explicit model-service consent. It reads small versioned catalogues
from `api/v1/*.json` and the query routes documented in [api.md](api.md).

The client does not own search normalization, corpus-scale matching, record counting,
full-corpus projection, or unbounded export. Its service worker caches only the application
shell and small same-origin metadata. Query responses, audio, model calls, and downloads are
not added to the offline cache.

Study cards live in IndexedDB. Recordings live in page memory until the user downloads them,
discards them, or explicitly submits them to the named ASR provider.

## Query application boundary

The FastAPI process serves one already activated SQLite database. Routes call one concrete
`CorpusStore`; there is no second query engine, queue, account system, write API, or generic
storage layer.

The API owns:

- bidirectional dictionary and sentence search;
- exact, prefix, and contains matching under one normalization contract;
- corpus, dialect, translation-language, audio, and tier filters;
- stable keyset cursors;
- small result summaries and on-demand record detail;
- frequency and summary queries;
- previews and finite streamed CSV, TSV, or JSON Lines exports;
- per-IP general and export rate limits;
- one global SQLite query-concurrency boundary;
- health, readiness, release identity, and privacy-preserving operational records.

Successful release-scoped GET responses are public and immutable. Validation and readiness
responses are not cached. Query length, page size, SQLite work, and export rows have high
finite limits. Export bytes are streamed rather than buffered in API memory.

## Activation boundary

`api.prepare_release` performs deployment work before the server starts:

1. Read a local or HTTPS manifest.
2. Select exactly one SQLite artifact.
3. Enforce download and expansion limits.
4. Verify compressed and expanded checksums and sizes.
5. Run SQLite integrity verification.
6. Atomically replace the active database and manifest.

Runtime startup performs no network access, decompression, or full integrity scan. It opens
the database as immutable and read-only, checks required tables and embedded release
metadata, and becomes ready only when database and manifest identities agree.

Rollback redeploys and activates a prior immutable release. A crash between atomic file
replacements leaves readiness false rather than serving mixed data.

## Publisher boundary

The publisher validates a clean public checkout, parses source XML once, creates canonical
search columns, builds the SQLite read model, and derives static metadata and prepared
downloads. It also owns rights filtering, citations, deterministic archives, manifests, and
checksums.

There is one full publication command and one invented-data fixture command. Publication
does not build a browser search engine or a second source projection.

## External services

- GitHub Pages serves the application and static metadata.
- GitHub Releases serves immutable prepared downloads and the compressed query read model.
- A public Docker deployment, currently the Tokyo Lightsail proof of concept, serves the
  query API.
- Hugging Face model services provide optional MT and ASR.
- The FormosanBank GitBook remains the maintained long-form documentation source embedded
  by the Docs route.

These boundaries are independent. Model failure cannot affect corpus lookup. Query failure
cannot remove static catalogues, prepared downloads, documentation, or local study cards.

## Repository entry points

| Responsibility | Entry point |
| --- | --- |
| Site | `site/src/main.tsx`, `site/src/App.tsx` |
| API | `api/app.py` |
| Query store | `api/store.py` |
| Release activation | `api/prepare_release.py` |
| Publication | `publisher/cli.py`, `publisher/build.py` |
| Fixture publication | `publisher/fixture_cli.py` |
| Release verification | `publisher/verify_release.py` |
| Static metadata extraction | `publisher/extract_metadata.py` |
| Pages assembly | `publisher/assemble_site.py` |

Configuration and operational steps are in [publication.md](publication.md). Search meaning
is normative in [search-semantics.md](search-semantics.md).
