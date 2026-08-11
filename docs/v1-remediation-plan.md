# Kakarayan v1 remediation plan

Status: repository audit and implementation plan

Audit date: 2026-08-11

Audited Kakarayan commit: `e442e58`

Scope: application cleanup and cloud readiness only. This document does not select a cloud, hosting product, database product, container platform, or infrastructure framework.

## A. Executive assessment

Kakarayan has a strong publication core and an unusually careful provenance model. It can build deterministic public artifacts from pinned FormosanBank XML, preserve source and rights evidence, publish checksums, enforce immutable release identities, and expose a strict TypeScript interface in English and Traditional Chinese. Formatting, linting, typing, unit tests, and the production web build all pass on the audited commit.

It is not yet a solid v1 because the repository maintains four overlapping application paths:

1. A React static application that performs corpus search in the browser.
2. An optional FastAPI service that the React application does not use.
3. A preserved Django, PostgreSQL, and HTMX application that is not part of the public product.
4. JavaScript, Python, and R clients that expose parts of the static and live interfaces before one stable query contract exists.

This has created duplicate normalization, matching, record projection, export, API, configuration, documentation, and test logic. The production search path is also inverted: the weakest device downloads, verifies, decompresses, parses, and scans the largest data structures. A representative full Pages build contains about 332 MB of `site-query-data`; individual compressed shards can exceed 24 MB and expand far beyond that. Reports of multi-minute lookup latency on Taiwanese devices are consistent with the implementation.

The smallest credible v1 is a modular monolith with three responsibilities:

1. A React client for search, learning tools, catalogues, downloads, and documentation.
2. One required read-only HTTP query application for interactive lookup, record detail, summaries, and bounded custom dataset requests.
3. One publisher that converts pinned canonical XML into an immutable query read model, static metadata, and prepared research downloads.

FormosanBank XML remains canonical. Browser-local state remains appropriate for study cards and unsent recordings. Hugging Face remains an explicit external integration for MT and ASR. The legacy Django product, browser corpus engine, browser Parquet engine, duplicate clients, and historical implementation documents should be removed as their replacement paths become proven.

This is a deletion-first plan. A reasonable outcome is 7,000 to 10,000 fewer source and historical-document lines, at least seven fewer direct dependencies, removal of roughly 332 MB of release-specific search data from the web deployment, and removal of the 39 MB DuckDB WebAssembly payload. Exact deletion totals must be recorded from the implementation diff.

### What is already good

- Canonical public XML is treated as the source of truth.
- Release IDs pin source and application commits.
- Publisher output includes manifests, checksums, citations, and rights decisions.
- Publication fails closed on source, integrity, and rights violations.
- The frontend has strict TypeScript, responsive layouts, accessibility checks, and bilingual UI.
- Study cards are kept in browser-local storage and model use requires explicit consent.
- External model calls have cancellation and time limits.
- The live API is read-only, bounded, restrictive about CORS, and has health and readiness endpoints.
- GitHub workflows use narrow permissions and pinned action commits.
- Current ordinary CI completes in about three minutes, so CI duration is not a v1 blocker.

### What is fragile

- Normalization and search semantics differ between publisher, browser, API, recipes, and legacy Django.
- The browser may load and retain hundreds of megabytes of expanded records and indexes.
- The optional API cannot replace the browser because its contract and feature set differ.
- A service restart can download, expand, hash, and integrity-check a multi-gigabyte database before readiness.
- Generated export recipes can violate their own schema.
- Only the search manifest release is compared with the top-level release during frontend boot.
- The service worker caches every same-origin GET without a corpus-data budget.
- Documentation names different applications as the current architecture.

### Largest technical risks

1. Search correctness drift caused by five normalization and matching implementations.
2. User abandonment caused by browser-side search cost on slower networks and devices.
3. Unsafe maintenance caused by three server/client architectures with no single authority.
4. Release inconsistency caused by partially checked metadata envelopes and parallel duplicated builds.
5. Security maintenance burden from an unused Django runtime with known advisories.

## Audit baseline

| Measure | Audited result |
|---|---:|
| Tracked files | 280 |
| Tracked code and documentation lines reported by `cloc` | 37,215 |
| React source files | 68 |
| Publisher files | 38 |
| Legacy Django files under `corpus` and `config` | 55 |
| Client files | 29 |
| Root historical implementation documents | 3,650 physical lines |
| Documentation including README and historical files | 5,240 physical lines |
| Representative static query artifacts | about 332 MB compressed |
| Largest observed compressed shard | about 24.4 MB |
| Main JavaScript bundle | about 114 KB gzip |
| DuckDB WebAssembly payload | about 39 MB raw, 8.9 MB gzip |
| Locked Python packages at depth one | 12 runtime and 8 development dependencies |
| Frontend dependency graph | 337 packages including transitive and development packages |
| Current npm audit | 0 known vulnerabilities |
| Current Python audit | 6 known advisories, all in Django 5.1.15 |
| Targeted Python tests | 38 passed |
| Frontend unit tests | 53 passed |
| JavaScript client tests | 4 passed |
| Latest ordinary main CI | passed in about 3 minutes |
| Latest full publication workflow | passed in about 73 minutes |

The ignored local `build/` directory is about 19 GB and contains many old fixture and full-release outputs. It is not Git history bloat, but the local workflow does not provide an obvious retention or cleanup command.

## B. Current architecture

### Components and entry points

| Component | Entry point | Current responsibility | Runtime status |
|---|---|---|---|
| React application | `site/src/main.tsx`, `site/src/App.tsx` | Public UI, static metadata, browser lookup, local learning tools, browser exports | Primary public product |
| Browser corpus engine | `site/src/data.ts` | Downloads indexes and shards, validates hashes, decompresses, matches, paginates | Primary lookup path |
| Publisher | `publisher/cli.py`, `publisher/build.py` | XML projection, SQLite, tables, static API, browser search, prepared formats, manifests | Required build path |
| Live API | `api/app.py`, `api/store.py` | Bounded read-only queries over a release SQLite snapshot | Optional and unused by primary UI |
| Legacy web application | `manage.py`, `config/`, `corpus/` | Django ingestion and server-rendered dictionary/concordance | Preserved but not deployed as the public product |
| JavaScript client | `clients/javascript/src/index.ts` | Static API and shard access | Private package |
| Python client | `clients/python/kakarayan_client/` | Static/live API and downloads | Local package source |
| R client | `clients/R/R/kakarayan.R` | Static/live API and downloads | Local package source |
| Model integration | `site/src/modelServices.ts` | Direct Gradio calls to Hugging Face MT and ASR services | External optional capability |
| Local learner state | `site/src/study.ts`, recorder components | IndexedDB study data and in-tab recordings | Browser-local state |
| Documentation | `docs/`, embedded GitBook page | Architecture, formats, rights, publication, learning, API | Partly duplicated and stale |

