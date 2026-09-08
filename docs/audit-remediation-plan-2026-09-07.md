# Kakarayan audit and proposed remediation

Audit date: September 7, 2026, America/Chicago; checks continued into September 8 UTC.
Audit status: completed. Implementation approved September 7, 2026 on
`fix/audit-remediation`, followed by review and merge. Production deployment is separate.

## 1. Recommendation

Keep the current product, design, and hosting architecture. Improve its correctness and
failure handling before adding services or replacing SQLite.

The most important findings are concrete:

1. Selecting the `unclear` dataset column silently excludes records where its value is false.
2. Language detail pages present whole-corpus counts as counts for the selected language.
3. Amis dialect summaries can exhaust the query deadline, although language-wide summaries
   are fast because they are precomputed.
4. Model results can become detached from the input/language context that produced them.
5. Malformed pagination and route input have uncaught-error paths.
6. Deployment replaces the database and manifest separately, not as one release generation.

These are reasons for focused remediation, not evidence that the entire backend is wrong.
Ordinary PR tests are already reasonably fast. Full data publication, especially build and
reconciliation, is where most release time goes.

### Preserve

- GitHub Pages for the frontend, Caddy/FastAPI on the existing Tokyo Lightsail instance,
  and a release-pinned, read-only SQLite database.
- Public FormosanBank XML as authority. Search normalization must not rewrite source data.
- The quiet white/black/neutral theme, woven band, system fonts, current navigation,
  compact cards, and full-width tool workspaces in [DESIGN.md](../DESIGN.md).
- Explicit Formosan corpus language, search text language, and displayed translation choices.
- Contains as the sentence-search default, exact as the dictionary default, and explicit
  match-mode overrides.
- Separate translation columns, XML S/W/M selection, finite exports, citations, rights,
  source identity, and immutable release assets.
- Local decks and explicit consent before sending text or audio to model services.
- Existing fast readiness, bounded concurrency, cancellation, and rate controls.

Do not add Kubernetes, Redis, an ORM rewrite, a second production query engine, a paid
monitoring platform, or a new authentication system as part of this work.

## 2. Audited baseline and limits

