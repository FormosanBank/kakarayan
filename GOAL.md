# Goal: Ship the Complete Backend-Free Kakarayan Research Workbench

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

- Deliver a polished static research interface for public `FormosanBank/FormosanBank` data.
- Run the production application entirely on GitHub Pages.
- Require no production Django server, API, PostgreSQL service, or paid hosting.
- Use GitHub Actions for offline data preparation.
- Use Pages for application assets and interactive query shards.
- Use GitHub Releases for large prepared downloads.
- Perform search, filtering, preview, and modest custom exports in the browser.
- Support English and Traditional Chinese at full feature parity.
- Serve linguists without requiring a terminal, GitHub account, or corpus-engineering skills.

## Branch and pull request contract

- Never commit to `main`.
- Check the current branch and worktree before editing.
- Continue on `agent/static-research-workbench` unless explicitly instructed otherwise.
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

## Source-of-truth contract

- Read only the public `FormosanBank/FormosanBank` repository.
- Never access or publish private corpus repositories.
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

## Required exports

Browser-generated exports for safe selections:

- CSV and TSV, including raw and spreadsheet-safe modes.
- JSON and JSON Lines.
- Parquet.
- Plain and interlinear text.
- Audio-reference manifests.
- Reproducible export recipes.
- ZIP or XLSX only if measured browser behavior is safe.

Prepared release artifacts:

- Byte-preserving canonical XML packages.
- Relational CSV and TSV packages.
- Hierarchical JSON Lines packages.
- Normalized Parquet packages.
- Portable SQLite packages.
- Human-oriented XLSX packages.
- Valid CLDF where mappings are linguistically defensible.
- ELAN EAF, Praat TextGrid, WebVTT, and SRT only for compatible timed data.
- Plain text, interlinear text, and audio manifests.
- Schemas, checksums, citations, rights, provenance, and package README files.

Validate every claimed format with an independent parser or official validator.

Explain incompatibility instead of fabricating missing annotation.

Do not invent POS, dependencies, lexical analysis, or grammatical structure.

## Required architecture

- Add a strict TypeScript static application under `site/`.
- Add a tested Python publication package under `publisher/`.
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
- Resolve data locations through validated manifests.
- Never hard-code current inventory counts or generated filenames.
- Generate deterministic identifiers, ordering, archives, schemas, and checksums.
- Use content-hashed, release-scoped interactive paths and never reuse a URL for new bytes.
- Keep historical releases downloadable without promising historical interactive querying.
- Publish immutable data releases before atomically deploying their Pages bundle.
- Verify deployed Wasm, Workers, manifests, byte ranges, search, and downloads.
- Document rollback to the previous application/data pair.

## Rights, attribution, privacy, and security

- Never infer a uniform data license from public repository visibility.
- Model corpus, component, and media rights explicitly.
- Fail closed on ambiguous bulk redistribution.
- Display rights and citations on pages, in the builder, and inside packages.
- Preserve central, corpus, XML-root, media, noncommercial-AI, and TDM notices.
- Use a reviewed metadata/rights registry with evidence links; do not infer law from prose.
- Propagate machine-readable rights signals and document GitHub Pages root-path limitations.
- Preserve attribution to Kakarayan's original researcher and FormosanBank contributors.
- Do not choose a code license without maintainer authority.
- Treat unresolved code-license approval as a deployment blocker, not an assumption.
- Collect no user data.
- Add no analytics, advertising, authentication, tracking, or application cookies.
- Send no corpus data to hosted AI/translation/search services and build no semantic index.
- Treat corpus strings and URL state as untrusted.
- Do not insert unsanitized HTML.
- Sanitize archive paths and spreadsheet-oriented exports.
- Bundle executable assets locally.
- Use least-privilege, immutable workflow dependencies where practical.
- Never expose write tokens to pull-request code.
- Never execute upstream corpus/QC code in a job holding release or Pages write credentials.

## Quality gates

- Target WCAG 2.2 AA and complete keyboard operation.
- Support current and previous Chrome, Firefox, Safari, and Edge.
- Keep the Pages artifact below 900 MiB.
- Keep each interactive shard below 50 MiB compressed; target 25 MiB.
- Keep initial-route transfer below 2 MiB.
- Keep application JavaScript below 500 KiB compressed before lazy Wasm.
- Keep the catalogue below 1 MiB compressed.
- Return typical cold scoped exact results within 5 seconds.
- Return typical warm scoped exact results within 2 seconds.
- Keep typical query memory below 500 MiB.
- Warn or refuse before estimated browser memory exceeds 1 GiB.
- Keep each release asset below 1.9 GiB.
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
- Do not automatically publish arbitrary upstream changes.

## Agentic execution loop

1. Read [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) completely.
2. Read repository instructions, README, architecture, ingestion, models, views, templates,
   styles, translations, and tests.
3. Confirm the feature branch and cleanly identify pre-existing work.
4. Create/read `IMPLEMENTATION_STATUS.md` as the durable recovery record.
5. Run and record the existing baseline checks.
6. Inspect the current public FormosanBank repository and recalculate its inventory.
7. Study difficult XML examples before finalizing contracts.
8. Re-read the relevant plan phase.
9. Select the smallest coherent vertical slice that advances the real product.
10. Define concrete acceptance checks for that slice.
11. Implement production behavior, not placeholders.
12. Add or update focused tests.
13. Run the narrowest relevant checks.
14. Fix root causes instead of weakening validation.
15. Run broader impacted checks.
16. Inspect the slice diff and remove debug or accidental output.
17. Commit the coherent slice on the feature branch.
18. Update status with commit, passed checks, measurements, blockers, and next slice.
19. Move immediately to the next incomplete slice.
20. Repeat until every phase and definition-of-done item is satisfied.

Do not defer all integration and validation until the end.

After context compaction or a resumed session, re-read the goal, plan, status, branch state,
and recent commits; verify the last checkpoint and resume instead of restarting.

Do not stop because one test passes, one language works, or the interface renders.

Do not leave unresolved TODOs, mock data, fake buttons, dead code, or disabled primary flows.

Do not silently narrow corpus, format, accessibility, or browser scope.

When blocked, gather evidence, try safe in-scope alternatives, and continue independent work.

Escalate only decisions requiring maintainer authority, such as licensing, rights, or a
materially different architecture.

An external blocker does not justify stopping unrelated implementation or marking the goal
complete; finish everything independently possible and record the exact required action.

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
- Measure storage, transfer, latency, and memory budgets.
- Inspect the entire diff against `main`.
- Remove generated corpus output, secrets, private paths, debug files, and unrelated changes.
- Update README, architecture, format, rights, publication, and reproduction documentation.
- Confirm PR workflows cannot publish and deployment can run only from `main`.

## Completion

- Commit all remaining coherent work to the feature branch.
- Push that one branch.
- Open one draft pull request against `main`.
- Include architecture, screenshots, full-data metrics, format matrix, rights behavior,
  measured budgets, validation, reproduction commands, and post-merge deployment steps.
- Mark it ready only when the implementation is complete and CI is green.
- Do not merge it.
- Do not claim the site is live before main-only deployment succeeds after maintainer merge.
- Report the branch, commits, PR URL, exact checks, measurements, and external actions.

The task is complete only when the single pull request is genuinely merge-ready and every
definition-of-done item in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) is satisfied.