### Current publication data flow

```text
Pinned public FormosanBank checkout
  -> publisher validates source and parses XML
  -> one SQLite projection plus CSV and JSONL tables
  -> static metadata envelopes
  -> vocabulary indexes and nested record shards
  -> prepared CSV, TSV, XML, SQLite, Parquet, CLDF, XLSX and other packages
  -> rights filtering, manifests and checksums
  -> GitHub Release assets plus assembled static Pages site
```

The full publication workflow builds research artifacts and browser search artifacts in parallel from the same XML. It then joins and re-verifies them. This protects release identity, but each branch repeats the expensive source projection.

### Current browser lookup data flow

```text
User selects a language and submits a query
  -> browser loads every matching vocabulary index sequentially
  -> browser hashes compressed bytes
  -> browser decompresses the complete index
  -> browser hashes expanded bytes and parses JSON
  -> browser scans every relevant vocabulary entry
  -> browser selects and sequentially loads result shards
  -> browser repeats hash, decompression and parse work
  -> browser scans full nested records and renders up to 200 results
```

The browser caches resolved index and shard promises in unbounded module-level maps. The service worker also caches all same-origin GET responses. These two cache layers have no shared size or eviction policy.

### Current live API data flow

```text
Process starts
  -> fetch release manifest
  -> locate compressed SQLite artifact
  -> download it if missing or mismatched
  -> hash compressed data
  -> expand to local disk
  -> hash expanded data
  -> run full SQLite integrity check
  -> expose read-only endpoints and readiness
```

Each request opens an immutable read-only connection and runs direct SQL with a progress-handler work limit. The API supports exact, prefix, and contains matching for a narrower set of fields than the public UI. The UI never calls it.

### External integrations and state

- FormosanBank Git repositories provide canonical XML and GitBook documentation.
- GitHub Pages serves the application and static query data.
- GitHub Releases hold immutable bulk research artifacts.
- Hugging Face hosts optional model services and the optional API deployment path.
- IndexedDB stores study cards. Recordings remain in page memory unless the user explicitly submits one.
- The API uses a local immutable database file as derived state.
- The Django application uses a separate PostgreSQL schema and migrations.

### Architecture and intent disagreements

- `README.md` and `docs/architecture.md` identify React and static publication as primary.
- `CLAUDE.md` describes a Django milestone as the current product.
- `pyproject.toml:4` still describes PostgreSQL ingestion as Milestone 1.
- `.github/workflows/deploy-api.yml:1` calls the API optional.
- `site/src/data.ts` proves the public UI does not use that API.
- `api/app.py:60` says the software license is pending although `LICENSE.md` exists.
- Developer copy advertises both a static API and live API without defining which is authoritative.

## C. Complexity and bloat report

### Complexity that should be deleted

| Area | Evidence | Action | Estimated reduction |
|---|---|---|---:|
| Legacy Django application | `corpus/`, `config/`, `locale/`, `manage.py`, `docker-compose.yml` | Extract normalization fixtures, then delete | roughly 3,700 code lines plus templates/assets |
| Historical agent handoff documents | `GOAL.md`, `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_STATUS.md`, `CLAUDE.md` | Preserve durable decisions elsewhere, then delete | 3,358 physical lines |
| Copied design analysis | `DESIGN.md` contains Ollama-specific product analysis | Replace with a short Kakarayan design reference | about 200 lines |
| Browser corpus engine | large parts of `site/src/data.ts`, search types and tests | Replace with an HTTP client | roughly 500 to 800 frontend lines |
| Browser index publisher | `_write_search_data` and related projection in `publisher/build.py` | Remove after API cutover | roughly 450 to 700 publisher lines |
| Browser search schemas and bundler | search index/manifest schemas and `publisher/site_bundle.py` | Delete after cutover | roughly 250 to 400 lines |
| Browser Parquet engine | `site/src/duckdbExport.ts` and DuckDB branches | Keep prepared Parquet, remove custom browser Parquet | about 40 code lines, tests, and 39 MB WASM |
| JavaScript client package | private package duplicates browser fetch and search behavior | Replace with documented `fetch` examples | roughly 350 source lines plus build output/docs |
| Static search paths in Python and R clients | shard download, gzip, hash and release logic | Repoint only retained clients to one API | several hundred duplicated lines |
| Redundant release profiles | four interacting boolean build flags | Replace with explicit supported build commands | fewer states and branches |
| Duplicate export projection | `recordUnits.ts` and `publisher/recipes.py` | Make server/publisher execution authoritative | roughly 150 frontend lines |
| Duplicate output formatting | `datasetSelection.ts` and `exports.ts` | Use one field serializer | about 30 lines and one semantic drift source |

### Code that is broad rather than usefully modular

- `publisher/build.py` has about 1,149 code lines and combines source orchestration, relational projection, static API generation, search-index generation, artifact handling, and manifest assembly.
- `site/src/data.ts` has about 596 code lines and combines HTTP, integrity checks, compression, caching, normalization, matching, fuzzy distance, index selection, shard loading, and search pagination.
- `site/src/components/DatasetBuilder.tsx` has about 694 code lines and owns selection state, estimation, auto-preview, rights checks, full-record loading, projection, export, and presentation.
- `site/src/components/SearchTool.tsx` has about 621 code lines and owns query state, direction semantics, search execution, dictionary grouping, sentence rendering, saving, export, and pagination.

The correct first action is not to split these files into many smaller wrappers. Delete obsolete responsibilities, then split only where the reduced code still has two clear reasons to change.

### Complexity categories that were not material findings

- No circular import or dependency cycle was found in the primary React, publisher, or API paths.
- No deep class hierarchy, repository pattern, factory layer, or dependency-injection framework needs removal. The main issue is duplicated concrete implementations.
- Error handling is generally bounded and fail-closed. The problem is expensive work and inconsistent ownership, not excessive exception wrappers.
- `vulture` found no high-confidence unused Python symbol. Large directory deletion is justified by unused runtime architecture, not isolated dead functions.
- Most frontend dependencies have a real importer in the current product. The best dependency reduction comes from deleting browser search, browser Parquet, and Django features together.
- The vendored minified HTMX file is generated-looking code, but it belongs to the legacy application and should be deleted with that application rather than reviewed or refactored.
- Rights, checksum, archive, and source-validation branches are proportionate to publishing research data and should not be collapsed merely to reduce line count.

### Static-analysis result

`knip` found one apparently unused service-worker file, one unused test dependency, four unused exports, and nine unused exported types. The service worker is registered dynamically, so that file is not actually dead. The other findings are small cleanup work. `vulture` found no Python candidate at 80 percent confidence. The major bloat is therefore architectural duplication, not a large collection of isolated dead functions.

