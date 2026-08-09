# Goal: Ship the Complete Kakarayan Language Platform

## Mission

Implement the entire public site specified in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

Assume you have no prior knowledge of Kakarayan or FormosanBank.

Read the implementation plan completely before changing code.

Inspect the repository and current public corpus rather than trusting historical snapshots.

Carry the work through implementation, full-data validation, documentation, commits, push,
and one review-ready pull request.

Do not stop at a plan, scaffold, mockup, prototype, or partial corpus.

## Non-negotiable outcome

- Deliver a polished public platform for research, download, language learning, models,
  and developer access to public FormosanBank resources.
- Run the core production application on GitHub Pages.
- Keep all essential features useful without a production backend or paid hosting.
- Provide a best-effort live read-only corpus API on a no-cost Hugging Face Space, with the
  static API as the permanent fallback.
- Use GitHub Actions for offline data preparation.
- Use Pages for application assets and interactive query shards.
- Use GitHub Releases for large prepared downloads.
- Perform search, filtering, preview, and modest custom exports in the browser.
- Support English and Traditional Chinese at full feature parity.
- Deliver an Amis-first learner studio with a reusable capability model for other languages.
- Integrate registered public FormosanBank MT and ASR endpoints with explicit consent,
  honest machine-output labels, service status, cancellation, and graceful degradation.
- Publish a public model catalogue, static JSON API, optional REST API, and thin JavaScript,
  Python/CLI, and R clients.
- Serve linguists and learners without requiring a terminal, GitHub account, or corpus
  engineering skills.

## Branch and pull request contract

- Never commit to `main`.
- Check the current branch and worktree before editing.
- Continue on `feature/kakarayan-language-platform` unless explicitly instructed otherwise.
- If on `main`, switch to the dedicated branch before changing anything.
- Make coherent commits as vertical slices are completed.
- Keep the complete implementation in this one branch.
- Open exactly one implementation pull request against `main`.
- Include this goal and the implementation plan in that PR.
- Do not split the implementation across smaller PRs.
- Do not merge the PR.
- Do not publish branch code over production Pages.
- PR workflows may build artifacts but may not deploy.
- Production deployment must be guarded to `main`.
- Hugging Face Space deployment must be guarded to `main` or explicit maintainer dispatch.

## Source-of-truth contract

- Read only the public `FormosanBank/FormosanBank` repository.
- Never access or publish private corpus repositories.
- Read only public model cards and public endpoint metadata for the model registry.
- Never access private model, toolkit, or training-data repositories.
- Resolve the requested remote ref; do not assume a local FormosanBank checkout is current.
- Pin every build to an exact FormosanBank commit.
- Read that commit's tree, not deleted history, and allowlist publishable source paths.
- Do not pull LFS/Hugging Face audio unless an explicit rights-compatible release requires it.
- Treat FormosanBank XML as canonical.
- Treat Kakarayan tables, indexes, manifests, and packages as derived.
- Package canonical XML byte-for-byte from source files.
- Never regenerate archival XML from Django models or relational tables.
- Retain repository, commit, corpus, source path, local ID, and ordinal provenance.
- Preserve repeated tiers, attributes, source order, inline markup, descendant text, and tails.
- Preserve per-text citation, BibTeX, copyright, source, audio, glottocode, and dialect.
- Preserve word/morpheme class attributes and tier notes, versions, languages, and raw timing.
- Label original source orthography separately from FormosanBank standard orthography.
- Reuse FormosanBank's canonical language-resolution and token-counting rules.
- Never silently repair or discard malformed source data.
- Fail publication or quarantine affected records with a visible report.

## Existing Kakarayan contract

- Preserve the existing researcher's Django/PostgreSQL/HTMX application in this PR.
- Do not delete or relocate it merely because production becomes static.
- Study its normalization, search behavior, tests, bilingual language, CSS, and assets.
- Reuse correct behavior and visual identity.
- Keep existing checks passing unless a documented change requires otherwise.
- Do not treat the PostgreSQL projection as a lossless export source.

## Required public product

- Complete top-level Learn, Explore, Download, Developers, Models, and About areas.
- Complete home, corpus explorer, corpus detail, language explorer, and language detail views.
- Distinct display identities for Seediq and Truku despite their shared `trv` code.
- Exact-source, normalized, prefix, substring, scoped regex, and fuzzy form search.
- Translation/meaning search.
- Phonological-form and morpheme/gloss search where source tiers support them.
- Concordance with keyword-in-context, sorting, sampling, paging, and scope filters.
- Dictionary-style grouping without implying automatically grouped forms are curated entries.
- Expandable sentence, word, morpheme, form, phonology, translation, gloss, and audio tiers.
- Audio playback for resolvable public browser-compatible references.
- Stable record links and shareable, validated query URLs.
- A complete dataset builder with release, corpus, language, dialect, tier, field, and filter
  selection.
- Preview, schema, counts, rights, estimated size, progress, cancellation, and fallback.
- Prepared-download browsing by release, corpus, language, tier, and format.
- Scoped frequency, distribution, n-gram, collocation, and seeded-sampling summaries with
  accessible tables, documented limits, and exports.
