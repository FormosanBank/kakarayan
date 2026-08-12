# Kakarayan v1 completion evidence

This report records the local production-scale validation completed on 2026-08-11 PDT.
Generated evidence remains under the ignored `build/` directory. The guarded publication
workflow reproduces the full build and preserves benchmark and reconciliation reports as
GitHub Actions artifacts.

## Validated release

| Item | Value |
| --- | --- |
| Release | `fb-20260811-2ac196d6` |
| FormosanBank commit | `2ac196d6974352fc0907324bbd246dabae1480b0` |
| Benchmarked Kakarayan commit | `da6e120f089100d1a7faa8b232e9d2aa3ff54b9b` |
| Schema | `1.0.0` |
| Release artifacts | 12 |
| User-visible downloads | 11 |
| Warning count | 0 |
| Publishability | All `site-metadata`, `release-core`, and `prepared-download` artifacts passed |

The evidence document is the only change after the benchmarked application commit. The
production publication workflow rebuilds and benchmarks the exact merge commit before it
can create a draft release.

### Full source counts

| Unit | Count |
| --- | ---: |
| Texts | 14,604 |
| Sentences | 491,762 |
| Words | 321,055 |
| Morphemes | 267,026 |
| Forms | 2,159,711 |
| Phonology rows | 2,078,202 |
| Translations | 1,489,800 |
| Audio references | 529,581 |
| Tokens | 8,250,189 |

## Architecture evidence

The final product has three application parts: the React site, one required read-only
FastAPI query application, and one deterministic publisher. The boundaries and data flow
are documented in [architecture.md](architecture.md). The normative matching rules are in
[search-semantics.md](search-semantics.md), the HTTP contract is in [api.md](api.md), and
publication and rollback are in [publication.md](publication.md).

The production site contains no corpus index, search shard, SQLite database, analytical
runtime, or prepared dataset. All interactive dictionary, concordance, record-detail,
summary, preview, and finite-export requests use the one query API. The service opens one
already activated SQLite read model in immutable, read-only mode. Startup does no network
download, decompression, or corpus projection.

Static metadata, documentation, prepared downloads, MT/ASR integrations, and local study
state have separate failure boundaries. API failure does not remove the static resources.
External model failure does not affect corpus lookup.

## Deletion and dependency evidence

Measurements compare `origin/main` before this branch with the completed branch.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Tracked files | 280 | 186 | 94 fewer |
| Counted source lines | 37,215 | 25,975 | 11,240 fewer |
| Diff lines | n/a | 6,583 added, 20,102 deleted | 13,519 net deletion |
| Python production dependencies | 12 | 2 | 10 fewer |
| Python dependencies including groups | 20 | 14 | 6 fewer |
| Frontend direct dependencies | 23 | 19 | 4 fewer |
| Frontend locked packages | 337 | 308 | 29 fewer |
| Release artifacts | 126 | 12 | 114 fewer |

The removed application paths include Django, PostgreSQL-specific application code, HTMX,
browser DuckDB, browser search/decompression code, the duplicate JavaScript, Python, and R
clients, browser Parquet generation, legacy schemas, and historical implementation handoff
documents.

The old web deployment required about 332 MB of release-specific search shards and about
39 MB of DuckDB WebAssembly assets. Neither is present in the final Pages artifact. The
verified production site is 539,612 bytes across 20 files. Its main JavaScript is 102.00 KB
after gzip and its CSS is 9.95 KB after gzip.

## Publication measurements

The final full build used the pinned commits above and `--compress-database --release-only`.

| Measure | Result |
| --- | ---: |
| Wall time | 1,305.04 seconds, or 21 minutes 45 seconds |
| Maximum resident memory | 1,523,122,176 bytes, or 1.42 GiB |
| Final artifact bytes | 5,173,909,452 bytes, or 4.82 GiB |
| Expanded SQLite | 4,973,699,072 bytes, or 4.63 GiB |
| Compressed SQLite | 1,452,220,605 bytes, or 1.35 GiB |
| Derived peak output-directory use | 12,027,080,909 bytes, or 11.20 GiB |

Peak output use is derived from measured full-release components at the deterministic
high-water stage: expanded SQLite, raw CSV, raw JSONL, completed CSV ZIP, and the in-progress
JSONL ZIP. The local complete FormosanBank checkout occupied another 2,508,856 KiB including
Git history. Publication hosts should keep at least 20 GiB free for the source checkout,
dependencies, filesystem overhead, and transient files.

The original full publisher reached about 9.02 GiB resident memory. Streaming XLSX
normalization and compact alignment output reduced the final full-build peak by about 84%.

The time-alignment package changed from 1,029,561,232 bytes and 2,384,701 ZIP members to
31,257,219 bytes and 7,724 members. It still contains every 397,707 valid timed media group
in `alignments.jsonl`. EAF, WebVTT, and SRT remain available for all 1,544 multi-cue groups.
TextGrid is emitted when cues do not overlap. Two same-input full-data alignment builds had
the identical SHA-256 `b28ee3787b1805d5e23aca244e8e9dbc9cce7a9bf009ecd7b94cbde676aa7046`.

## Integrity, determinism, and data agreement

`publisher.verify_release` passed the exact 12-artifact inventory, manifest schema,
`SHA256SUMS`, each artifact size and SHA-256, compressed and expanded SQLite identity,
SQLite integrity, safe asset mappings, and all three required rights scopes. Verification
took 66.08 seconds and used about 41 MiB resident memory.