## D. Findings

### Finding 1: Four overlapping application paths have no single authority

**Issue**

React static search, FastAPI, Django, and three clients each implement overlapping product behavior.

**Evidence**

- The React app imports the browser search implementation from `site/src/data.ts`.
- The live API defines a separate query surface in `api/app.py:174-245`.
- Django provides separate dictionary and concordance queries in `corpus/views/dictionary.py`.
- Static API and shard behavior is repeated under `clients/`.

**Impact**

Every search or schema change can require multiple implementations and can behave differently by entry point. A new engineer cannot tell which behavior is canonical.

**Remediation**

Declare React plus one required read-only HTTP query application plus one publisher as the v1 architecture. Keep one direct query-store module. Remove the legacy application and static query clients after parity tests pass.

**Complexity impact**

Reduces complexity substantially. Making the API required adds one runtime dependency to the currently static deployment, but that runtime already exists in the repository and is necessary to meet observed interactive performance requirements.

### Finding 2: Browser-side corpus lookup is not viable for target users

**Issue**

The browser downloads and processes corpus-scale indexes and nested records for ordinary lookup.

**Evidence**

- `site/src/data.ts:53-87` buffers, hashes, decompresses, hashes again, decodes, and parses each gzip document.
- `site/src/data.ts:394-399` scans every term for non-direct matching.
- `site/src/data.ts:518-566` loads matching indexes and shards sequentially and continues scanning to calculate total matches.
- A representative full Pages manifest contains about 332 MB of static query artifacts.
- One observed shard is 24,380,324 compressed bytes for 1,000 records.
- `publisher/build.py` partitions by a fixed record count rather than a compressed-byte budget.

**Impact**

Slow networks pay large transfer costs. Low-memory phones pay decompression, JSON allocation, string scanning, garbage collection, and battery costs. Multi-minute reports are expected, not anomalous.

**Remediation**

Move interactive matching to the required query application. Send a small bounded request and return 20 to 25 summary records plus a cursor. Fetch full nested record detail only when expanded. Retain static metadata and prepared downloads.

**Complexity impact**

Reduces client, release, and cache complexity. It increases operational responsibility by one small query process, justified by a demonstrated user requirement that cannot be met by CDN placement alone.

### Finding 3: Search normalization is duplicated and inconsistent

**Issue**

There is no single normalization and matching specification.

**Evidence**

- `corpus/ingestion/normalize.py:42-57` uses NFC, edge-punctuation trimming, whitespace collapsing, and Python casefold.
- `publisher/build.py:713-720` uses NFC, `strip`, and casefold without edge-punctuation trimming.
- `publisher/recipes.py:28-58` implements another normalization and token-unit algorithm.
- `site/src/data.ts:242-252` uses a custom punctuation set and JavaScript `toLowerCase`.
- `api/store.py:20-21` uses NFKC and casefold.

**Impact**

The same text can index, search, export, and reproduce differently. This is a correctness problem for linguistic users, especially around punctuation, compatibility characters, and Unicode case behavior.

**Remediation**

Write one short normative search specification with golden Unicode fixtures. Make the publisher produce canonical search columns. Make the query application use those columns without inventing another transform. Keep only minimal UI normalization needed to reject blank input. Remove browser and Django implementations.

**Complexity impact**

Reduces complexity. Golden fixtures add a small justified test asset that replaces multiple implementations.

### Finding 4: The browser index can omit valid normalized candidates

**Issue**

The index is built from raw token surfaces and form text while final matching can use their normalized values.

**Evidence**

- `publisher/build.py:722-744` indexes `token.surface` and `form.text`.
- `site/src/data.ts:264-270` verifies records using `token.normalized` and `form.normalized`.

**Impact**

A token such as `word,` can have normalized value `word`, but the vocabulary index may only select its shard for `word,`. Final verification never sees records in a shard that the index failed to select.

**Remediation**

Add a regression fixture immediately. Until browser search is removed, index canonical normalized fields and raw source fields separately. The durable v1 fix is to remove this candidate-selection path and query canonical indexed columns in one place.

**Complexity impact**

The interim fix is complexity-neutral. The durable fix reduces complexity.

### Finding 5: The live API is optional, incomplete, and contract-incompatible

**Issue**

The existing API cannot be substituted for browser search.

**Evidence**

- `.github/workflows/deploy-api.yml:1` calls it optional.
- `api/store.py:15-17` supports only exact, prefix, and contains over form, translation, or any.
- Browser modes include source, exact, prefix, contains, translation, phonology, gloss, fuzzy, and regex in `site/src/data.ts:229-238`.
- Browser `SearchRecord` includes full words, morphemes, forms, phonology, translations, and audio at `site/src/types.ts:260-288`; API response shapes are different.
- `api/app.py:33-34` marks query responses `private`, even though immutable release-scoped responses could safely use a documented public HTTP cache policy.

**Impact**

Maintaining the API creates cost without improving the primary user path. Switching the frontend without a contract design would lose behavior or create adapter code.

**Remediation**

Define one versioned query contract before implementation. It must cover bidirectional dictionary and sentence lookup, scoped filters, canonical matching semantics, stable cursors, summary records, detail records, citation identifiers, and bounded custom dataset previews. Implement only required v1 modes. Treat regex and expensive fuzzy behavior as optional unless real use justifies them.

Make cache semantics part of the contract. Release-scoped successful responses may be public and immutable; validation failures and readiness responses must not be cached. This is an HTTP behavior, not a choice of a particular cache product.

**Complexity impact**

Initially complexity-neutral because it replaces existing browser and optional API contracts. Net complexity falls after deletion.

### Finding 6: API startup performs deployment work in the serving process

**Issue**

The serving process acquires and validates a large database before it becomes ready.

**Evidence**

- `api/release.py:133-213` downloads and expands the database.
- `api/release.py:266-280` hashes the full local database and runs validation at startup.
- `api/release.py:228-259` runs `PRAGMA integrity_check` before readiness.
- The compressed full database has previously been measured near 900 MB and expands to multiple gigabytes.

**Impact**

Restarts can take minutes, consume double temporary disk space, and fail because a remote asset is unavailable. Horizontal startup repeats work. The process is difficult to stop or replace predictably during acquisition.

**Remediation**

Move release acquisition and full integrity validation into the deployment or release activation step. Start the process only with a locally available, already verified read model and expected release ID. The application should perform a fast schema and release check, then become ready. Activation should be atomic and rollback should select the prior immutable release.

**Complexity impact**

Reduces application complexity and startup risk. The deployment process gains one explicit preparation step, justified because it removes uncontrolled network and multi-gigabyte work from runtime startup.

### Finding 7: Frontend release coherence is only partially checked

**Issue**