- Complete format guide, data model, citation, rights, methodology, about, 404, offline,
  empty, loading, unsupported, and failure states.

## Required learner product

- An Amis-first learner landing page with honest per-language capability states.
- A learner dictionary that distinguishes source attestations, standardized forms, automatic
  groupings, reviewed content, and machine output.
- A phrase and example explorer with corpus, dialect, source, rights, and citation.
- IndexedDB study decks with tags, word/example/manual cards, and source-release locators.
- A documented local spaced-repetition scheduler with Again, Hard, Good, and Easy actions.
- Versioned JSON backup/restore plus safe Anki TSV and CSV exports.
- Local pronunciation recording, playback, replace, download, and delete.
- Optional ASR comparison that never presents an edit distance as a pronunciation score.
- A deterministic orthography assistant built only from reviewed public conversion tables.
- Public FormosanBank MT adapters for verified Amis and English/Mandarin directions.
- Public FormosanBank ASR adapters for every verified language endpoint.
- Reviewed, cited grammar or learning content only. Do not invent a course.
- An offline-capable shell and continued access to local study data.
- No accounts, cloud sync, analytics, ads, streak pressure, or server-side learner data.

## Required model and developer product

- A model catalogue covering registered public FormosanBank MT and ASR models and Spaces.
- Model direction, language, task, framework, license, provenance, training-lineage
  disclosure, limitations, metrics, artifact size, endpoint, and status.
- A versioned static API on Pages for metadata, releases, languages, corpora, rights, models,
  downloads, and search manifests.
- A read-only FastAPI service over a checksum-verified release SQLite snapshot.
- Health, readiness, metadata, language, corpus, text, sentence, dictionary, concordance,
  frequency, download, rights, model, OpenAPI, and documentation endpoints.
- Query length and page limits, opaque cursors, allowlisted sorting, prepared statements,
  structured errors, bounded work, restrictive CORS, and no arbitrary SQL.
- JavaScript/TypeScript, Python/CLI, and R clients with release pinning, timeouts, pagination,
  structured errors, and checksum verification.
- Copyable, tested `fetch`, `curl`, Python, and R examples.

## Required exports

- Browser exports: safe CSV/TSV, JSON/JSONL, Parquet, plain/interlinear text,
  audio-reference manifests, and reproducible recipes.
- Browser ZIP or XLSX only when measured size and memory behavior is safe.
- Prepared artifacts: byte-preserving XML, relational CSV/TSV, hierarchical JSONL,
  normalized Parquet, SQLite, human XLSX, plain/interlinear text, and audio manifests.
- Produce CLDF only for defensible mappings and EAF, TextGrid, VTT, or SRT only for
  compatible timed data.
- Include schemas, checksums, citations, rights, provenance, and package READMEs.
- Independently validate every claimed format. Explain incompatibility instead of inventing
  annotation or grammatical analysis.

## Required architecture

- Add a strict TypeScript static application under `site/`.
- Add a tested Python publication package under `publisher/`.
- Add a tested FastAPI service under `api/`.
- Add thin clients under `clients/`.
- Add reviewed learning content under `content/`.
- Add versioned contracts under `schemas/`.
- Keep generated output under ignored `build/` paths.
- Use static-safe routing that works at `/kakarayan/`, not only `/`.
- Use purpose-built, partitioned indexes for common dictionary and concordance queries.
- Use DuckDB-Wasm lazily for scoped filtering, joins, counts, sampling, and exports.
- Run expensive browser operations in Web Workers.
- Support cancellation and prevent stale asynchronous results from replacing current results.
- Do not require cross-origin isolation, multithreaded Wasm, or custom response headers.
- Serve interactive data from the Pages origin.
- Treat Releases as normal downloads, not as a browser database API.
- Resolve all generated locations through validated manifests. Never hard-code inventories.
- Generate deterministic identifiers, ordering, archives, schemas, and checksums.
- Use immutable content-hashed release paths, atomic Pages assembly, deployment checks, and
  documented rollback.
- Treat public model calls as optional browser-to-provider requests. Never embed a secret or
  add a required Kakarayan proxy.
- Download and verify the API SQLite asset before readiness and open it read-only.
- Keep the Space source in this repository and mirror it only through a guarded workflow.

## Rights, attribution, privacy, and security

- Never infer a uniform data license from public repository visibility.
- Model corpus, component, and media rights explicitly.
- Fail closed on ambiguous bulk redistribution.
- Display rights and citations on pages, in the builder, and inside packages.
- Preserve central, corpus, XML-root, media, noncommercial-AI, and TDM notices.
- Use a reviewed metadata/rights registry with evidence links; do not infer law from prose.
- Propagate machine-readable rights signals.
- Preserve attribution to Kakarayan's original researcher and FormosanBank contributors.
- Do not choose a code license without maintainer authority.
- Treat unresolved code-license approval as a deployment blocker, not an assumption.
- Collect no user data.
- Add no analytics, advertising, authentication, tracking, or application cookies.
- Send no corpus collection, study deck, generated index, or recording automatically to a
  hosted service.
