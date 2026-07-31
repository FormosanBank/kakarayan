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
- FormosanBank has mixed per-corpus rights. Public visibility is not a blanket license.
- Original and standard orthography are different source concepts and must stay labeled.
- Seediq and Truku share `trv`; display identity cannot be keyed by ISO code alone.
- Public MT artifacts are too large for a practical browser-local first release.
- Public model services may sleep or be temporarily unavailable.

## Governance and external actions

- Kakarayan currently has no software license file. Gabriel Gras and FormosanBank maintainers
  must approve a software license before public deployment. Implementation continues without
  guessing a license.
- A new public no-cost Hugging Face Space for the optional live corpus API may require an
  organization maintainer to create or authorize it. The static API remains the launch
  fallback and no paid compute will be purchased.
- Production Pages and Space deployment stay disabled for pull requests and feature
  branches.

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
- [x] Implement fail-closed rights entries and official public Hugging Face metadata
  collection.
- [x] Add synthetic fixture publication and schema/integrity/determinism tests.
- [x] Implement scalable language/corpus search shards, public orthography tables, release
  discovery, and deterministic site-data assembly.
- [x] Implement the responsive bilingual application shell, catalogues, local corpus search,
  result export, source citations, and fail-closed download interface.
- [x] Implement the Amis-first learner studio with local IndexedDB cards, deterministic SRS,
  JSON backup/restore, Anki TSV export, pronunciation recording, and orthography conversion.
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
- [x] Add manual local study cards, decks, tags, inventory filtering, and stale source
  release warnings.
- [x] Complete browser text, sentence, word, morpheme, token, and audio-reference record
  projections and carry the record unit through validated, locally executable recipes.
- [x] Add exact match counts, deterministic progressive result display, KWIC, interlinear
  tables, resolvable audio, stable record links, citation actions, and transparent automatic
  headword candidate groups.
- [x] Complete local study directions, queue counts, CSV export, audio references, and
  confirmed full reset; add ASR duration validation, model disclosure, and transcript cards.
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
- [ ] Complete deterministic full-data publisher and release validation.
- [ ] Complete full-corpus, browser, accessibility, security, and reproducibility validation.
- [ ] Open one draft pull request and leave it unmerged.

## Next slice

Implement full-representation reconciliation, then run two clean deterministic full-data
builds from the pinned public source. Rebuild the full Pages projection, run performance,
cross-browser, accessibility, client, and dependency checks, and open the single draft pull
request without merging it.