The boot screen claims no mixed release data is shown, but most envelope release IDs are discarded.

**Evidence**

- `site/src/data.ts:32-43` validates an envelope and returns only `data`.
- `site/src/data.ts:90-105` compares the search manifest release only with meta.
- Languages, corpora, rights, models, orthography, and content envelope release IDs are not compared.
- `site/src/App.tsx` tells users that no partial or mismatched data is shown.

**Impact**

A partial deployment or cache mix can show inconsistent metadata despite the fail-closed claim.

**Remediation**

Return envelope metadata from the loader and require every boot document to identify the same release and application commit. Prefer one small bootstrap document that names immutable versioned URLs if that deletes requests and checks. Do not add a general runtime schema framework; validate only required envelope and release fields.

**Complexity impact**

Complexity-neutral or reducing if boot metadata is consolidated.

### Finding 8: Export recipes can be invalid and fail reproducibility

**Issue**

The dataset builder supports an unbounded selection that its recipe schema and executor do not support.

**Evidence**

- `DatasetBuilder.tsx:78` stores `maxRows` as `number | null`.
- `DatasetBuilder.tsx:146-148` interprets `null` as all rows.
- `site/src/exports.ts:29` and `:124` emit `max_rows: null`.
- `schemas/export-recipe.schema.json:64` requires an integer from 1 to 1,000,000.
- `publisher/recipes.py:421` compares result length with `selection["max_rows"]`, which cannot handle `null`.

**Impact**

A user can download a recipe from the official UI that fails validation or execution. This breaks the central claim of reproducible research exports.

**Remediation**

Remove unbounded browser export. Require a finite maximum for custom recipes and direct whole-corpus users to prepared downloads. Validate every generated recipe against the published schema in a contract test.

**Complexity impact**

Reduces complexity and removes a dangerous browser operation.

### Finding 9: Dataset estimates and exported values use different serializers

**Issue**

The size estimator does not measure the values that will be exported.

**Evidence**

- `datasetSelection.ts:68-84` formats translations with a space, includes sentence-tier glosses, and flattens audio locators.
- `exports.ts:85-100` omits that translation space, removes sentence-tier glosses, and JSON-serializes full audio objects.

**Impact**

The displayed size can be materially wrong and previewed field meaning can differ from downloaded data.

**Remediation**

Keep one field serializer and use it for preview, estimation, CSV/TSV output, and server-side recipes. Once custom export executes on the query application, remove browser record projection and estimation duplication.

**Complexity impact**

Reduces complexity.

### Finding 10: Dataset preview and export can trigger unbounded browser work

**Issue**

Selecting a language starts a preview immediately and all-row export can materialize an entire selected scope.

**Evidence**

- `DatasetBuilder.tsx:190-214` automatically starts preview, with no delay when the query is empty.
- `DatasetBuilder.tsx:216-251` loads all source records for export up to broad 512 MiB or 1 GiB estimates.
- The output cap is based on decoded estimates rather than an actual process memory budget.

**Impact**

Opening or changing the builder can cause large downloads and memory pressure before the user explicitly asks for data. A 1 GiB decoded allowance is not credible for target phones.

**Remediation**

Make preview an explicit, bounded query that returns count estimates and at most 20 sample rows. Execute custom exports as bounded server requests or downloadable jobs only if synchronous limits are exceeded. For v1, prefer finite synchronous exports and prepared full datasets rather than adding a queue.

**Complexity impact**

Reduces browser complexity. A bounded export endpoint is a necessary addition; background jobs are explicitly deferred.

### Finding 11: Full nested records are the unit of search, display, and export

**Issue**

Every search shard contains complete sentences with words, morphemes, forms, phonology, translations, and audio.

**Evidence**

- `site/src/types.ts:260-288` defines the nested search record.
- Search results initially render from that full object even when only a headword, meaning, sentence, corpus, and identifiers are needed.

**Impact**

Payload size, parsing cost, rendering cost, cache cost, and API coupling all grow together. A single unusually rich record creates very large shards.

**Remediation**

Define a small result summary and a separate full record detail response. Dictionary results should return a headword, meanings, corpus/dialect, count, and two or three examples. Sentence results should return the sentence, matched translation, source labels, audio flag, and detail ID.

**Complexity impact**

Adds one explicit response type but removes far more payload and accidental coupling. The increase is necessary and bounded.

### Finding 12: The service worker has an unbounded cache policy

**Issue**

The worker caches all successful same-origin GET responses, including very large release shards.

**Evidence**

- `site/public/sw.js` applies its network-first cache path to same-origin GET requests.
- `site/src/App.tsx` registers it after release data loads.
- Browser search maps also retain resolved index and shard promises in `site/src/data.ts`.

**Impact**

The site can consume substantial device storage, duplicate memory and persistent caching, and be evicted unpredictably. This is particularly harmful on mobile devices.

**Remediation**

Restrict service-worker caching to the small versioned application shell and required static metadata. Never cache API queries, corpus search data, audio, or bulk downloads unless a user explicitly requests an offline package. Remove index and shard caches with browser search.

**Complexity impact**

Reduces complexity and resource use.

### Finding 13: Publisher build profiles perform work that is later deleted

**Issue**

Boolean build modes create outputs and remove them later.

**Evidence**

- `publisher/cli.py:72-75` maps four interacting flags into `build_release`.
- `publisher/build.py:1167` generates browser search before output-mode cleanup.
- `publisher/build.py:1250-1261` deletes tables, SQLite, API, or search directories based on the mode.
- The publication workflow separately builds research and browser outputs from identical source inputs.

**Impact**

The full release takes about 73 minutes, performs duplicate XML projection, writes avoidable data, and has a harder state space to test.

**Remediation**

First remove the browser search build. Then replace boolean combinations with two explicit commands: a full immutable publication build and a small fixture build. Generate the normalized projection once per release and derive metadata and prepared downloads from it. Do not write artifacts that the selected command will delete.

**Complexity impact**

Reduces complexity and build time.

### Finding 14: Browser Parquet is high cost for low incremental value

**Issue**

Custom Parquet export loads a large analytical runtime into the browser after records have already been materialized.

**Evidence**

- `site/package.json:17` includes `@duckdb/duckdb-wasm`.
- The production build emits a roughly 39 MB WASM asset.
- `site/src/exports.ts:138-140` branches to a separate lazy DuckDB path.
- Full prepared Parquet datasets already exist.

**Impact**

It increases dependency, CSP, bundle, browser-memory, and test complexity for a feature better served as a prepared research format.

**Remediation**

Remove custom browser Parquet from v1. Keep prepared Parquet downloads. Reconsider bounded server-generated Parquet only if researchers demonstrate a recurring need not met by CSV, TSV, JSONL, or prepared packages.

**Complexity impact**

Reduces complexity substantially.