| Component | Verified baseline |
| --- | --- |
| Kakarayan commit | `e2bfb235d7694ba4007c8f821ee8b6477a4be862`, clean `main` |
| Public FormosanBank commit | `e00edf3d83ecfdce37392a73b3d2796446f44195` |
| Live release | `fb-20260903-e00edfe2bfb2` |
| Frontend | [GitHub Pages](https://formosanbank.github.io/kakarayan/) |
| API | `https://54-65-114-226.sslip.io` |
| Host | Gabriel's Tokyo Lightsail instance, 2 GiB RAM, 2 vCPUs, 60 GB plan |
| Friday data publication | [33835308380](https://github.com/FormosanBank/kakarayan/actions/runs/33835308380), successful |
| Friday Pages deployment | [33848731289](https://github.com/FormosanBank/kakarayan/actions/runs/33848731289), successful |

Friday's rollout is complete. Public and loopback readiness, Pages metadata, and release
identity agree. API/Caddy are running; the API container is healthy. The final host check
showed about 1.2 GiB available memory and 47 GiB free disk. These are snapshots, not a load test.

Evidence labels used below:

- **Reproduced:** observed in production or demonstrated locally against the current code.
- **Code finding:** a specific path is present, but its full user impact was not induced live.
- **Measure first:** plausible cost or bottleneck, not a proven production regression.

The audit covered every page family, shared components, API request/query/export paths,
publisher and serializers, schemas, workflows, deployment configuration, runbooks, and tests.
It did not inspect every corpus record or every combination of controls.

No private data was accessed or changed. No microphone recording, model upload, real MT/ASR
inference, destructive restore, or production load/concurrency test was performed. Mobile
checks used browser viewport emulation, not a physical phone in Taiwan. Source-language
correctness still requires linguistic review. This is not a penetration-test certification.

### Verification performed

| Check | Result |
| --- | --- |
| API and publisher tests | 88 passed |
| Ruff | Passed |
| Mypy, API and publisher | Passed, 57 files |
| Frontend unit tests | 48 passed across 15 files |
| Frontend ESLint and TypeScript | Passed |
| Frontend production build | Passed using existing local fixture metadata |
| Latest inspected scheduled CI | [34110687831](https://github.com/FormosanBank/kakarayan/actions/runs/34110687831), successful |
| Live phrase fragment | `where should` returned seven sentences, including the rice sentence |
| Live small dataset | Preview and two-row CSV agreed on IDs and split English/Chinese columns |
| Live audio evidence | A sentence exposed a 0–8.4 second clip; its source answered a 1,024-byte range with HTTP 206 |

The complete local browser/Axe matrix was not rerun during this audit. Its existing CI
result does not replace the new regression cases proposed below. A Python/Starlette
dependency deprecation warning appeared in tests; no test was disabled to accommodate it.

## 3. Page coverage

| Area | Inspected | Follow-up |
| --- | --- | --- |
| Home and shared shell | Navigation, locale, release display, startup dependency flow | F08, F13, F14 |
| Lookup, dictionary | Directions, target translation, scope, result/detail flow | F04, F05, F09, F12 |
| Lookup, sentences | Contains default, English/Chinese matches, highlights, audio detail | F05, F09, F12 |
| Learn | Lookup, deck, pronunciation, MT, orthography, notes and tab lifecycle | F06, F07, F09, F13, F15 |
| Research builder | Language/corpus selection, columns, split translations, loading, preview/export | F01, F10, F11 |
| Research summaries | Scope, frequency tabs, table behavior, real endpoint timing | F03, F13 |
| Explore and language details | Catalogue links and coverage labels/counts | F02, F09 |
| Corpus details | Source/rights display, dataset handoff, narrow-screen geometry | F02, F09, F13 |
| Downloads | Curated package inventory, titles, file size/checksum presentation | F11, F13, F21 |
| Developers | Code formatting, tabs, playground, contract and error paths | F04, F11, F12, F13, F21 |
| Docs/GitBook | Embedded content, locale behavior, external-opening path | F13, F15 |
| Models and About | Service status semantics, provenance, narrow-screen overflow | F13, F15, F21 |
| Cross-cutting | Routing, service worker, source/rights, privacy, recovery | F08, F14, F16–F21 |

This is not a request to add more explanatory text to these pages. Fix behavior first;
use short labels and place technical detail in the existing documentation.

## 4. Measured performance

### Live API sample

Each row contains two sequential requests from the audit workstation. Client time includes
network/TLS overhead. Server time comes from request timing or matched server logs.
These are **not p95 measurements**, controlled cold-cache tests, or Taiwan measurements.

| Request | Client time, first / second | Server time, first / second | Result |
| --- | --- | --- | --- |
| Amis dictionary, `mama`, exact, 5 results | 582 / 549 ms | 33 / 7 ms | 200 |
| English reverse dictionary, `mother`, contains, 5 results | 3,186 / 740 ms | 2,635 / 179 ms | 200 |
| English sentences, `where should`, contains | 542 / 533 ms | 4 / 4 ms | 200, seven results |
| Chinese sentences, `父親`, contains | 647 / 1,024 ms | 95 / 38 ms | 200 |
| Amis summary, no dialect | 537 / 538 ms | 2 / 2 ms | 200 |
| Amis summary, `Coastal` | 10,552 / 10,576 ms | 10,008 / 10,017 ms | 504, `query_timed_out` |

Interpretation: some indexed paths are already fast. The dialect aggregation is a confirmed
bad path. The first reverse-dictionary request needs profiling; these two samples alone
cannot distinguish page cache, query planning, connection state, and concurrent traffic.

### Build and CI sample

| Work | Observed duration | Implication |
| --- | --- | --- |
| Friday full data workflow | 1 h 54 m 44 s elapsed | Optimize publication stages, not every PR |
| Build and verify complete release step | 57 m 32 s | Add substage timing before changing algorithms |
| Reconciliation step | 42 m 29 s | Major measured target |
| Full-release API benchmark step | 1 m 50 s | Keep the performance gate |
| Friday Pages workflow | 8 m 31 s elapsed | Does not rebuild the corpus |
| Pages dependency-install step | 7 m 03 s | One npm-install outlier dominated this run |
| Pages build and verify step | About 5 s | Bundling itself was not the bottleneck |
| Latest scheduled Python job | About 62 s | Already short |
| Latest scheduled site/browser job | About 196 s | Preserve focused PR / broader scheduled split |

The local build produced a 367.65 kB main JS file, 112.60 kB gzip, plus 59.60 kB CSS,
11.41 kB gzip. The lazily loaded Gradio browser chunk was 44.68 kB, 14.58 kB gzip.
This does not justify changing frontend frameworks. The build used fixture metadata, so
these numbers are not a measurement of every byte transferred by a fresh production visit.

## 5. Findings and proposed fixes

P1 means correctness, data loss, reproducible unavailability, or release safety.
P2 means important usability, maintainability, or performance work. No immediate P0 outage
or demonstrated compromise was found.

### F01. Column selection can bias dataset membership

**P1 · Reproduced.** In [api/dataset_fields.py](../api/dataset_fields.py),
`dataset_completeness_clauses()` adds `unclear = 1` when the `unclear` column is selected.
[DatasetBuilder.tsx](../site/src/components/DatasetBuilder.tsx) always requests
`complete_fields=true`. A two-record fixture returned values 1 and 0 without that flag,
but only the value-1 row with it. Selecting a boolean column is not a request for true rows.

Proposed implementation:

- Treat false and zero as valid values. A separate explicit filter selects unclear records.
- Define optional-tier completeness per S/W/M owner. Decide presence versus nonempty text
  from documented semantics, not JavaScript truthiness or accidental SQL behavior.
- Keep projection and evidence requirements distinct in the query contract. Preserve the
  intended complete-tier workflow, but expose its effect through one clear control/label.
- Keep `translation_<xml_lang>_<occurrence>` columns. Requiring translations currently means
  some TRANSL evidence, not every language represented somewhere in the export.
- Determine and return the output schema for the finite export selection. Do not imply that
  columns observed in a 12-row preview are necessarily the complete export schema.

Acceptance: choosing `unclear` retains both values; an explicit unclear filter retains only
true values. Tests cover absent/empty tiers, duplicate TRANSL languages, false/zero, and each
XML level. Preview counts, recipe semantics, CSV/TSV/JSONL headers, and exported rows agree.

### F02. Language coverage reports the wrong scope

**P1 · Reproduced.** The Amis page reports 98,617 sentences overall, but lists 285,346 for
ePark under “Searchable sentences in this language.” That is the whole multilingual corpus.
[CatalogueDetail.tsx](../site/src/pages/CatalogueDetail.tsx) prints `corpus.counts.sentences`
inside the language detail view. NTU similarly displays its all-language 20,130 count.

Proposed implementation:

- Publish/query actual language-by-corpus counts and use them in language detail views.
- Keep all-corpus totals only where the label explicitly denotes all languages.
- Audit dataset-launch links so the selected language and corpus travel together.
- Avoid presenting one text's source description as definitive metadata for a heterogeneous
  corpus. Distinguish corpus-level evidence from individual text metadata.

Acceptance: scoped counts reconcile with the same release's SQL counts. No child count
exceeds its parent on an equivalent counting basis. Mixed-language fixtures catch the
current error; tests distinguish all sentences from form-bearing/searchable sentences.

### F03. Dialect summaries bypass the fast path

**P1 · Reproduced.** [api/store.py](../api/store.py), `summaries()`, uses `summary_cache` only
when no dialect is supplied. Dialect requests run multiple counts, distinct counts, and
frequency aggregations over the corpus. Amis/Coastal timed out twice at the ten-second limit.

Proposed implementation:

- Inspect query plans for each aggregation, recording rows visited and available indexes.
- Extend the existing summary materialization to actual language/corpus/dialect scopes,
  including language-plus-dialect across corpora. Do not materialize a Cartesian product.
- Store a consistent summary/count definition once. Retain an indexed bounded path for
  genuinely dynamic filters rather than issuing a series of full scans.
- Make scope part of every cache key and invalidate by release, not a short time guess.
- Do not raise the timeout merely to make this test pass.

Acceptance: the reproduced Coastal request succeeds within the proposed summary budget;
cached values equal direct SQL on fixtures and sampled production scopes. One analytical
request must not delay readiness or occupy both interactive query lanes.

### F04. Invalid cursors can become server errors

**P1 · Reproduced locally.** `decode_cursor("W10", ...)` decodes JSON `[]` and calls `.get()`
on the list. The resulting `AttributeError` also escapes through a fixture-backed API request.
See [api/cursors.py](../api/cursors.py). Cursor fingerprints do not include release identity.

Proposed implementation:

- Validate the decoded object's shape before accessing fields; reject unsupported versions,
  wrong types, nonfinite numbers, oversized payloads, and wrong query/release fingerprints.
- Keep typed, opaque keyset cursors. No arbitrary SQL or user-supplied sort expressions.
- Return the existing structured 400 error, not a traceback or an empty result set.

Acceptance: lists, null, scalars, malformed encoding, wrong position types, and cross-release
cursors return 400. Valid pagination has stable order with no duplicate or omitted rows.

### F05. Highlighting and snippets disagree with normalized search

**P2 · Reproduced locally; code finding for truncation.** The API normalizes Unicode and
whitespace. [queryMatching.ts](../site/src/queryMatching.ts) only trims/lowercases strings.
The exact query `He saw a\u00a0deer there.` produces no highlight in `He saw a deer there.`
even though the normalized API search can match. Fixed-length summary truncation can also
remove the part of a long translation containing the match.

Proposed implementation:

- Define matching/highlighting fixtures shared semantically across Python and TypeScript.
- Map normalized match offsets back to the untouched display string, or return bounded
  source offsets with API match evidence. Do not normalize the displayed corpus text.
- Produce a bounded context snippet around a match beyond the initial text cutoff.
- Preserve current contains/exact/prefix distinctions; exact does not mean phrase fragment.

Acceptance: NBSP, repeated whitespace, NFC/NFD, punctuation, casefold expansion, Chinese,
multiple matches, W/M evidence, and late-in-sentence matches highlight correctly. Returned
attestations retain exact source punctuation and identifiers; snippets never invent text.

### F06. Learner model results and drafts lack stable context

**P1 · Code finding.** In [ModelTools.tsx](../site/src/components/ModelTools.tsx), a request
captures input at submission, but saving its result reads the current text, direction,
language, and dialect. Those values can change while it runs or after it completes.
[Learn.tsx](../site/src/pages/Learn.tsx) conditionally unmounts tools when tabs change.
[Recorder.tsx](../site/src/components/Recorder.tsx) has no navigation blocker for unsaved audio.

Proposed implementation:

- Store a small immutable request context with each result. Save/copy provenance from that
  context, not the current form. Invalidate late completions after cancellation or scope change.
- Preserve text drafts while switching local Learn tools. For unsaved recordings, provide
  an explicit discard decision before unmounting; do not silently upload or persist audio.
- Cover local tabs as well as route navigation. Avoid keeping active microphones running
  merely to preserve component state.
- Bound recording duration/size during recording, not only when accepting an uploaded file.
  Select a supported MIME type and matching extension, including Safari's non-WebM paths.
- Release microphone tracks and object URLs after permission/start/encoding failures.

Acceptance: deferred fake model responses cannot be saved under another language or input.
Changing scope, tabbing away, cancelling, denying microphone access, and exceeding the
recording limit leave a predictable state. No external request occurs without fresh consent.

### F07. Local study import/export needs stronger integrity

**P1 · Reproduced export; code findings for restore/storage.** `cardsAsAnkiTsv()` in
[study.ts](../site/src/study.ts) replaces tabs but leaves embedded newlines unquoted.
A front containing `line1\nline2` becomes two physical unquoted records. `isCard()` accepts
only a partial shape and does not validate all stored scheduling/context fields.

Proposed implementation:

- Use valid quoted UTF-8 delimited output and proper metadata/header handling for Anki.
  Quote separators, CR/LF, and quotes instead of removing source text. Anki documents
  quoted multiline fields and explicit import headers in its
  [text import format](https://docs.ankiweb.net/importing/text-files.html).
- Validate backup schema, card structure, finite scheduling numbers, valid dates, and
  practical size limits before opening the write transaction.
- Make duplicate-ID merge behavior explicit and keep restore all-or-nothing.
- Catch IndexedDB/quota/clipboard failures at user actions, preserve drafts, and report
  whether a save actually completed. Do not claim success before transaction completion.

Acceptance: multiline Chinese/English cards and literal quotes round-trip through the
documented format. Invalid backups leave storage unchanged. Blocked/quota-exhausted storage
does not erase a draft or produce an unhandled promise rejection.

### F08. Startup and catalogue failures affect unrelated capabilities

**P1 · Code finding; intermittent browser failure observed.** [data.ts](../site/src/data.ts)
waits for several catalogues together and then readiness. Static metadata requests have no
explicit timeout. A missing model/content catalogue can therefore affect non-model tools.
The existing four-second readiness timeout and fifteen-second retry already exist.

Proposed implementation:

- Load release identity and essential navigation data first; load model, orthography, and
  notes catalogues with separate capability states and bounded request timeouts.
- Let local decks and static documentation remain usable when the query API is unavailable.
- Keep mismatched releases out of query results, but do not turn mismatch into a blank or
  unusable application shell. Show a short update/retry action for the affected capability.
- Preserve automatic readiness recovery; add backoff/jitter only where repeated retries
  would otherwise synchronize clients. Do not retry model submissions automatically.

Acceptance: independently fail each catalogue and readiness request. Only dependent tools
degrade; retries restore them without losing local work. Test cold offline load versus an
already cached visit separately. A successful empty catalogue is not a network failure.

Browser requests intermittently reported `Failed to fetch` during this audit and later
succeeded after retry/reload. Curl/API checks remained healthy. The precise browser failure
was not captured, so this is not evidence of a specific CORS, AWS, or service-worker defect.

### F09. Scope, URL, and failure states are not consistently round-trippable

**P2 · Reproduced and code findings.** The audio requirement was checked in Lookup while its
shareable URL omitted it. Learn/Research tab changes are local state, and unmounting the
builder discards its selection. Facet-fetch failures can replace translation choices with
empty options and silently reset the direction to Formosan.

Proposed implementation:

- Define one explicit scope value per tool: language, corpus, optional dialect, query
  language, displayed translation, match mode, required tiers, and XML level where relevant.
- Serialize supported public search state completely; parse it without unchecked casts.
- Keep builder selection across summary-tab visits, without firing hidden duplicate queries.
- Preserve request/result scope together. Never display an old result under a new context.
- Distinguish “no translation evidence” from “could not load available languages.” Keep the
  selected language on retry instead of silently changing what is searched.
- Round-trip back/forward and catalogue-to-tool links, not just the first page load.

Acceptance: copied URLs reproduce all advertised filters; back/forward restores valid scope;
missing facets show retry rather than false absence. Lookup and Learn use the same semantics.

### F10. Preview lifecycle still has avoidable work and ambiguous state

**P2 · Code findings, with a cancellation race to reproduce.** The builder already clears
stale previews, uses skeletons, debounces, serializes S/W/M requests, and blocks export during
preview work. Keep those fixes. However, its parameter callback depends on output format,
so a CSV/TSV change can trigger the same preview again. Cancelling before the debounce fires
can leave pending-state transitions to an already aborted request.

Proposed implementation:

- Separate row-selection parameters from export serialization options.
- Cancel both the scheduled debounce and active request; model idle/loading/ready/error/
  cancelled as explicit states keyed by selection, with one authority for stale-result checks.
- Keep current rows/counts unavailable until they belong to the active selection.
- Rename “Rows downloaded” to “Rows to export”; it is a projection before any download.
- Reuse only exact-release/exact-scope preview results. No broad client database cache.

Acceptance: format-only changes make zero preview requests. A fake-clock test covers cancel
before and after dispatch; rapid scope changes and out-of-order responses cannot strand the
skeleton. Finite row limits and matching counts remain distinct and accurate.

### F11. Export delivery and telemetry stop too early

**P1/P2 · Code findings; small live export passed.** A cross-origin download is launched with
an anchor. Browser-native downloads work on success, but an API error can become an unhelpful
JSON navigation rather than a recoverable tool error. Streaming responses are logged when
headers are returned, so status 200/zero response bytes does not prove a complete export.
The streaming iterator also schedules work through `asyncio.to_thread` per chunk/row.

Proposed implementation:

- Preserve native/streamed delivery for large files; do not buffer arbitrarily large exports
  into a browser Blob just to show a progress bar.
- Add a cheap shared preflight for scope, readiness, rights, and limits where it improves
  actionable errors. Revalidate server-side; preflight is not a reservation or permission grant.
- Keep the builder page intact on download failure and state “Download started,” not
  “Downloaded,” unless completion is actually observable.
- Measure the iterator overhead, then batch bounded output chunks in the existing stream
  path. Keep memory bounded and cancellation/deadlines active during serialization.
- Record final stream outcome, emitted rows/bytes, duration, cancellation, and late failure.
  Distinguish server stream completion from proof that a user's browser saved the file.

Acceptance: 429/503/504, disconnects, serializer failure, rights denial, and byte-limit stops
produce truthful outcomes. Large CSV/JSONL/ZIP tests show bounded memory, correct counts and
checksums, prompt cancellation, and valid structured output rather than silent truncation.

### F12. Optimize query families and tighten the public contract

**P2 · Code findings and measure-first work.** [api/store.py](../api/store.py) contains
per-result evidence/tier lookups in addition to batched paths. Record expansion can issue
queries for each word's morphemes. Reverse dictionary has a large first/second-request gap.
Public responses often use broad dictionaries rather than explicit response models.

Proposed implementation:

- Add query-count and plan evidence for dictionary, reverse dictionary, concordance, detail,
  preview, frequencies, and summaries before optimizing them.
- Batch remaining evidence/tier reads by the selected IDs, not the whole corpus. Avoid
  trading N+1 queries for a huge cross-product join.
- Test one/two-character Chinese, broad substrings, compound filters, and maximum pages.
- Bound total expanded detail size/work, not only each nested group independently. Preserve
  a discoverable path to the full published record when a display is truncated.
- Define typed responses for the main envelopes/errors and validate them at the frontend
  boundary. Use generated OpenAPI/types only if they replace duplicated declarations.
- Keep allowlisted fields, parameterized SQL, immutable connections, and query deadlines.

Acceptance: benchmark improvements preserve IDs, order, evidence, punctuation, and rights;
query count does not grow linearly with every returned child. Playground examples and
generated/documented response shapes agree with the running API.

### F13. Targeted responsive and keyboard repairs

**P2 · Reproduced geometry; code findings for keyboard semantics.** At 320 CSS pixels,
Research, Downloads, Docs, and Amis detail stayed within the page. ePark detail expanded to
696 pixels because of a long rights URL; Models reached 328 and About 334 from long tokens.
Several tablists lack complete keyboard/label relationships. Match radios lack a group name.

Proposed implementation:

- Fix `min-width` and wrapping at the offending link/identifier containers. Keep intentional
  horizontal scrolling inside data tables and code blocks, not on the whole page.
- Preserve widths, colors, type families, and layout. Review 10.5–11 px technical text against
  DESIGN.md's 12–14 px metadata target; small text alone is not a WCAG failure.
- Implement the same compact tab behavior across existing tablists: roving focus, arrow keys,
  selected state, and tab/panel labelling. Use manual activation for costly panels.
- Give each radio group a scoped name. Move focus meaningfully after route changes, not
  merely scroll the window. Preserve the skip link and visible focus.
- Check long Traditional Chinese labels, zoom, touch targets, errors, and reduced motion.

Acceptance: no page-level overflow at 320/375/768/1280 px; contained tables remain usable.
Keyboard-only users can reach and operate every tool. Follow the
[WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) and test keyboard
behavior directly; Axe alone does not prove it. Do not replace the neutral palette.

### F14. Route parsing and cache generation need failure tests

**P1/P2 · Reproduced route crash; code risks for caching.** A direct malformed percent path
is rejected by GitHub's edge. However, the legitimate Pages fallback mechanism can forward
it into `decodeURIComponent()` in [App.tsx](../site/src/App.tsx), leaving the root empty.
Reproduction: `?__kakarayan_route=%2Flanguages%2F%25ZZ` under `/kakarayan/`.

Proposed implementation:

- Make route parsing total and return a not-found state for invalid encoding/IDs.
- Add a small route error boundary with retry/home navigation and safe diagnostics.
- Test service-worker install/activation with an old open tab, interrupted metadata updates,
  mixed generations, unavailable API, and offline navigation.
- Keep one coherent shell/metadata generation, with explicit retention/cleanup rules.
  Await cache writes appropriately and avoid needless per-query copies of the same shell.
- Do not cache corpus queries, large exports, audio, or model requests in the service worker.

Acceptance: malformed paths never blank the application. A version transition cannot attach
old results to new metadata. Reload/offline behavior is predictable without unbounded caches
or permanent compatibility layers for obsolete API schemas.

### F15. Resource and model status should mean what they say

**P2 · UI/code findings.** The Models page reports zero available services while catalogue
entries are `unchecked`; that is not the same as confirmed unavailability. GitBook content
remains English when the surrounding interface changes to Traditional Chinese. Notes have
no reviewed entries, and the future `body_markdown` is currently rendered as plain text.

Proposed implementation:

- Separate supported capability, last checked status/date, unknown status, and live failure.
  Do not wake HF services on page load to manufacture an availability badge.
- Keep concise upload consent. Avoid claiming provider retention/opt-out behavior unless it
  has been checked for the actual service; client consent is not proof of upstream policy.
- Label English-only embedded material clearly. Link verified translated pages if they
  exist; do not imply that changing UI locale translated the source documentation.
- Retain the external GitBook link and provide bounded loading/failure recovery for embeds.
- Keep empty reviewed notes honest. Add safe Markdown rendering only when real reviewed
  content needs it. Orthography remains deterministic and explicit about unsupported scope.

Acceptance: unknown is not reported as down or licensed; neither model service is invoked
without action and consent. Both UI locales explain the available capability without filler.

### F16. Activate one release generation, not two independently replaced files

**P1 · Code finding, not an observed failed rollout.** [prepare_release.py](../api/prepare_release.py)
replaces the database, then writes/replaces the active manifest. Each rename is atomic;
the pair is not. Failure between them can leave a mismatched on-disk state. Advancing the
manifest also makes the old service unready before the new service is started.

Proposed implementation:

- Stage database and manifest together under a release-ID directory, with expected ownership.
- Validate checksums, schema, embedded database identity, and readiness before activation.
- Atomically select a complete generation. A running process resolves/pins that generation
  once so existing and newly opened connections cannot mix data and metadata.
- Lock concurrent activation. Retain the previous validated generation for a simple rollback.
- Preflight space for current database, candidate, compressed download, and safety margin;
  compare manifest sizes with configured download/expanded-size limits before starting.
- Build or pull the new image while the old service is still serving. Coordinate the API and
  Pages cutover explicitly; prebuild Pages, then keep the mismatch interval short and measured.

Acceptance: inject failures after download, expansion, validation, and immediately before
activation. The old generation remains usable. Rollback does not require redownloading
gigabytes. Test low disk, wrong ownership, concurrent activation, and restart failure offline
before a production exercise. Do not add an unbounded multi-release serving platform.

### F17. Workflow identity, gating, and retry behavior need tightening

**P1 · Code/configuration findings.** Pages can run from a push independently of CI success.
Its “latest compatible” release selection is weaker than an explicit API contract check.
`gh release create` does not pass the audited workflow commit as `--target`. A partially
uploaded draft prevents a straightforward retry. Live environments have branch policies,
but did not show the required reviewer described for data publication in the runbook.

Proposed implementation:

- Deploy only a successful, explicit main SHA and an approved immutable release ID.
- Pin release tags to that SHA. Check application/read-model compatibility as well as data
  release identity; matching a generic schema-version string is not enough.
- Prefer the ready API's approved release for frontend-only deployment, rather than guessing
  from the first page of releases. Paginate any inventory used for selection.
- Make draft upload resumable only when identity and every existing asset digest match.
  Upload missing expected assets; never overwrite an immutable published release.
- Align documented and actual approval policy with maintainers. Do not silently remove review.
- Reuse the CI-tested API image by commit/digest if practical; stop rebuilding an unversioned
  image independently on the host without recording exactly which bytes were deployed.

Acceptance: failed CI cannot deploy; main advancing during a long build cannot retarget a
release; partial draft uploads resume safely; wrong API/data/code combinations fail before
cutover. Any privileged workflow trigger must reject untrusted PR artifacts and code.

### F18. Shorten full publication without weakening evidence

**P2 · Measured stages; individual savings require profiling.** Build/verify and reconciliation
accounted for about 100 minutes. Verification paths repeatedly decompress/check the database
across build, benchmark activation, reconciliation, rights verification, and publication.
[reconcile.py](../publisher/reconcile.py) spends substantial time while some format comparisons
still rely on counts and limited row samples rather than complete field equivalence.

Proposed implementation:

- Record parse, index, serialize, compression, integrity, reconciliation, and transfer timing,
  peak memory, and byte counts in a non-release diagnostic report.
- Reuse verified stage outputs within the same trusted job using content digests and pinned
  tool/config/source inputs. At trust boundaries, verify transferred bytes and identity again.
- Perform expensive semantic checks once per relevant immutable artifact, not once per
  caller. Keep rights, schema, checksum, source, and performance gates intact.
- Replace weak first-row checks with stratified edge-case samples and/or canonical semantic
  digests that account for format-specific nulls, numbers, arrays, and translation columns.
- Measure full-file XML projection memory and nested compression overhead before changing
  them. Adopt streaming parsing or stored ZIP entries only where measured benefit is clear.
- Keep determinism re-builds for publisher/schema changes, not routine frontend changes.
- Diagnose the seven-minute npm install separately using a few runs, locked dependencies,
  and the existing cache. Do not add more caching layers from one outlier.

Acceptance: compare the same source with old/new pipelines; semantic checks and release
inventory agree, benchmark thresholds do not weaken, and failures still stop publication.
Publish per-stage before/after results. Resume must reject stale inputs, not silently reuse them.

### F19. Tests pass, but important behavior is outside their assertions

**P2 · Code finding.** [performance.spec.ts](../site/e2e/performance.spec.ts) is disabled unless
`KAKARAYAN_PERFORMANCE=1`; inspected workflows do not set it. Its simulated profile is not
actual Taiwan field data. The small fixtures and warm loopback benchmarks missed the dialect
summary and correctness cases above. Pages smoke tests run before deployment, not against
the final public deployment. Browser failure evidence is not consistently retained.

Proposed implementation:

- Add each reproduced failure as a regression before fixing it.
- Keep fast PR tests. Run the full cross-browser/locale matrix and scheduled performance
  profile explicitly, with clear expected skips and downloadable traces/reports.
- Separate server execution, queue wait, network, first-result rendering, and export completion
  measurements. A 300 ms SQL/loopback budget is not a 300 ms worldwide user experience promise.
- Add a small post-cutover check of the real Pages URL, public API, service worker, CORS,
  deep links, release identity, and one representative search/export.
- Use deterministic delayed/error model mocks in CI. Real provider latency is a separate,
  opt-in check and must not make routine PRs flaky or upload user material.

Acceptance: CI visibly executes the intended profile, stores failure artifacts, and catches
F01–F17 regressions without a complete production rebuild on every PR.

### F20. Operational visibility and recovery should match the small deployment

**P2 · Live configuration and code findings.** Readiness, limits, process isolation, and
memory/disk headroom are present. Automatic Lightsail snapshots were enabled, with successful
entries for September 2–8. No restore was exercised. SSH was open to all IPv4/IPv6 addresses;
the API port itself was loopback-only. Request logs cannot identify real people or prove
that a streaming download finished.

Proposed implementation:

- Report route template, status, release, duration, queue wait, rows/bytes, and final stream
  outcome without logging query text, translations, audio, or raw arbitrary URL paths.
- Maintain bounded log rotation/retention and a simple operator view of error rates, latency,
  disk, memory, restarts, and certificate expiry. Start with existing tools and logs.
- Test snapshot restoration and application-level rollback in a disposable environment.
- Review SSH source restrictions with maintainers, retaining a tested administrative path.
  Keep Uvicorn's proxy trust safe by preserving Caddy-only ingress.
- Do not increase worker count blindly: current rate/concurrency controls are process-local.
  Extra workers could multiply the promised limits and memory use.

Acceptance: operators can distinguish queueing, query execution, model delay, client disconnect,
and failed serialization. A documented recovery is demonstrated, not inferred from snapshots.
No claim is made that an IP address or request count equals a unique human.

### F21. Documentation and resource labels need one clear authority

**P2 · Documentation/UI findings.** Existing docs contain useful operational detail, but
schema-version and caching statements disagree in places. The final version statement in
data-format documentation conflicts with recipe version 2.0.0. Flat and hierarchical JSONL
downloads have effectively identical human titles. Some operational comments describe older
deployment behavior.

Proposed implementation:

- Keep README as entry point; architecture, search semantics, API, data formats, learning,
  rights/privacy, publication, and Lightsail runbooks each own one subject.
- Document source FORM preservation versus display trimming versus normalized search/count
  keys precisely. Do not promise byte-for-byte display if the projection trims outer whitespace.
- Align API/cache/recipe/read-model versions and limits with tested configuration. Include
  one concrete multilingual query and split-column export example, not an API tutorial.
- Give flat and hierarchical JSONL distinct short titles; retain the curated package count.
- Separate source commit, publisher commit, frontend commit, data release, and API image
  identity in operator diagnostics. They are related, not interchangeable.
- Update existing files rather than adding parallel setup guides or permanent audit logs.

Acceptance: examples execute, links resolve, limits and schemas match code, and a new maintainer
can perform an update or rollback from the two existing runbooks without this audit document.

## 6. Architecture and code-quality boundaries

The target remains three responsibilities:

```text
Public XML -> publisher -> immutable release
                              |
                              +-> local read-only API database -> query/export API
                              +-> small catalogues -> GitHub Pages frontend
```

Make changes inside those boundaries:

- **API:** keep request validation/control separate from SQL and serialization. Extract
  dictionary/concordance, dataset, and summary query families from `store.py` only where the
  tests support a clear boundary. Share scope and connection handling, not a generic ORM.
- **Publisher:** make parse/projection, index/materialization, serialization, and verification
  stages explicit. Existing modules are the starting point; avoid one wrapper file per step.
- **Frontend:** give search/preview/model operations explicit context and lifecycle state.
  Reuse the existing client, controls, and styles. Do not introduce a global state framework
  just to retain one builder draft or standardize three status strings.
- **Contracts:** make a small number of public response/recipe types authoritative. Remove
  redundant declarations and unchecked boundary casts when adding validation, rather than
  layering validation around another copy of the same model.
- **Refactoring:** characterize behavior first, move one responsibility at a time, and remove
  dead paths in the same change. Large line counts alone are not a reason to rewrite a module.

No SQLite-to-DuckDB/Postgres migration is proposed. Revisit database choice only after scoped
summary materialization, batching, and measured query plans fail an agreed workload budget.

## 7. Proposed implementation sequence

These are reviewable batches after approval, not work completed by this audit. Estimates are
engineering time for one experienced contributor, excluding maintainer review and release
queue time. They are ranges, not commitments.

| Batch | Scope | Evidence required before merge | Approximate effort |
| --- | --- | --- | --- |
| 1. Correctness | F01, F02, F04, F05 and malformed-route portion of F14 | Red/green fixture tests, scoped counts, Unicode/phrase cases | 2–4 days |
| 2. Learner safety | F06, F07 | Deferred-model races, local storage/import/export, recording lifecycle | 2–3 days |
| 3. Slow query paths | F03 and measured F12 work | Query plans/counts, full-release before/after timing and semantic equivalence | 2–4 days |
| 4. Tool state and delivery | F08–F11 | Failure injection, URL/state round-trips, cancellation and large-stream tests | 3–5 days |
| 5. UI/resource consistency | F13, F15, remaining F14 | Both locales, keyboard, narrow-screen and update/offline matrix | 1–3 days |
| 6. Release safety | F16, F17 | Disposable activation/rollback tests, pinned identity, CI gate tests | 2–4 days |
| 7. Pipeline efficiency | F18, F19 | Stage timings, equal-output reconciliation, retained CI artifacts | 2–4 days |
| 8. Operations/docs | F20, F21 | Recovery evidence, exact documented settings, executable examples | 1–2 days |

Dependencies and release handling:

1. Land regression characterization before the corresponding behavior change. Keep fixes
   and tests together; do not merge a suite that knowingly accepts the bug.
2. Prioritize batches 1–3. Release safety in batch 6 must precede the first newly built data
   release that uses changed summary/count materialization.
3. API-only fixes can use the current immutable database if their declared schema is unchanged.
   Frontend-only changes can deploy against the same ready release after compatibility checks.
4. Publisher/index/metadata changes require a new release. Never patch the live SQLite file
   or overwrite current release assets to avoid a rebuild.
5. Update the relevant existing docs within each batch; batch 8 is the final consistency pass.
6. Avoid merging unrelated performance and architecture rewrites together. One regression
   should be attributable to one small change, not a large speculative branch.
7. Keep this document as a dated proposal. Do not turn every implementation detail into
   another permanent documentation file.

## 8. Performance budgets to validate

These are proposed acceptance targets, not measured guarantees. Baseline on the same pinned
release and known hardware before using them as merge gates.

| Layer | Proposed target and method |
| --- | --- |
| Readiness | Loopback p95 below 50 ms while one analytical request runs; no corpus-query slot dependency |
| Common dictionary/concordance | Preserve the current 300 ms warm loopback p95 gate and separately record first-request behavior |
| Short Chinese contains | Keep its separately stated budget; test one- and two-character cases, not just Latin queries |
| Precomputed summaries | p95 below 300 ms for real language/corpus/dialect scopes; zero deadline failures in the regression set |
| Preview | Common scoped first preview below 1 s server time; slow/adversarial scopes end predictably within their deadline |
| Export | Record time to first byte, rows/s, final duration, peak RSS and cancellation latency at several sizes; choose thresholds from baseline |
| Browser | Proposed first common lookup within 2 s after submit on the agreed constrained profile; track cold shell separately |
| Publication | First target: at least 25% reduction on the same complete release, with no removed correctness or rights checks |
| Routine CI | Keep normal PR feedback under roughly 5 minutes where runner queues permit; do not move full publication into PR CI |

Use at least 30 timed samples for a meaningful development p95, report warm/cold assumptions,
and repeat on more than one run. Do not flush OS caches or stress production to manufacture
a cold test; use a disposable equivalent environment. Test a small mix of simultaneous users
there, including one export, one lookup, and a reload.

For page experience, use LCP ≤2.5 s, INP ≤200 ms, and CLS ≤0.1 at the 75th percentile,
segmented by device, as the reference targets from [Web Vitals](https://web.dev/articles/vitals).
Lab emulation catches regressions but does not establish field performance. Ask Gabriel to
run the same short journeys on an ordinary phone and local mobile connection before claiming
Taiwan performance is solved. Add real-user telemetry only with an explicit privacy decision.

## 9. Regression and completion checklist

### Search and scientific data

- Dictionary and sentence defaults, both directions, both displayed translation choices.
- Full translated sentence, phrase fragment, punctuation/NBSP and Chinese examples.
- S/W/M evidence, original/standard/alternate forms, absent/empty tiers and unclear false.
- Every supported filter survives URL sharing and history navigation.
- Stable pagination, wrong cursors, unknown IDs and cross-release requests.
- Scoped catalogue counts reconcile with source/read-model counts using the same definition.
- Split translation columns preserve duplicate language occurrences and source order.
- Multi-level exports state whether they are independent selections, not a guaranteed
  parent-closed joined dataset. Parent IDs remain available for joining.
- CSV/TSV/JSONL/ZIP escaping, nulls, Unicode, spreadsheet safety, rights, row/byte limits,
  and preview/export agreement are checked by parsers, not screenshots alone.

### Learners and interface

- No stale request can relabel or save output under a different input/language/dialect.
- Drafts survive harmless tab changes; discarding recordings is explicit.
- No microphone/HF call occurs without the required user action and consent.
- Tests cover permission denial, unavailable storage, invalid backup, model timeout/cancel,
  unsupported recording MIME, and loss of connectivity.
- Audio starts/stops at attested bounds, including nonzero starts and shared long recordings;
  unavailable ranges or unaligned audio never masquerade as a sentence-specific clip.
- Both locales, 320/375/768/1280 px, zoom, keyboard, focus, loading/error/empty states pass.
- Existing monochrome theme, woven band, muted syntax formatting, and compact copy remain.
- GitBook outage, blocked embedding, and English-only source content are handled truthfully.

### Release and operations

- CI, image, manifest, database, API, and Pages identities are recorded and compatible.
- No source/rights/content change is inferred from a UI or optimization request.
- Partial activation and partial upload recovery are tested before relying on them.
- Previous generation rollback and snapshot restore have actual evidence.
- Public post-deployment smoke passes, including deep links, service-worker refresh,
  real queries, a small export, audio range availability, and host health.
- Performance reports separate server, queue, network, rendering, and stream completion.
- Logs exclude search text, model inputs, recordings, and other user material.

## 10. Audit handoff

This document records findings and a proposed implementation order only. The green baseline
tests do not invalidate the reproduced gaps, and the proposed improvements are not already
implemented. No new service, deployment, data rebuild, or design change is required to review
this plan. Obtain approval for the remediation scope, then work in scoped branches and retain
evidence for each acceptance test.

## Implementation evidence

Implementation is in progress. The findings above remain the acceptance criteria; a passing
baseline is not completion. Scoped commits and tests will be recorded here before merge.