Two representative full builds from the same FormosanBank commit but different Kakarayan
commits produced identical checksums for 10 of 12 artifacts. Only SQLite and static metadata
differed because both intentionally embed the application commit. Fixture tests prove exact
same-input publication identity. The manual production workflow now performs two complete
same-commit builds, compares their manifests byte for byte, and refuses publication on any
difference.

Full reconciliation passed for CSV, TSV, flat JSONL, hierarchical JSONL, Parquet, SQLite,
and XLSX. Counts and deterministic sampled row IDs agreed across all representations. The
reconciliation took 16 minutes 56 seconds and used about 1.04 GiB resident memory. The
streaming XLSX implementation was also compared byte for byte with the prior implementation
and retained SHA-256 `1b7a2a9d9923c96f58fab2e9b1649db2746da07f7316ce204434e294e768109b`.

## Query performance

The API benchmark used the complete active release, two warmups, and 20 timed requests per
case. Every case passed its first-request, p95, payload, and nonempty-result requirements.

| Case | p95 | Gzip payload |
| --- | ---: | ---: |
| Dictionary exact | 5.692 ms | 948 B |
| Dictionary prefix | 7.715 ms | 9,281 B |
| Dictionary contains | 18.963 ms | 10,690 B |
| Reverse dictionary exact | 23.502 ms | 3,304 B |
| Reverse dictionary contains | 46.666 ms | 8,725 B |
| Sentence exact | 6.402 ms | 4,616 B |
| Sentence prefix | 25.374 ms | 4,560 B |
| Sentence contains | 59.608 ms | 4,619 B |
| Reverse sentence exact | 6.468 ms | 4,289 B |
| One-character Chinese contains | 192.442 ms | 4,981 B |
| Dataset preview | 6.061 ms | 3,383 B |
| Research summary | 1.719 ms | 1,441 B |
| Sentence detail | 1.427 ms | 1,836 B |

The repeatable constrained-browser run used Playwright's Pixel 7 profile, 80 ms latency,
1.5 Mbps download, 0.75 Mbps upload, 4x CPU throttling, and a disabled browser cache. The
shell loaded in 1,526.369 ms. Twelve live `fangcalay` sentence lookups had a 168.592 ms p50,
266.305 ms p95, and zero errors. The p95 is below the 300 ms cached-common target. Every
local first request is below the 1.5 second ordinary-lookup target, record detail is below
750 ms, and every initial response is far below the 100 KiB compressed limit.

## Activation and rollback

Final full-data activation verified both database identities, ran SQLite integrity checks,
and atomically replaced the database and active manifest in 61.16 seconds with about 61 MiB
resident memory. Application startup then became ready without network or decompression
work.

A real rollback used the same active paths:

1. Stop the serving process.
2. Activate prior immutable Kakarayan commit `3c12008fb5ed9308072d55cbc769675c8d26af21`.
3. Start the API, confirm `/readyz`, and execute an exact Amis dictionary query.
4. Stop it, reactivate final commit `da6e120f089100d1a7faa8b232e9d2aa3ff54b9b`, and confirm readiness.

The rollback activation took 52.01 seconds. Restoring the final release took 59.00 seconds.
Both served release `fb-20260811-2ac196d6`, and the active manifest reported the intended
Kakarayan commit at each step. Unit tests separately cover rollback between distinct release
IDs and fail-closed partial replacement.

## Correctness, browser, and security gates

The final local gate results were:

- Ruff format and lint: passed.
- Mypy over `api` and `publisher`: passed.
- Python: 47 passed with 88% measured coverage.
- Vitest: 24 passed across 9 files.
- ESLint and TypeScript: passed.
- Production site build and size verification: passed.
- Chromium desktop and mobile contract journeys: 13 passed, 5 intentionally skipped.
- Firefox and WebKit contract journeys: 10 passed, 8 intentionally skipped.
- Taiwan-like mobile performance journey: passed.
- `pip-audit`: no known vulnerabilities.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Full release verification and required rights scopes: passed.
- A new detached checkout completed locked Python and npm installs, fixture publication and
  verification, all 71 unit tests, production site build, and static-site verification.

The browser journeys cover release identity, English and Traditional Chinese, bidirectional
dictionary and sentence lookup, summary then on-demand detail, stable source links, research
preview and finite export, downloads, accessibility, local study-state migration and backup,
offline shell behavior, and API-outage degradation.

Security contracts cover exact CORS origins, GET-only public access, parameter bounds,
SQLite progress limits, finite rows and response bytes, cursor validation, spreadsheet
formula safety, generic public errors, fail-closed release identity, and privacy-preserving
structured logs. Production Uvicorn access logs are disabled. Application logs record route
templates, release ID, status, duration, response size, and failure codes without raw query
text or record content. MT and ASR retain explicit consent, timeout, cancellation, and local
recording boundaries.

## Reproduction commands

The concise setup and fixture commands are in the root [README](../README.md). Full release,
activation, verification, deployment, and rollback commands are in
[publication.md](publication.md). Pull-request CI runs the bounded code and browser gates.
The manual release workflow additionally runs the full double build, exact manifest
comparison, full representation reconciliation, release activation, and query benchmark.

No release should be published from these local ignored outputs. Production must use the
guarded workflow on the reviewed merge commit and inspect its draft release before
publication.