### Finding 15: Client libraries are premature and partly undistributable

**Issue**

Three clients duplicate unstable interfaces before the live query contract is authoritative.

**Evidence**

- `clients/javascript/package.json` marks the JavaScript package private.
- JavaScript, Python, and R each implement metadata, release, search-manifest, shard, and download behavior.
- No evidence in the repository proves that the packages are published to public language registries.

**Impact**

Each API change becomes three maintenance tasks. Documentation implies supported installation paths that may not exist.

**Remediation**

Delete the JavaScript package and provide short browser `fetch` examples. Freeze Python and R during the API contract migration. After the contract is stable, retain only the clients with named users and a release owner. Prefer generated examples over another shared client framework.

**Complexity impact**

Reduces complexity.

### Finding 16: Dependency risk follows obsolete architecture

**Issue**

The locked production set carries an unused web framework and database driver.

**Evidence**

- `pyproject.toml:9-20` mixes Django, PostgreSQL, publisher, and FastAPI dependencies in one runtime set.
- `pip-audit` reports six known advisories in Django 5.1.15.
- `api/requirements.txt` independently pins FastAPI and Uvicorn, duplicating the main lock.
- `npm audit` reports no current frontend vulnerabilities.

**Impact**

Security patching and dependency resolution include code that is not required for production. Duplicate API requirements can drift from the lock.

**Remediation**

Delete Django, django-environ, django-htmx, psycopg, pytest-django, and django-stubs with the legacy product. Consolidate API container installation onto one locked dependency source. Remove DuckDB, fflate, and RE2JS when their browser paths are deleted. Remove unused `@testing-library/react` if no new test uses it.

**Complexity impact**

Reduces complexity and security surface.

### Finding 17: Security controls are mostly sound, with targeted cleanup needed

**Issue**

There is no major authentication requirement because the product is public and read-only, but stale and broad controls remain.

**Evidence**

- API queries use parameters and resource limits rather than interpolated user SQL.
- CORS is an exact configured list and credentials are disabled at `api/app.py:62-68`.
- Publisher checks source cleanliness, paths, symlinks, XML safety, rights, and checksums.
- Model calls require consent and use request cancellation.
- The CSP still permits WebAssembly evaluation for DuckDB and inline styles.
- Production source maps are enabled at `site/vite.config.ts:9`.
- `api/app.py:60` contains stale license metadata.
- `.env.example:16` contains a contributor-specific absolute path.

**Impact**

The credible risks are dependency maintenance, oversized client caching, accidental mixed releases, and stale configuration, not missing authentication. Broad hardening frameworks would add little value.

**Remediation**

Remove obsolete dependencies and browser runtimes, disable production source maps unless they serve a documented debugging need, tighten CSP after DuckDB deletion, update license metadata, replace personal paths with placeholders, and keep API access public and read-only. Do not add accounts, sessions, or authorization to v1.

**Complexity impact**

Reduces complexity.

### Finding 18: Operational visibility is too sparse for a required API

**Issue**

Health and readiness are good, but there is little evidence for diagnosing slow or failed requests.

**Evidence**

- `api/app.py:110-121` exposes liveness and readiness.
- Startup errors are retained as strings but not logged with structured release context.
- Query logging is intentionally absent, and there are no coarse request duration or result-count records.

**Impact**

Operators cannot distinguish slow storage, expensive query modes, invalid releases, or client/network failures without reproducing the problem. Logging raw linguistic queries would introduce a separate privacy concern.

**Remediation**

Emit one structured startup record with application version, release ID, readiness duration, and failure code. Emit coarse request method, route template, status, duration bucket, response bytes, and release ID. Do not log raw query strings, sentence text, recordings, or model inputs. Keep health and readiness.

**Complexity impact**

Small justified complexity increase. Minimal operational evidence is required once the API is a production dependency.

### Finding 19: Tests are broad but miss the highest-risk contracts

**Issue**

The suite has good breadth but its performance and cross-implementation checks do not represent production risk.

**Evidence**

- Unit, type, lint, build, accessibility, and browser suites are green.
- Browser performance checks use fixtures or a small selected corpus rather than the default all-corpus path under constrained device and network conditions.
- No test validates every generated recipe against `export-recipe.schema.json`.
- No golden suite proves normalization parity across publisher, browser, API, and recipes.
- Exact CSS values, banner dimensions, copy, and similar implementation details are asserted in browser tests.
- Platform-neutral accessibility and localization routes are repeated across multiple browser projects.
- `pyproject.toml:38` reports corpus and publisher coverage even for targeted API/client test runs.

**Impact**

The suite can pass while users wait minutes and recipes are invalid. At the same time, product-copy changes can cause noisy failures.

**Remediation**

Keep publisher determinism, rights, schema, API bounds, core learner state, accessibility smoke, and one browser journey on every pull request. Add golden search semantics, generated-recipe schema validation, summary/detail contract tests, and representative full-data latency tests. Move the full browser matrix to release or scheduled checks. Delete pixel, exact-copy, and duplicated route assertions unless they protect a real invariant.

**Complexity impact**

Reduces test volume while increasing confidence. New contract and performance tests replace lower-value tests.

### Finding 20: Documentation and localization lack one source of truth

**Issue**

Repository guidance is contradictory, and bilingual messages use two parallel patterns.

**Evidence**

- `CLAUDE.md`, `pyproject.toml`, `README.md`, and `docs/architecture.md` describe different current architectures.
- `GOAL.md`, `IMPLEMENTATION_PLAN.md`, and `IMPLEMENTATION_STATUS.md` preserve completed agent handoff history.
- `DESIGN.md` contains substantial Ollama-specific analysis.
- `site/src/i18n.tsx` has a small keyed catalogue while the frontend contains about 669 inline `tx(...)` calls.

**Impact**

New contributors can follow obsolete setup instructions. Translation changes are hard to review globally and missing-language text is difficult to detect.

**Remediation**

Keep a short README, architecture document, data/format document, API contract, rights policy, learning/model guide, publication runbook, and concise Kakarayan design reference. Delete historical handoffs. Move stable interface messages to one typed bilingual catalogue over time, starting with navigation, errors, forms, and API-visible states. Do not introduce a third-party internationalization framework unless pluralization or additional locales justify it.

**Complexity impact**

Reduces documentation and code complexity.

### Finding 21: Local generated state is easy to accumulate

**Issue**

Ignored build products consume about 19 GB in the audited workspace with no obvious retention workflow.

**Evidence**

- `/build/` is correctly ignored.
- It contains numerous fixture and full release directories from older runs.
- `.venv`, `site/node_modules`, and generated client outputs add further local space but are also ignored.

**Impact**

Disk pressure, stale artifact confusion, and accidental use of old releases become likely. This is a developer-experience issue, not repository history bloat.

