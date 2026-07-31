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
- [ ] Implement deterministic full-data publisher and release artifacts.
- [ ] Implement the static research and download application.
- [ ] Implement the learner studio and offline local progress.
- [ ] Implement MT/ASR adapters and model catalogue.
- [ ] Implement the static API, optional live API, and clients.
- [ ] Implement guarded CI, Pages, release, and Space workflows.
- [ ] Complete full-corpus, browser, accessibility, security, and reproducibility validation.
- [ ] Open one draft pull request and leave it unmerged.

## Next slice

Commit and push the publisher foundation. Then implement the static application shell,
fixture-data assembly, bilingual navigation, research catalogue, dictionary, learner
workflows, and model catalogue against these contracts.
