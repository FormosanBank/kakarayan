# Kakarayan implementation status

This file is the durable recovery record for the platform implementation described in
[`GOAL.md`](GOAL.md) and [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Safety and source state

- Working branch: `feature/kakarayan-language-platform`
- Kakarayan base: `097b349aa7f33c740953b4f7aa75502fbf740bb2`
- Upstream `origin/main`: `097b349aa7f33c740953b4f7aa75502fbf740bb2`
- Public source repository: `FormosanBank/FormosanBank`
- Canonical source input: `Corpora/<CorpusName>/XML/**/*.xml`
- Schema authority: `QC/validation/xml_template.xsd`
- Governing repository guidance read: `AGENTS.md`, `.github/copilot-instructions.md`,
  `README.md`, `LICENSE.md`, `AI-USE-ADDENDUM.md`, `NOTICE-AI.md`
- Governing GitBook sections read: architecture, XML, dialect, corpus, folder structure,
  Hugging Face, developer, machine-translation, contribution, and terms pages
- Private repositories and private corpus material accessed: none

## Baseline

Recorded 2026-07-30 before platform code changes:

- `uv run ruff check .`: pass
- `uv run mypy corpus config`: pass
- `uv run pytest`: 18 pass and 64 setup errors because PostgreSQL at
  `localhost:5433` was unavailable
- `docker compose up -d db`: unavailable because the local Docker daemon was not running
- Existing Kakarayan branch worktree before this task: clean
- Node.js: 22.22.2
- npm: 10.9.7
- uv: 0.11.31

The database-dependent legacy tests must be rerun once PostgreSQL is available. This is an
environment condition, not a reason to skip the new static, publisher, API, or client tests.

## Source observations

- The current local public FormosanBank checkout contains 18,257 XML files.
- The full `Corpora/` tree is about 1.1 GiB because it also contains source tooling and
  documentation.
- The largest observed XML subtree is `ePark/XML` at about 217 MiB.
- The local checkout is on a corpus-maintenance branch, so publication must resolve and pin
  an explicit remote commit rather than treating the working tree as current `main`.
- Kakarayan applies a reviewed CC BY-NC 4.0 publication profile to every corpus discovered
  in the canonical public FormosanBank checkout. Explicit corpus metadata may impose a
  stricter source or community term.
- Original and standard orthography are different source concepts and must stay labeled.
- Seediq and Truku share `trv`; display identity cannot be keyed by ISO code alone.
- Public MT artifacts are too large for a practical browser-local first release.
- Public model services may sleep or be temporarily unavailable.

## Governance and external actions

- Root `LICENSE.md` licenses Kakarayan's original software, documentation, interface text,
  and project-produced assets under CC BY-NC 4.0. Corpus records and third-party material
  retain their supplied terms.
- A new public no-cost Hugging Face Space for the optional live corpus API may require an
  organization maintainer to create or authorize it. The static API remains the launch
  fallback and no paid compute will be purchased.
- Production Pages and data publication stay disabled for pull requests and feature
  branches. The workflows run publication only from the default branch or an approved
  manual dispatch.
- The current public source contains 22 corpus catalog entries. A read-only policy audit
  gives all 22 reviewed, redistribution-allowed, noncommercial entries. Explicit overrides
  continue to fail closed when unreviewed or restricted.
- `FormosanBank/formosan-mt` and `FormosanBank/formosan_asr` are configured as direct-browser
  services. The official Hugging Face API reported both running with ready domains on
  2026-08-01, with Gradio routes `/translate` and `/transcribe`.
- The authenticated contributor has `push` and `triage`, but not `maintain` or `admin`.
  GitHub returned `404 Not Found` for Pages creation and the dependency-graph SBOM endpoint.
  Those two repository settings remain administrator actions.

## Progress

- [x] Reconciled the implementation plan with the expanded research, learner, model, and API
  scope.
- [x] Kept the goal prompt within the requested 150 to 300 lines.
- [x] Renamed the feature branch to comply with repository branch naming rules.
- [x] Ingested Kakarayan, FormosanBank, GitBook, rights, XML, and dialect guidance.
- [x] Commit and push the corrected planning checkpoint (`9a42c34`).
- [x] Implement initial versioned catalogue, release, rights, and model schemas.
- [x] Implement deterministic identifiers, safe mixed-content XML projection, canonical
  token counting, Seediq/Truku resolution, and public-source verification.
- [x] Implement deterministic CSV, JSONL, SQLite, static API, checksum, and manifest output.
- [x] Implement the reviewed public-repository noncommercial rights profile, stricter
  fail-closed overrides, and official public Hugging Face metadata collection.
- [x] Add synthetic fixture publication and schema/integrity/determinism tests.
- [x] Implement scalable language/corpus search shards, public orthography tables, release
  discovery, and deterministic site-data assembly.
- [x] Implement the responsive bilingual application shell, catalogues, local corpus search,
  result export, source citations, and fail-closed download interface.
- [x] Implement learner tools for every supported language, with cited lookup cards, local
  IndexedDB storage, deterministic SRS, JSON backup/restore, Anki TSV export, pronunciation
  recording, and orthography conversion.
- [x] Implement optional direct-browser MT and ASR adapters with consent, cancellation,
  cold-start states, and source-preserving failure behavior.
- [x] Implement the model catalogue and static developer documentation against versioned
  generated contracts.
- [x] Verify the frontend with lint, strict TypeScript, ten unit tests, a production build,
  a zero-vulnerability npm audit, desktop interaction, mobile rendering, and browser logs.
- [x] Implement the optional read-only FastAPI service with checksummed release acquisition,
  immutable SQLite startup, health/readiness, structured errors, exact CORS, bounded
  queries, opaque cursors, catalogue and record reads, dictionary, concordance, and
  frequencies.
- [x] Implement thin JavaScript, Python/CLI, and R clients with release pinning, timeouts,
  pagination, structured errors, static search-shard access, and checksum verification.
- [x] Exercise all three clients against the same running fixture API; package-build Python,
  compile/test JavaScript, and pass `R CMD check`.
- [x] Preserve raw attribute maps, inline markup structure, raw and parsed timing, duration,
  availability, explicit nulls, and common SQLite views in the normalized projection.
- [x] Implement deterministic prepared CSV/TSV, partitioned hierarchical JSONL, Parquet,
  XLSX, canonical XML ZIP, CLDF Generic, plain/interlinear text, audio manifest, and
  timing-gated EAF/TextGrid/WebVTT/SRT outputs.
- [x] Implement eight browser selection exports plus versioned non-executable recipe schema,
  local validation, pinned-release execution, and a public-checkout fallback.
- [x] Keep bulk packages off Pages, attach artifact-level rights decisions, and fail closed
  when a corpus redistribution conclusion remains unreviewed.
- [x] Add host-independent compressed-shard integrity, bounded Pages output, release
  verification, site budgets, and incremental prepared-format cleanup.
- [x] Add desktop and mobile Playwright coverage with route, compressed search, and WCAG
  checks. Correct the accessibility issues found by those checks.
- [x] Implement guarded CI, Pages, draft data-release, and optional Space workflows with
  pinned actions, least-purpose jobs, immutable source refs, rights gates, and no pull
  request deployments.
- [x] Implement source-exact, normalized, prefix, contains, translation, phonology, gloss,
  bounded fuzzy, and non-backtracking RE2 browser search across preserved linguistic tiers.
- [x] Implement a bounded browser dataset builder with field selection, deterministic
  preview, preflight estimates, cancellation, fail-closed rights, nine formats, and
  locally executable recipes.
- [x] Implement Worker-based source, normalized, translation, distribution, n-gram,
  collocate, type/token, and seeded-sample summaries with safe table export.
- [x] Implement lazy single-threaded DuckDB-Wasm Parquet output and verify real Parquet
  signatures in Chromium, Firefox, and WebKit without a backend.
- [x] Add a validated reviewed-content registry and visibly fail closed while no reviewed
  lessons have been contributed.
- [x] Add checksummed per-language and per-corpus vocabulary indexes with deterministic
  shard postings so common search modes fetch only candidate sentence records.
- [x] Verify compressed and decoded search index/shard bytes in the browser and JavaScript,
  Python, and R clients.
- [x] Add stable language and corpus detail routes with coverage, capabilities, pinned
  source links, and corpus-specific rights evidence.
- [x] Add language, corpus, tier, and format facets to prepared download artifacts and
  expose reproducible command-line and checksum instructions.
- [x] Add local audio-file practice, reference and ASR hypothesis comparison, and transcript
  copy/download while clearly labeling word error as a text comparison, not pronunciation
  grading.
- [x] Add decks, tags, inventory filtering, stale source release warnings, and saving cited
  cards only from dictionary and sentence results.
- [x] Complete browser text, sentence, word, morpheme, token, and audio-reference record
  projections and carry the record unit through validated, locally executable recipes.
- [x] Add exact match counts, deterministic progressive result display, KWIC, interlinear
  tables, resolvable audio, stable record links, citation actions, and transparent automatic
  headword candidate groups.
- [x] Complete local study directions, queue counts, CSV export, audio references, and
  confirmed full reset; add ASR duration validation, model disclosure, and transcript
  copy/download without allowing machine output into the cited study deck.
- [x] Separate word-for-word dictionary lookup from sentence search, including dedicated
  routes, modes, result presentations, source citations, and target-language selectors.
- [x] Derive exact translation-language availability for each selected Formosan language
  and corpus scope, including lexical-only translations for dictionary results.
- [x] Replace the original prose-heavy interface with a compact reference-desk design and
  audit desktop and mobile layouts against the practical lookup structure seen at Klokah.
- [x] Add root CC BY-NC 4.0 licensing across project and client package metadata.
- [x] Configure public MT and ASR service routes from the generated model catalogue rather
  than hard-coded frontend service names.
- [x] Add corpus citation/source metadata, BibTeX and RIS download, dialect inventories,
  richer public model-card metadata, dynamic document metadata, a sitemap, useful
  no-script links, and privacy-bounded diagnostics.
- [x] Complete Traditional Chinese interface parity across discovery, research, dataset
  construction, downloads, learner cards, pronunciation, MT, orthography, models, rights,
  developer documentation, errors, and diagnostics; add an end-to-end locale workflow.
- [x] Wrap every static API response in one schema-validated v1 envelope with generation
  time, canonical URL, release ID, Kakarayan version and commit, and the distinct pinned
  FormosanBank source commit; update site verification and all three public clients.
- [x] Add cross-representation reconciliation for manifest, SQLite, CSV, TSV, flat and
  hierarchical JSONL, Parquet, XLSX, duration totals, deterministic complete-row samples,
  canonical XML bytes, and assembled browser shard counts.
- [x] Complete one full release-only benchmark against pinned public FormosanBank commit
  `40fd519cd82295bd7824e207990d277b871ad47f`: 487,354 sentences, 8,214,390 tokens,
  no publisher warnings, 5.4 GiB output, 9.1 GiB peak memory, and 20 minutes 28 seconds.
- [x] Complete and verify an indexed full Pages data build for the same pinned source:
  487,354 sentences, 8,214,390 tokens, 640 manifest artifacts, no publisher warnings,
  about 319 MiB on disk, 642 files, 6 minutes 30 seconds, and 2.63 GiB peak memory.
- [x] Keep the largest full Pages data file below 24 MiB and the complete built application
  shell at 41.6 MiB, within the 50 MiB per-file and 900 MiB total publication budgets.
- [x] Complete two clean full release-only builds from identical pinned inputs and prove
  that every one of the 120 generated files has an identical SHA-256 digest.
- [x] Verify both full releases, each with 118 declared artifacts, and complete
  cross-representation reconciliation across SQLite, CSV, TSV, flat and hierarchical
  JSONL, Parquet, XLSX, canonical XML, browser shards, duration totals, and counts.
- [x] Complete full-corpus search, performance, responsive, keyboard, bilingual,
  accessibility, model-adapter, local-storage, offline, security, client, and
  reproducibility validation.
- [x] Add reviewed screenshots for the English desktop home and search experiences and the
  Traditional Chinese mobile learner experience.
- [x] Open draft pull request
  [#1](https://github.com/FormosanBank/kakarayan/pull/1) and leave it unmerged.

## Final full-data evidence

All measurements below use the clean public checkout at FormosanBank commit
`40fd519cd82295bd7824e207990d277b871ad47f`. The checkout stayed clean, and no private
repositories or corpus sources were used.

- Release ID: `fb-20260730-40fd519c`
- Producing Kakarayan commit recorded in the immutable artifacts:
  `59414782154862234e2761ddbea3a5fbf5977454`
- Full corpus counts: 14,599 texts, 487,354 sentences, 317,367 words, 261,823
  morphemes, 2,133,105 forms, 2,044,323 phonology tiers, 1,476,322 translations,
  529,586 audio references, and 8,214,390 searchable tokens
- Public model catalogue: 20 models and 4 optional services
- Release build A: 120 files, 118 artifacts, 5,697,313,348 declared artifact bytes,
  22 minutes 27 seconds, about 9.94 GB peak RSS, zero publisher warnings
- Release build B: 120 files, 118 artifacts, 22 minutes 1 second, about 9.95 GB peak
  RSS, zero publisher warnings
- Determinism: complete relative-path and SHA-256 trees match exactly
- Full Pages data: 642 files, 640 manifest artifacts, 332,256,121 declared artifact
  bytes, 6 minutes 24 seconds, about 2.88 GB peak RSS, zero publisher warnings
- Final assembled site: 661 files, 375,896,044 bytes, largest file 39,362,651 bytes
- Final reconciliation: 693.25 seconds, about 2.59 GB peak RSS, all representations
  matched. Explicit hierarchical exclusions are sentence-empty texts and text-owned tiers
  that cannot be represented under a sentence node.
- Browser budget sample against the full Glosbe Amis scope: 193,100 initial route bytes,
  106,337 JavaScript bytes before lazy DuckDB, 77,758 catalogue bytes, 109 ms cold exact
  search, 114 ms warm exact search, and 35,100,000 bytes of used JavaScript heap

## Final validation evidence

- Python formatting and Ruff: pass across 79 files and the complete repository
- Mypy: pass across 78 source files
- Publisher tests: 23 pass
- API and Python client tests: 11 pass
- Frontend unit and component tests: 43 pass across 8 files
- Full fixture browser matrix: 47 pass and 13 intentional project-specific skips across
  desktop Chromium, mobile Chromium, Firefox, and WebKit
- Full-data desktop Chromium: 14 pass, including measured budgets, offline local study,
  migration/backup/restore, microphone denial, deletion, keyboard, and accessibility
- Actual DuckDB-Wasm Parquet signatures: pass in Chromium, Firefox, and WebKit using the
  rights-approved invented fixture
- Model adapters: success, cold start, cancellation, timeout, malformed output, provider
  outage, ASR mapping, and input bounds all pass without contacting an optional live model
- JavaScript client: build and 4 tests pass
- Python client: sdist and wheel build; live fixture smoke passes
- R client: package build/install and live fixture smoke pass. `R CMD check --as-cran`
  reports its expected pre-publication license/time/Pandoc notes and warns that no examples,
  tests, or vignettes are bundled.
- Shared live API smoke: JavaScript, Python, and R each return the same one-item exact
  dictionary result for `lima` from `fb-20240102-d2b32874`
- Site npm audit: zero known vulnerabilities
- Python `pip-audit`: zero known vulnerabilities
- Python and Node dependency license metadata inventoried. The old transitive
  `json-bignum` package declares MIT through its legacy `licenses` field and bundled
  license file rather than the modern singular metadata field.
- GitHub workflow security audit: no findings after disabling checkout credential
  persistence; six explicitly suppressed informational audits remain in the existing
  workflow policy.
- Tracked secret-pattern scan: pass
- Local complete pytest: 52 pass and 64 database-test setup errors because the local
  Docker daemon and PostgreSQL on port 5433 are unavailable. CI provisions pinned
  PostgreSQL and is the authoritative database/container gate.

Screenshots:

- [`docs/screenshots/home-desktop-en.png`](docs/screenshots/home-desktop-en.png)
- [`docs/screenshots/search-desktop-en.png`](docs/screenshots/search-desktop-en.png)
- [`docs/screenshots/learn-mobile-zh.png`](docs/screenshots/learn-mobile-zh.png)

## Remaining external approvals

- A repository administrator must set Pages to GitHub Actions and configure its protected
  environment. The contributor token cannot read or create the Pages configuration.
- A repository administrator must enable the dependency graph. This is repository metadata
  analysis and does not run a corpus build.
- A maintainer must dispatch the real data workflow, inspect its immutable draft release,
  and publish that release before the Pages workflow can deploy matching download assets.
- A maintainer may create a public no-cost Hugging Face Docker Space and configure its
  narrowly scoped token if the optional live API is wanted at launch.
- The local Docker daemon is unavailable. GitHub CI supplies PostgreSQL and Docker for the
  remaining environment-dependent checks.

## Next slice

Commit and push the completed platform changes, update the draft pull request, and fix every
branch-owned CI failure. Then a repository administrator can merge the PR, enable Pages and
the dependency graph, publish the first approved data release, and run the guarded Pages
deployment in the order documented in [`docs/publication.md`](docs/publication.md).