**Remediation**

Document one safe cleanup command that lists targets before deletion and only removes known generated directories. Make build commands use one current output root or unique temporary directories. Do not add a cache manager.

**Complexity impact**

Reduces operational clutter with almost no code.

## E. Prioritized remediation plan

The sequence matters. Do not start cloud infrastructure work, visual redesign, new learning features, or additional client libraries while P0 contracts and deletions are incomplete.

### P0: Required for v1

#### P0.1 Freeze the v1 product contract

Write a short, testable contract for:

- Bidirectional dictionary lookup.
- Bidirectional sentence and translation lookup.
- Exact, prefix, and contains matching.
- Optional fuzzy matching only if representative benchmarks pass.
- Language, corpus, dialect, translation language, audio, and tier filters.
- Result summaries, full record details, stable citations, and cursors.
- Bounded dataset preview and finite custom export.
- Clear failures for invalid, unavailable, too broad, and too expensive requests.

Regex, arbitrary all-row browser export, custom browser Parquet, offline corpus search, and background export jobs are not v1 requirements.

Deliverable: one API contract document plus request/response fixtures reviewed by product and linguistic maintainers.

#### P0.2 Establish one search and normalization specification

1. Capture real fixtures for punctuation, apostrophes, combining marks, Formosan orthography characters, Han text, mixed case, whitespace, translations, glosses, and empty input.
2. Define NFC or another chosen normalization explicitly. Do not mix NFC and NFKC accidentally.
3. Define edge punctuation, token boundaries, direction, tier scope, and match modes.
4. Produce canonical search columns during publication.
5. Test the required query application against the golden results.
6. Add the browser-index omission regression until browser search is removed.

Deliverable: one specification, one fixture set, and no conflicting production implementation.

#### P0.3 Make the read-only query application the authoritative interactive path

1. Keep the current FastAPI application as the starting point because it is small, typed, bounded, and already tested.
2. Define summary and detail response models.
3. Implement the frozen search contract with direct, readable query code in one store module.
4. Replace offset-style deep pagination with a stable keyset cursor.
5. Bound query length, page size, filters, execution time/work, and response bytes.
6. Keep the service public, stateless, and read-only.
7. Add minimal structured operational records without raw query text.
8. Add fast health, readiness, and release identity responses.

Do not introduce repositories, service classes, dependency-injection frameworks, queues, caches, or generic storage adapters. Routes may call one concrete store module.

Deliverable: the representative full corpus passes correctness and latency gates through the API.

#### P0.4 Move the React lookup and research preview to the API

1. Replace browser index and shard loading with a small API client.
2. Abort superseded requests and show useful unavailable, invalid, too-broad, and timeout states.
3. Render at most 20 to 25 summaries initially.
4. Fetch full record detail on expansion.
5. Use cursor pagination rather than rerunning with a larger total limit.
6. Make dataset estimates and previews explicit bounded calls.
7. Keep the catalogue, prepared downloads, local study deck, recorder, orthography tables, and GitBook integration working.

Deliverable: no normal lookup downloads a browser corpus index or shard.

#### P0.5 Fix export correctness and limits

1. Remove `All rows` from custom browser export.
2. Make `max_rows` a required finite integer everywhere.
3. Consolidate field serialization.
4. Validate every generated recipe against its schema.
5. Execute the same fixture recipe twice and require byte-identical output where the format supports it.
6. Direct full-corpus work to prepared artifacts.

Deliverable: every recipe generated by the UI validates and reproduces its selection.

#### P0.6 Make release activation predictable

1. Build and fully validate the query read model before application startup.
2. Record its source commit, application commit, schema version, release ID, size, and checksum.
3. Activate it atomically.
4. Require the serving process to start with an explicit release and fail readiness on mismatch.
5. Keep the previous immutable release available for rollback.
6. Make all frontend boot metadata agree on the same release.

Deliverable: process restart performs no remote multi-gigabyte acquisition and becomes ready within the agreed local startup budget.

#### P0.7 Remove the legacy Django product

1. Identify normalization and source fixtures that remain authoritative.
2. Move only those fixtures or small pure functions into publisher/query tests.
3. Delete Django models, migrations, views, templates, static assets, locale files, settings, commands, and compose configuration.
4. Remove Django, PostgreSQL, and Django-specific development dependencies.
5. Remove PostgreSQL from ordinary CI.
6. Update setup and architecture documentation in the same change.

Deliverable: no production, build, test, or documentation path imports or instructs use of Django.

#### P0.8 Enforce practical security and reliability gates

- Zero known high or critical vulnerabilities in runtime dependencies.
- No known vulnerability may remain in an unused runtime dependency. Delete it.
- No secrets or personal absolute paths in tracked configuration.
- Exact CORS origins, no credentials, public GET-only query surface.
- Parameterized queries and bounded work.
- No raw query, sentence, recording, or model-input logging.
- No service-worker caching of query, audio, or download responses.
- Timeouts and cancellation on all external model and API requests.
- Consistent generic public errors with useful internal failure codes.

Deliverable: security checklist and automated dependency audits pass.

#### P0.9 Prove target-user performance

Test the full representative release, not fixtures only, with at least one lower-end mobile profile and constrained Taiwan-like network conditions.

Acceptance targets after the application shell is loaded:

- Cached common lookup: p95 below 300 ms.
- Uncached ordinary lookup: p95 below 1.5 seconds.
- Record detail: p95 below 750 ms.
- Initial result payload: at most 100 KiB compressed.
- Initial page JavaScript and CSS: stay near the current small shell and do not include corpus or analytical runtimes.
- No query path expands more than a bounded response-sized collection in the browser.

These are starting service-level targets. Record measured device, network, corpus scope, query set, sample count, p50, p95, errors, and payload sizes.

Deliverable: repeatable benchmark report that meets the targets or documents a maintainer-approved correction based on measured evidence.

### P1: Strongly recommended

#### P1.1 Delete the static browser search system

After API cutover and rollback validation:

- Delete index and shard generation.
- Delete browser decompression, hashing, index matching, shard matching, and caches.
- Delete search index and search manifest schemas.
- Delete site-bundle joining logic used only for browser search.
- Remove `fflate` and `re2js` unless another real use remains.
- Remove static search artifacts from Pages and release validation.

Keep a tagged prior release as rollback evidence. Do not retain two production lookup paths in source.

#### P1.2 Remove browser DuckDB and custom Parquet

- Delete `site/src/duckdbExport.ts` and its branches/tests.
- Remove `@duckdb/duckdb-wasm`.
- Remove WebAssembly-specific CSP permission if nothing else needs it.
- Keep prepared Parquet in published downloads.

#### P1.3 Simplify the publisher