- Permit only an explicit visitor-selected text or audio submission to the named registered
  public MT or ASR endpoint after third-party disclosure.
- Build no semantic index, RAG service, general-purpose AI tutor, or AI corpus annotation.
- Treat strings, URL state, archive paths, and spreadsheet exports as untrusted.
- Do not insert unsanitized HTML. Bundle executable assets locally.
- Use least-privilege, immutable workflow dependencies where practical.
- Never expose write tokens to pull-request code.
- Never execute upstream corpus/QC code in a job holding release or Pages write credentials.

## Quality gates

- Target WCAG 2.2 AA and complete keyboard operation.
- Support current and previous Chrome, Firefox, Safari, and Edge.
- Meet the plan's Pages, shard, initial-transfer, JavaScript, catalogue, release-asset,
  latency, and memory budgets.
- Warn or refuse before estimated browser memory exceeds 1 GiB.
- Measure all budgets against the full public corpus.
- Do not claim a check, format, or budget was verified unless it actually was.

## Required automation

- Preserve existing pytest, Ruff, formatting, and mypy checks.
- Add publisher unit, integration, full-schema, and deterministic-output tests.
- Add strict frontend type checks, lint, unit tests, and component tests.
- Add Playwright end-to-end tests at the real project subpath.
- Add automated accessibility checks and documented manual checks.
- Add schema, manifest, archive, checksum, route, and link validation.
- Add a fixture publication build to every PR.
- Add a full-data dry run before completion.
- Add a main-only Pages deployment workflow.
- Add an explicit data-publication workflow with source-ref and dry-run inputs.
- Add API fixture tests, shared client contract tests, and public model adapter tests.
- Add a guarded post-merge/manual-only Hugging Face Space deployment workflow.
- Do not automatically publish arbitrary upstream changes.

## Agentic execution loop

1. Read the complete plan, repository instructions, existing architecture, and tests.
2. Confirm the feature branch and pre-existing work.
3. Create or read `IMPLEMENTATION_STATUS.md` and run the current baseline.
4. Inspect the current public FormosanBank source, rights, inventory, and difficult XML.
5. Re-read the relevant phase and choose the smallest complete vertical slice.
6. Define acceptance checks, implement real behavior, and add focused tests.
7. Run narrow then broad checks and fix root causes.
8. Review the diff and remove accidental or generated clutter.
9. Commit and push the coherent slice.
10. Record checks, measurements, blockers, and the next slice in status.
11. Repeat immediately until every phase and definition-of-done item is satisfied.

After context compaction or a resumed session, re-read the goal, plan, status, branch state,
and recent commits; verify the last checkpoint and resume instead of restarting.

Do not stop after one passing test or rendered page, leave placeholders, defer integration,
or silently narrow scope. When blocked, gather evidence and continue independent work.
Escalate only decisions requiring maintainer authority. Record exact external actions.

## Final verification loop

- Build against the complete public FormosanBank corpus.
- Reconcile text, sentence, word, morpheme, token, translation, audio, and duration counts.
- Verify canonical XML byte preservation and stable provenance.
- Validate every applicable generated format.
- Run golden searches and compare exact occurrences, not only counts.
- Run all existing and new Python checks.
- Run all frontend lint, type, unit, component, and end-to-end checks.
- Run cross-browser, accessibility, keyboard, and responsive checks.
- Run the production build at `/kakarayan/`.
- Validate routes, links, manifests, schemas, archives, and checksums.
- Run dependency and license audits.
- Run the live API contract against its fixture and release snapshot.
- Run JavaScript, Python/CLI, and R shared client examples.
- Exercise MT/ASR success, cold-start, timeout, cancellation, malformed-response, and outage
  states without making model availability a core-site release gate.
- Exercise IndexedDB migration, backup/restore, scheduling, microphone denial, local
  recording deletion, and offline learner flows.
- Measure storage, transfer, latency, and memory budgets.
- Inspect the entire diff against `main`.
- Remove generated corpus output, secrets, private paths, debug files, and unrelated changes.
- Update README, architecture, format, rights, publication, and reproduction documentation.
- Confirm PR workflows cannot publish and deployment can run only from `main`.
- Confirm the Space workflow cannot run from pull requests or expose its write secret.

## Completion

- Commit and push all coherent work, then open one draft pull request against `main`.
- Include architecture, screenshots, full-data metrics, format matrix, rights behavior,
  measured budgets, learner privacy, API/model status, validation, reproduction commands,
  and post-merge deployment steps.
- Mark it ready only when complete and CI is green. Do not merge it or claim it is live
  before main-only deployment succeeds after maintainer merge.
- Report the branch, commits, PR URL, exact checks, measurements, and external actions.

If a no-cost Space cannot be created, finish every other deliverable, record the exact
maintainer action, and ship the static API fallback. If Kakarayan's software-license choice
has not been approved by Gabriel and FormosanBank, finish the code but mark public
deployment as governance-blocked.

The task is complete only when the single pull request is genuinely merge-ready and every
independently achievable definition-of-done item in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) is satisfied.