- Replace boolean profile combinations with explicit full-publication and fixture commands.
- Parse and normalize source once per release.
- Avoid creating tables, static APIs, or search data that the chosen command deletes.
- Keep deterministic archives, prepared formats, rights, citations, manifests, checksums, and verification.
- Reassess `publisher/build.py` only after deletion. Split orchestration from artifact manifest assembly only if both remain independently substantial.

Target: reduce the full publication critical path materially from the current 73 minutes without weakening verification.

#### P1.4 Reduce client commitments

- Delete the private JavaScript package.
- Publish plain JavaScript `fetch` examples against the API.
- Retain Python and R only if maintainers name a release owner and users need them.
- If retained, support the one live API and prepared downloads, not static shards.
- Version clients only after the v1 API contract is frozen.

#### P1.5 Consolidate documentation

- Delete historical goals, plans, status, and stale contributor instructions.
- Replace `DESIGN.md` with a concise Kakarayan-specific visual reference.
- Keep one current architecture description.
- Keep setup commands short and tested in CI where practical.
- Remove legacy Django documentation.
- Clearly distinguish canonical XML, derived query data, prepared downloads, local learner state, and external model services.

#### P1.6 Simplify localization

- Move stable UI messages into one typed English and Traditional Chinese catalogue.
- Add a test that both catalogues contain identical keys.
- Keep corpus data, citations, names, and model metadata separate from interface translation.
- Avoid adding a localization library until current helpers cannot express a real requirement.

#### P1.7 Refocus CI and tests

Pull request checks:

1. Python format, lint, and type check.
2. Publisher/query unit and contract tests.
3. Frontend lint, type check, and unit tests.
4. One browser smoke journey with accessibility.
5. Dependency and generated-artifact validation.

Release or scheduled checks:

1. Full browser matrix.
2. Full representative data correctness and performance benchmark.
3. Deterministic full publication verification.
4. Client package checks for clients that remain supported.

Delete repeated platform-neutral route tests and exact visual-value assertions. Keep screenshot testing only if maintainers will review intentional changes.

#### P1.8 Clean configuration

- Replace the legacy `.env.example` with only current application and publisher variables.
- Consolidate Python locking and API container installation.
- Keep deployment-specific values in environment variables, not source.
- Validate required settings once at startup with concise messages.
- Add a safe documented cleanup command for generated release directories.

### P2: Optional

- Restore explicitly downloaded offline corpus packs only after online lookup meets targets and demand is proven.
- Add server-side regex only with scope limits, timeouts, and demonstrated linguistic use.
- Add fuzzy search beyond a simple bounded implementation only after relevance evaluation.
- Add asynchronous large custom exports only after finite synchronous limits block real work. Do not add a queue preemptively.
- Add another locale only with a reviewer and complete translation ownership.
- Publish maintained Python or R packages to public registries only after their user and release workflows are established.
- Add richer metrics only if minimal logs cannot answer actual incidents.
- Reconsider custom Parquet only if prepared Parquet and bounded tabular exports do not meet researchers' needs.

## F. Proposed v1 architecture

### Application-level shape

```text
Canonical public FormosanBank XML
              |
              v
      Kakarayan publisher
       |       |       |
       |       |       +--> immutable prepared research downloads
       |       +----------> small static catalogues, rights, models and release metadata
       +------------------> immutable derived query read model
                                      |
                                      v
React browser client <------ read-only HTTP query application
       |
       +--> IndexedDB study deck and in-page recorder
       +--> explicit external MT and ASR calls
       +--> static documentation and prepared download links
```

### Boundaries

#### React client

Owns:

- Routing and presentation.
- English and Traditional Chinese interface text.
- Query form state and request cancellation.
- Small result summaries and on-demand detail rendering.
- Study deck and recording state on the user's device.
- Explicit consent and calls to registered MT/ASR services.
- Static catalogue, rights, model, documentation, and prepared-download views.

Does not own:

- Corpus-scale indexes.
- Search semantics.
- Full-corpus scans.
- Query result counting.
- Record-unit projection.
- Unbounded custom export.
- Database or release acquisition.

#### Read-only query application

Owns:

- Versioned public query routes.
- Input bounds and canonical matching semantics.
- Dictionary and sentence summaries.
- Full record detail.
- Stable cursor pagination.
- Bounded summaries, previews, and finite custom exports.
- Release identity, health, readiness, and minimal operational records.

It is one modular monolith and one process. Route functions call one concrete query store. There are no microservices, queues, distributed caches, account systems, or generic persistence abstractions.

#### Publisher

Owns:

- Clean pinned source validation.
- XML parsing and normalized canonical projection.
- Search-ready derived columns.
- Query read-model creation.
- Static catalogues and release metadata.
- Prepared research formats.
- Rights, citations, attribution, checksums, and manifests.
- Deterministic verification.

It does not own a second browser-specific search engine.

### Target repository map

```text
site/                 React client, local learner state and browser tests
api/                  required read-only HTTP application and query store
publisher/            source projection, release artifacts and verification
schemas/              public release, API and recipe contracts
content/              reviewed learning-content publication boundary
tests/fixtures/        shared representative source and semantic fixtures
docs/                  current architecture, API, data, rights and runbooks
.github/workflows/     concise CI, publication and deployment entry points
```

The root should contain only active project metadata and short entry documents. Generated artifacts, virtual environments, caches, and local data remain ignored and live outside tracked source.

### Data ownership

| Data | Owner | Mutability |
|---|---|---|
| Corpus XML | FormosanBank repositories | Canonical, versioned |
| Query read model | Publisher output | Immutable per release |
| Static catalogues and manifests | Publisher output | Immutable per release |
| Prepared downloads | Publisher output | Immutable per release |
| Study cards | User browser | Mutable and private to device |
| Temporary recordings | User browser | Mutable until discarded or explicitly submitted |
| MT/ASR requests | External model provider after consent | Governed by provider boundary |
| Application configuration | Runtime environment | Deployment-specific, non-secret defaults allowed |

### Required network interfaces

- Static application and metadata URLs.
- `GET` query, catalogue, detail, health, and readiness routes.
- A bounded export request. Keep it synchronous for v1 within a strict maximum.
- External model endpoints already represented by the model catalogue.

No write API is required for user accounts, decks, corpus data, or annotations in v1.

### Failure behavior

- Static catalogue, documentation, prepared downloads, and local decks remain available if query service is unavailable.
- Lookup shows a concise unavailable state and retry action.
- A mismatched release fails readiness and frontend bootstrap.
- An expensive query returns a stable bounded error that asks the user to narrow scope.
- Model failure does not affect corpus lookup and does not silently retry indefinitely.
- Deployment can reactivate the previous immutable query release.

## G. Deletion plan

Deletion happens only after the named replacement evidence exists. Do not preserve obsolete code as a fallback in the main branch.

### Delete after normalization fixtures are extracted

- `corpus/`
- `config/`
- `locale/`
- `manage.py`
- `docker-compose.yml`
- `docs/legacy-django.md`
- Django and PostgreSQL sections of `.env.example`
- Django and PostgreSQL steps and services in CI

Remove dependencies:

- `django`
- `django-environ`
- `django-htmx`
- `psycopg`
- `pytest-django`
- `django-stubs`

### Delete after React uses the authoritative query API

- Browser search engine sections of `site/src/data.ts`
- Browser search index types in `site/src/types.ts`
- Static search unit tests in `site/src/data.test.ts` that are superseded by API contract tests
- Search-index generation functions in `publisher/build.py`
- `schemas/search-index.schema.json`
- `schemas/search-manifest.schema.json`
- `publisher/site_bundle.py`
- `publisher/tests/test_site_bundle.py`
- Browser search packing and joining steps in `.github/workflows/publish-data.yml`
- Static search attachment steps in Pages assembly and verification
- Static shard methods in retained Python and R clients

Remove dependencies when no other use remains:

- `fflate`
- `re2js`

### Delete after prepared Parquet remains verified

- `site/src/duckdbExport.ts`
- DuckDB-specific test branches in `site/src/exports.test.ts` and `site/e2e/platform.spec.ts`
- DuckDB-specific UI and documentation text

Remove dependency:

- `@duckdb/duckdb-wasm`

### Delete or replace after the API contract is stable

- `clients/javascript/`
- Static-shard code in `clients/python/`
- Static-shard code in `clients/R/`
- Client documentation that names unpublishable packages

Retain Python or R only with named ownership and public installation verification.

### Delete historical and misleading documents

- `GOAL.md`
- `IMPLEMENTATION_PLAN.md`
- `IMPLEMENTATION_STATUS.md`
- `CLAUDE.md`

Replace rather than retain:

- `DESIGN.md` with a concise Kakarayan design system.
- `README.md` with current setup, repository map, common checks, and links.
- `docs/architecture.md` with the final v1 architecture.
- `docs/api.md` with the single authoritative API contract.

### Collapse duplicated modules and paths

- One normalization specification and fixture set.
- One query implementation in the API store.
- One field serializer for previews and exports.
- One finite recipe schema and executor.
- One release bootstrap identity.
- One Python dependency lock.
- One current architecture document.
- One typed bilingual message catalogue.

### Small immediate cleanup

- Remove unused `Stat` export from `site/src/components/Layout.tsx` if it remains unused.
- Stop exporting `loadAppData`, `COLUMNS`, `exportRow`, and unused GitBook constants unless tests or public modules need them.
- Make internal-only interfaces in `site/src/types.ts` non-exported where possible.
- Remove `@testing-library/react` if it still has no importer.
- Disable production source maps unless a documented support process consumes them.
- Update stale API license metadata.
- Replace contributor-specific paths in `.env.example`.

## H. v1 exit criteria

Kakarayan is ready for a separate cloud architecture and deployment decision only when every item below has authoritative evidence.

### Architecture and deletion

- [ ] The documented product consists of React, one required read-only query application, and one publisher.
- [ ] React uses the live API for all interactive dictionary, sentence, detail, summary, and custom-preview queries.
- [ ] No normal interactive request downloads a corpus index or shard.
- [ ] Django, PostgreSQL-specific application code, and HTMX are absent.
- [ ] Browser DuckDB and custom Parquet are absent.
- [ ] Historical implementation handoff documents are absent.
- [ ] No optional second query implementation is presented as supported.

### Correctness and data

- [ ] One reviewed normalization and matching specification exists.
- [ ] Golden fixtures cover Formosan text, punctuation, Unicode, translations, glosses, and bidirectional lookup.
- [ ] API results match those fixtures on a representative full release.
- [ ] Result summary and full detail contracts are versioned and tested.
- [ ] Stable cursor pagination does not duplicate or skip records in tested mutations of page size.
- [ ] Every UI-generated recipe validates against the published schema.
- [ ] Every custom export has a finite enforced row and byte limit.
- [ ] Preview, estimate, recipe, and export use the same field semantics.
- [ ] Canonical source, release ID, application commit, citations, rights, and checksums remain traceable.

### Performance and resource usage

- [ ] Representative Taiwan-like mobile benchmarks meet the P0 targets.
- [ ] Initial result payload is no more than 100 KiB compressed.
- [ ] Full nested record data loads only on request.
- [ ] The service worker caches only a bounded shell and small metadata.
- [ ] Query service startup performs no remote bulk data download or decompression.
- [ ] Full publication no longer creates browser search artifacts or performs duplicate source projection.
- [ ] Publication duration and peak disk use are measured and documented.

### Security and privacy

- [ ] Runtime dependency audits have no unaccepted high or critical findings.
- [ ] No tracked configuration contains credentials or contributor-specific paths.
- [ ] The API is public, read-only, bounded, parameterized, and restricted to intended origins.
- [ ] Raw queries, sentence text, recordings, and model inputs are absent from application logs.
- [ ] MT and ASR still require explicit consent and have cancellation/timeouts.
- [ ] CSP contains only capabilities used by the final frontend.
- [ ] Release mismatch fails closed at service readiness and frontend bootstrap.

### Reliability and operations

- [ ] Health and readiness distinguish process life from valid release readiness.
- [ ] Startup and request records contain release ID, route, status, duration, and failure code without sensitive content.
- [ ] The prior immutable release can be reactivated through a tested rollback procedure.
- [ ] External model failure does not affect corpus lookup.
- [ ] Static documentation, catalogues, prepared downloads, and local study decks degrade independently from query service failure.

### Maintainability and developer experience

- [ ] README setup and test commands work from a clean checkout.
- [ ] One document accurately explains entry points, data flow, configuration, testing, and publication.
- [ ] Python and frontend dependencies have one authoritative lock each.
- [ ] Pull request CI contains high-value format, lint, type, contract, unit, accessibility, and smoke checks.
- [ ] Release checks cover full-data determinism and representative performance.
- [ ] No exact-copy or pixel assertion remains unless it protects an approved invariant.
- [ ] Every retained client has named ownership, a verified public installation path, and contract tests.
- [ ] Generated output cleanup is documented and safely scoped.

### Completion evidence package

Before calling v1 complete, attach or link:

1. The final architecture document.
2. The deletion diff with measured line, dependency, static-data, and bundle reductions.
3. Search semantics fixtures and contract test results.
4. Full-release performance benchmark results.
5. Dependency audit output.
6. Clean-checkout setup and CI results.
7. Publication determinism and rights verification results.
8. Release activation and rollback rehearsal results.

Passing narrow unit tests or having a green deployment alone does not prove these criteria. Each item must be checked against the representative full release and the actual production path.
