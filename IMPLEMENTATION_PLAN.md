# Kakarayan Static Research Workbench: End-to-End Implementation Plan

## 1. Purpose of this document

This document is the complete implementation plan for turning Kakarayan into a public,
backend-free web interface for the public `FormosanBank/FormosanBank` repository.

The implementing engineer should assume no prior knowledge of Kakarayan, FormosanBank,
the corpus XML, or the earlier product discussion.

Read this document completely before changing code.

The companion execution contract is [`GOAL.md`](GOAL.md).

The intended result is one large, reviewable pull request from a dedicated feature branch.
No implementation commit may be made directly to `main`.

## 2. Executive outcome

Build a polished static research application that:

- Runs entirely on GitHub Pages.
- Requires no Django server, API server, PostgreSQL service, or paid hosting.
- Uses only the public `FormosanBank/FormosanBank` repository as its corpus source.
- Uses GitHub Actions as the offline publication pipeline.
- Uses GitHub Pages for the application and interactive query shards.
- Uses GitHub Releases for large, prepared download artifacts.
- Performs search, filtering, previews, and modest custom exports in the visitor's browser.
- Supports linguists with rich corpus metadata, concordance, dictionary, tier selection,
  reproducibility, citations, rights information, and specialist download formats.
- Preserves the existing Kakarayan visual identity and bilingual English/Traditional
  Chinese interface.
- Treats FormosanBank XML as canonical and every generated artifact as derived.

The public site must be useful without a terminal, GitHub account, or technical corpus
knowledge.

## 3. Non-negotiable constraints

### 3.1 Hosting and cost

- There must be no production backend.
- There must be no production database.
- There must be no paid infrastructure requirement.
- The normal deployment target is the Kakarayan repository's GitHub Pages project site.
- A custom domain may be supported, but it must remain optional.
- Standard public-repository GitHub Actions runners are the only assumed build compute.
- The design must not depend on a free-tier application or database service that may sleep,
  expire, require a credit card, or change pricing.

### 3.2 Repository and pull request discipline

- Work only on the dedicated feature branch.
- Never commit implementation work directly to `main`.
- Commit coherent slices to the feature branch as work progresses.
- Keep all static-workbench implementation in this repository.
- Submit the complete implementation as one pull request against `main`.
- Do not split the feature across multiple implementation PRs.
- Do not merge the PR.
- Do not deploy branch code over any existing production Pages site.
- A pull request build must produce an inspectable artifact without publishing it.
- Production Pages deployment must occur only from `main` after review and merge.

### 3.3 Source-data boundary

- Read only the public `FormosanBank/FormosanBank` repository.
- Never read, infer, package, or publish private development repositories.
- Never make Kakarayan's Django/PostgreSQL read-model the canonical export source.
- Produce artifacts directly from a pinned FormosanBank commit.
- Preserve original XML files byte-for-byte in canonical XML download packages.
- Preserve source paths, element identifiers, order, repeated tiers, attributes, and inline
  markup in provenance even when relational views simplify them.
- Never silently repair canonical source data during publication.
- Validation failures must stop publication or explicitly quarantine affected records.
- Resolve the requested public ref from the remote and record the immutable commit; do not
  assume an existing local checkout is current.
- Read the checked-out tree at that commit, not deleted files from Git history.
- Use an explicit input allowlist for canonical XML, reviewed metadata, public documentation,
  schemas, and required QC code. Never package logs, caches, environments, coverage output,
  local configuration, or unrelated `CodeAndDocs` contents accidentally.
- Do not execute corpus audio-download scripts or pull Git LFS/Hugging Face media as part of
  ordinary site publication. Media acquisition requires an explicit rights-compatible
  release mode.

### 3.4 Existing Kakarayan work

- Preserve the existing Django application during this pull request.
- Do not delete, rewrite, or move the Django implementation merely to make the static site
  look cleaner.
- Reuse its search semantics, normalization rules, interface language, tests, CSS tokens,
  components, and visual assets where correct.
- The static site becomes the public deployment target.
- The Django application may remain a local reference and comparison implementation.
- Any later removal of Django is a separate maintainer decision after the static site has
  operated successfully.

### 3.5 Product completeness

- Do not stop at a scaffold, mockup, demo, or one-language proof of concept.
- Do not leave placeholder pages, unresolved TODOs, disabled primary navigation, fake
  download buttons, or sample-only data paths.
- All public FormosanBank corpora that pass publication validation must be represented.
- Empty, missing, malformed, unsupported, loading, offline, and failure states must be real.
- All claimed formats must be generated and validated.
- Features that cannot be supported honestly from the source data must be omitted or shown
  with a precise reason, never simulated.

## 4. Current repository orientation

At the start of planning, Kakarayan is a Django 5.1 application using Python 3.13,
PostgreSQL, HTMX, and Django gettext catalogs.

Important existing paths:

```text
config/                         Django settings and URL configuration
corpus/models.py                Derived corpus read-model
corpus/ingestion/               XML discovery, parsing, normalization, loading
corpus/views/dictionary.py      Dictionary and concordance behavior
corpus/templates/corpus/        Existing bilingual server-rendered interface
corpus/static/corpus/css/       Kakarayan design tokens and components
corpus/static/corpus/assets/    Weave patterns and visual assets
corpus/tests/                   Search, normalization, view, and i18n tests
locale/                         English and Traditional Chinese gettext catalogs
README.md                       Current setup and architecture documentation
CLAUDE.md                       Current repository engineering guidance
```

The existing database is explicitly a rebuildable read-model. It is useful as a behavioral
reference but is not lossless enough to serve as an archival export representation.

Important existing invariants:

- Containment is `Corpus -> Text -> Sentence -> Word -> Morpheme`.
- Translations and audio may occur at more than one linguistic tier.
- Formosan surfaces must retain contrastive characters and diacritics.
- Normalization uses NFC, case folding, and conservative punctuation handling.
- `trv` is shared by Seediq and Truku; ISO code alone cannot identify a display language.
- XML element identifiers can collide across files.
- A stable record locator therefore includes corpus, source path, local ID, and ordinal.
- FormosanBank's XML and QC rules remain authoritative.

Additional source-schema facts that must survive the static projection:

- `TEXT` can carry `citation`, `BibTeX_citation`, `copyright`, `source`, `audio`,
  `glottocode`, and `dialect` attributes in addition to `id` and `xml:lang`.
- `W` and `M` can carry `class` and `sclass`.
- `FORM` can carry `kindOf` and notes.
- `TRANSL` can carry `xml:lang`, `kindOf`, version, and notes.
- `AUDIO` can carry file/URL references and start/end values.
- FORM, PHON, TRANSL, AUDIO, W, and M sibling order is not guaranteed by the schema.
- `kindOf="original"` preserves source orthographic choices; `kindOf="standard"` is
  FormosanBank's comparable standard-orthography projection. The UI and every export must
  label them accurately and must not imply the standard form is the source transcription.
- Canonical token counts use the standard sentence FORM with original fallback and count
  whitespace chunks containing at least one Unicode letter or digit. Reuse the current
  public QC rule rather than creating a competing definition.

The implementation must inspect the current repository rather than assuming the snapshot
described here has not changed.

## 5. Initial data baseline

An earlier read-only inventory of the public repository found approximately:

- 22 canonical corpora.
- 14,599 XML files.
- 604.7 MiB of canonical XML.
- 487,318 sentence elements.
- 8,219,136 sentence-tier tokens.
- 317,367 word elements.
- 261,823 morpheme elements.
- 529,586 audio references.
- 666.1 transcribed audio hours.
- 44.6 additional untranscribed audio hours.
- 16 ISO 639-3 codes and 17 display-language identities.

These figures are planning baselines, not hard-coded product claims.

The publisher must recalculate statistics from the pinned source commit and emit them in
the release manifest. Tests must not depend on the exact values above.

## 6. Target repository structure

Add the following structure without moving the existing Django paths:

```text
kakarayan/
  site/
    src/
      app/
      pages/
      components/
      search/
      export/
      data/
      i18n/
      styles/
      workers/
      test/
    public/
    index.html
    package.json
    package-lock.json
    tsconfig.json
    vite.config.ts
  publisher/
    __init__.py
    cli.py
    config.py
    metadata/
      README.md
      corpora.toml
      languages.toml
    discovery.py
    xml_records.py
    identifiers.py
    catalog.py
    statistics.py
    tables.py
    indexes.py
    packages.py
    formats/
      __init__.py
      delimited.py
      jsonl.py
      parquet.py
      sqlite.py
      xlsx.py
      cldf.py
      elan.py
      textgrid.py
      subtitles.py
      plaintext.py
    rights.py
    provenance.py
    checksums.py
    validation.py
    tests/
  schemas/
    catalog.schema.json
    release-manifest.schema.json
    table-manifest.schema.json
    search-manifest.schema.json
    export-recipe.schema.json
  tests/
    fixtures/
      formosanbank/
  docs/
    data-model.md
    formats.md
    publication.md
    rights-and-citation.md
    architecture-decisions.md
  .github/
    workflows/
      ci.yml
      deploy-pages.yml
      publish-data.yml
  build/                         generated and gitignored
    pages/
    releases/
  IMPLEMENTATION_STATUS.md       durable progress/recovery record during implementation
```

Keep the structure coherent rather than mechanically creating every file in advance.
Create a file only when it has a real responsibility and tests or consumers.

`build/` and all generated corpus artifacts must be ignored by Git.

Small test fixtures may be committed. Full derived datasets may not be committed to the
main source branch.

`publisher/metadata/` is a reviewed presentation and rights overlay, not an alternative
corpus source. Every entry must cite the public FormosanBank path or external authority it
summarizes. Discovery must fail when a new corpus lacks an explicit reviewed entry rather
than inventing descriptions, translations, or distribution permissions.

`IMPLEMENTATION_STATUS.md` must remain concise and factual. It records completed phases,
the last verified commit, exact checks and full-build measurements, open external blockers,
and the next concrete slice. It is not a transcript or scratchpad.

## 7. Technology decisions

### 7.1 Browser application

Use:

- TypeScript with strict type checking.
- Vite for local development and production builds.
- React for component and state organization.
- React Router's hash-based routing so direct links work on a Pages project site.
- DuckDB-Wasm, loaded lazily in a Web Worker, for relational filtering and export work.
- Purpose-built static indexes for fast concordance and dictionary lookup.
- Native browser APIs where they are reliable.
- Vitest for unit tests.
- Testing Library for component behavior.
- Playwright for end-to-end and cross-browser tests.

Do not add a large state-management framework unless concrete application complexity
requires it.

Do not use server-side rendering.

Do not assume control over HTTP response headers.

GitHub Pages project-site deployment must work at `/kakarayan/`, not only at `/`.

Use a configurable Vite base path and test the built application under the real subpath.

Use hash routing or prebuilt static routes so direct navigation does not produce Pages 404s.

### 7.2 Offline publisher

Use Python 3.13 and the repository's existing `uv` workflow.

Prefer:

- `lxml` for streaming XML parsing.
- `pyarrow` for Parquet generation and schema validation.
- Python's standard `csv`, `json`, `sqlite3`, `zipfile`, `hashlib`, and `pathlib`.
- A maintained XLSX writer already acceptable to the repository.
- Official CLDF tooling where it validates the output.
- Deterministic serialization and archive creation.

Add production dependencies deliberately and pin them through `uv.lock`.

The publisher must expose one documented CLI entry point rather than requiring a sequence
of internal scripts.

Example target interface:

```bash
uv run python -m publisher build \
  --formosanbank-repo /path/to/FormosanBank \
  --formosanbank-ref abc123 \
  --pages-output build/pages/data \
  --release-output build/releases
```

Also support validation-only and format-specific development commands.

Build reproducibility must include environment-sensitive details:

- Accept an explicit `SOURCE_DATE_EPOCH`; default it deterministically from the pinned source
  commit rather than wall-clock time.
- Run serialization in UTC with a fixed locale.
- Sort input paths and rows by documented keys.
- Use LF line endings for generated text.
- Fix archive entry timestamps, permissions, owners, and ordering.
- Separate the human publication timestamp from the deterministic content build timestamp.
- Record Python, Node, publisher, application, schema, and important library versions.
- Demonstrate that two clean builds from identical commits and inputs produce identical
  checksums.

The publisher CLI must also consume a browser-generated export recipe for selections too
large to execute safely in the browser. The documented local command must work against
either a public release bundle or a local public FormosanBank checkout and must produce the
same logical selection and provenance as the browser builder.

### 7.3 Cross-origin and browser constraints

Interactive query files must be served from the Pages origin.

Do not depend on fetching GitHub Release assets through DuckDB-Wasm. Release assets are
for ordinary browser downloads, and their cross-origin behavior is not a stable query API.

GitHub Pages does not provide arbitrary response-header configuration.

Do not require cross-origin isolation, `SharedArrayBuffer`, or multithreaded DuckDB-Wasm.

Use a single-thread-compatible DuckDB-Wasm bundle and keep expensive work in a Web Worker.

Audio playback may use remote public URLs where browsers permit it.

Client-side audio bundling may only be offered when the source allows cross-origin fetches
and the estimated selection is small.

## 8. Canonical data model and contracts

### 8.1 General principles

The canonical XML remains the archival representation.

The static data model is an explicitly versioned projection optimized for:

- Discovery.
- Concordance.
- Dictionary browsing.
- Interlinear display.
- Relational analysis.
- Browser filtering.
- Common linguistic exports.

Every generated row must retain a stable link to its canonical source.

Every table must have:

- A schema version.
- Deterministic ordering.
- Stable generated identifiers.
- Source corpus.
- Source repository commit.
- Source-relative XML path.
- Source element ID when present.
- Source ordinal when needed to disambiguate.
- Language identity and ISO code where resolvable.
- Dialect where resolvable.

For every projected XML element, preserve a namespaced raw-attribute map and source child
ordinal in addition to convenient typed columns. Unknown future attributes must survive the
projection and appear in hierarchical JSON/SQLite metadata without being silently dropped.
Do not treat XML namespace prefixes as stable; preserve namespace URIs and local names.

### 8.2 Deterministic identifiers

Do not use database auto-increment IDs.

Create stable identifiers from a versioned canonical locator.

Recommended logical inputs:

```text
record type
corpus slug
source-relative path
ancestor locator
XML @id if present
sibling ordinal
```

Encode the resulting identifier as a readable prefix plus a truncated cryptographic digest.

Document the algorithm and test:

- Stability across repeated builds.
- Uniqueness across the complete corpus.
- Colliding local XML IDs.
- Missing XML IDs.
- Unicode paths.
- Reordered unrelated files.

Changing the identifier algorithm requires a data-schema version change.

### 8.3 Required relational tables

Generate at least:

#### `corpora`

- `corpus_id`
- `slug`
- `name`
- `description_en`
- `description_zh_hant`
- `source_url`
- `citation`
- `license_id`
- `rights_status`
- `xml_file_count`
- `text_count`
- `sentence_count`
- `word_count`
- `morpheme_count`
- `token_count`
- `audio_reference_count`
- `transcribed_seconds`
- `untranscribed_seconds`
- `languages`
- `dialects`
- `available_tiers`
- `available_formats`

#### `languages`

- `language_id`
- `name_en`
- `name_zh_hant`
- `autonym` when available
- `iso639_3`
- `glottocode` when documented
- `dialect`
- `corpora`
- aggregate counts
- available tiers

Do not use `iso639_3` as the primary key.

#### `texts`

- `text_id`
- `corpus_id`
- `language_id`
- `dialect`
- `source_path`
- `source_xml_id`
- `title`
- `speaker`
- `genre`
- `date`
- `citation`
- `bibtex_citation`
- `copyright`
- `source`
- `audio_source`
- `glottocode`
- `metadata_json`
- source-order fields

Only populate metadata fields actually supported by source data.

#### `sentences`

- `sentence_id`
- `text_id`
- `corpus_id`
- `language_id`
- `dialect`
- `source_path`
- `source_xml_id`
- `source_ordinal`
- original, standard, and alternate forms as repeatable values
- original and standard phonology as repeatable values
- translation counts by language
- word and morpheme counts
- audio availability
- audio start/end where present
- inline-unclear presence
- source-order fields

Represent repeatable tiers in normalized child tables or list/struct Parquet columns.
Do not silently retain only the first tier.

#### `words`

- `word_id`
- `sentence_id`
- source locator
- ordinal
- repeatable forms
- repeatable phonology
- translations/glosses
- audio references
- `class`
- `sclass`
- morpheme count

#### `morphemes`

- `morpheme_id`
- `word_id`
- source locator
- ordinal
- repeatable forms
- repeatable phonology
- glosses/translations
- audio references
- `class`
- `sclass`

#### `forms`

- `form_id`
- `owner_type`
- `owner_id`
- `kind`
- `value`
- `value_nfc`
- `search_normalized`
- `notes`
- `ordinal`
- `inline_markup_json`

#### `phonology`

- `phonology_id`
- `owner_type`
- `owner_id`
- `kind`
- `value`
- `value_nfc`
- `notes`
- `ordinal`

#### `translations`

- `translation_id`
- `owner_type`
- `owner_id`
- `language`
- `kind`
- `version`
- `notes`
- `value`
- `value_nfc`
- `search_normalized`
- `ordinal`

#### `audio`

- `audio_id`
- `owner_type`
- `owner_id`
- `file_reference`
- `url_reference`
- `resolved_url` when safely derivable
- `start_raw`
- `end_raw`
- `start_seconds`
- `end_seconds`
- `duration_seconds`
- `mime_type` when known
- `availability_status`
- `rights_status`
- `ordinal`

Preserve raw timing strings. Parse with decimal arithmetic, reject non-finite and negative
durations, and document any millisecond rounding required by EAF, VTT, or SRT.

#### `tokens`

- `token_id`
- `sentence_id`
- `word_id` when segmented
- `corpus_id`
- `language_id`
- `dialect`
- `surface`
- `surface_nfc`
- `surface_normalized`
- `position`
- `left_context`
- `right_context`
- form/phonology/gloss references needed for cards

Context fields may be generated at query time if that is smaller and fast enough.

### 8.4 Lossless source representation

For each source XML file:

- Include it byte-for-byte in canonical XML prepared downloads.
- Calculate SHA-256.
- Record relative path and size.
- Record parse and validation status.
- Record the FormosanBank commit.

For inline markup such as `UNCLEAR`:

- Preserve exact source XML in canonical downloads.
- Preserve a structured representation in relational projections where practical.
- Preserve readable text with descendant text and tails in the display projection.
- Never use only `element.text` for mixed-content extraction.

### 8.5 Schema artifacts

Publish:

- Human-readable data-model documentation.
- JSON Schema for JSON manifests and recipes.
- Arrow/Parquet schema descriptions.
- SQLite schema.
- Column dictionaries for CSV/TSV/XLSX.
- Format-specific caveats.
- Schema version and changelog.

### 8.6 Curated presentation metadata

Corpus discovery alone cannot supply safe bilingual descriptions, rights conclusions, and
audience-facing format guidance.

Maintain a small reviewed metadata overlay in `publisher/metadata/`.

For every corpus it must record:

- Stable display slug and aliases.
- English display name and reviewed description.
- Traditional Chinese display name and reviewed description when available.
- Explicit fallback behavior when a reviewed translation is unavailable.
- Public source paths and URLs supporting the summary.
- Required corpus and upstream citations.
- Rights status and the evidence used to assign it.
- Community/contributor attribution and culturally relevant notices supplied by the source.
- Tier and format exceptions that cannot be inferred mechanically.

For every display language it must record reviewed names, autonym where sourced, ISO code,
dialect disambiguation, and provenance.

Do not scrape the GitBook at runtime.

Do not silently use stale translated GitBook content.

Do not machine-translate corpus descriptions, rights, or community notices without explicit
maintainer approval and visible disclosure.

Discovery and the overlay must reconcile in both directions:

- Every discovered corpus and display language has one reviewed entry.
- Every overlay entry resolves to current public source data.
- Removed or renamed corpora produce a build failure requiring review.

## 9. Publication manifests

### 9.1 Catalogue

`catalog.json` is the small application bootstrap.

It must include:

- Product and schema versions.
- Current FormosanBank commit and timestamp.
- Available releases.
- Language summaries.
- Corpus summaries.
- Aggregate statistics.
- Rights summaries.
- Links to per-language and per-corpus manifests.
- Links to documentation.
- Application compatibility range.

Keep it small enough for initial page load.

### 9.2 Search manifest

The search manifest maps:

- Language and corpus selectors to shard URLs.
- Index kind to file.
- File size.
- SHA-256.
- Row count.
- Normalization version.
- Minimum application version.
- Parquet schema version.

The browser must never guess filenames.

### 9.3 Release manifest

The release manifest maps every prepared artifact to:

- Stable artifact ID.
- Display label in both interface languages.
- Format.
- Compression.
- Corpus/language scope.
- Included tiers.
- Record counts.
- Uncompressed and compressed sizes.
- SHA-256.
- Download URL.
- Source commit.
- Generated timestamp.
- License and rights identifiers.
- Citation.
- Known limitations.

The manifest must validate before publication.

### 9.4 Version retention, cache safety, and atomic publication

Interactive querying and historical prepared downloads have different retention rules.

- The Pages artifact must always contain one complete current interactive data release.
- It may contain one previous interactive release only if the 900 MiB budget remains met.
- Older releases remain discoverable as prepared downloads through immutable GitHub
  Releases, but the UI must not imply that arbitrary browser queries are available for
  historical releases whose interactive shards are no longer on Pages.
- The release selector must distinguish `interactive` from `prepared downloads only`.

All interactive asset paths must include the immutable data-release ID and content hash.

The small application bootstrap points to one current catalogue.

Never reuse a shard URL for different bytes.

The application must verify:

- Manifest schema compatibility.
- Application/data compatibility.
- Expected size and content hash metadata.
- That all selected shards belong to the same data release.

Publishing must be two-phase and recoverable:

1. Build and validate all outputs in a clean directory.
2. Create a draft GitHub data release.
3. Upload all release assets and verify remote names, sizes, and checksums.
4. Upload the release manifest last and publish the immutable release.
5. Assemble Pages from the exact validated interactive bundle.
6. Deploy Pages as one artifact so application, catalogue, and shards change atomically.
7. Run post-deployment smoke checks before declaring success.

Never mutate an already published data release. A correction receives a new release ID.

Do not use expiring Actions artifacts as the long-term source of Pages data.

The Pages workflow may download the exact interactive bundle from a published Kakarayan
release during Actions execution, where browser CORS is irrelevant, and then include it
same-origin in the Pages artifact.

Document rollback:

- Re-run deployment with the last known-good application and data-release IDs.
- Keep the prior release immutable.
- Do not delete the failed release until maintainers have evidence needed for diagnosis.

## 10. Static search architecture

### 10.1 Search modes

Implement:

- Exact surface search.
- Normalized exact search.
- Prefix search.
- Substring search.
- Regular-expression search within a deliberately selected scope.
- Fuzzy vocabulary lookup with explicit edit-distance behavior.
- Translation/meaning search.
- Phonological-form search where source tiers exist.
- Gloss/morpheme search where source tiers exist.

Expose mode and normalization controls clearly.

Do not call normalized search "exact" without distinguishing it from source-exact search.

### 10.2 Scope controls

Allow:

- One or multiple display languages.
- One or multiple corpora.
- One or multiple dialects.
- Sentence, word, or morpheme tier.
- Presence of translation.
- Translation language.
- Presence of audio.
- Presence of phonology.
- Presence of word segmentation.
- Presence of morpheme segmentation.
- Presence of unclear markup.
- Text/source, genre, date, or speaker only where reviewed source metadata provides them.
- Presence of valid time alignment versus untimed audio reference.
- Sentence/token/word/morpheme count ranges.
- Word/morpheme `class` and `sclass` where present.
- Missing-versus-present values for selected tiers and fields.

Selections with no compatible records must explain why.

Generate filter options from manifest facets rather than hard-coding values. Clearly mark
metadata coverage so absence is not interpreted as a meaningful negative claim.

### 10.3 Index design

Do not require the browser to scan the full corpus for common searches.

Generate static, compressed, versioned index shards partitioned by:

- Display language.
- Corpus where necessary for size.
- Search tier.
- Normalized leading characters or deterministic hash bucket.

At minimum provide:

- Surface vocabulary table.
- Normalized vocabulary table.
- Vocabulary-to-occurrence postings.
- Translation-term vocabulary or n-gram index.
- Occurrence-to-sentence mapping.
- Sentence display records.

Use integer dictionary encoding and delta-encoded postings where it materially reduces size.

Choose an encoding that can be decoded in a Web Worker with a maintained dependency or a
small tested implementation.

Do not invent a custom binary format without documentation and round-trip tests.

### 10.4 DuckDB-Wasm role

Use DuckDB-Wasm for:

- Filtering already-scoped Parquet.
- Joining selected relational tiers.
- Computing counts.
- Sorting.
- Sampling.
- Producing browser-side CSV/TSV/JSON/Parquet exports.

Do not use a full-corpus DuckDB scan as the only concordance strategy.

Load DuckDB only when the visitor enters search, preview, or custom-export functionality.

Run it inside a Worker.

Support cancellation and discard stale results when search parameters change.

Run regular expressions through an engine with bounded, non-backtracking behavior such as
DuckDB's RE2-compatible implementation. Bound query length and scope, enforce a time/work
budget, and terminate/recreate a Worker that does not cancel promptly. Never evaluate
untrusted patterns through JavaScript expressions susceptible to catastrophic backtracking.

Fuzzy search must operate over a scoped vocabulary, document its distance/ranking rule, and
cap candidate work.

Random samples must accept and display a seed. The same data release, recipe, and seed must
produce the same sample.

Artifact ordering must use documented code-point/stable-key ordering. Locale-aware display
sorting may be offered separately and must not change reproducible export order.

### 10.5 Result behavior

Results must include:

- Source form with exact Unicode.
- Standard/alternate forms when present.
- Phonology when present.
- Translation and gloss tiers.
- Language, dialect, and corpus.
- Left/right concordance context.
- Expandable sentence and interlinear structure.
- Audio control when resolvable.
- Stable record link.
- Source XML path and local identifier.
- Citation and rights access.

Use deterministic pagination or virtualization.

Changing filters must not mix results from an earlier asynchronous query.

Search state must be serializable into a shareable URL.

Report exact counts when they have actually been computed. If a fast preview uses a manifest
estimate or sample, label it as approximate and provide a path to calculate the exact count.

Bound serialized URL state. Search scopes may use the URL; large builder configurations must
use a validated recipe file rather than producing fragile multi-kilobyte links.

## 11. Public site information architecture

Implement these complete views:

### 11.1 Home

- Concise explanation of FormosanBank and Kakarayan.
- Current release and source commit.
- Aggregate collection statistics.
- Prominent entry points for search, browsing, and downloading.
- Explanation that all processing is local to the browser.
- No overstated preservation, licensing, or completeness claims.

### 11.2 Explore corpora

- Searchable and filterable corpus cards/table.
- Languages and dialects.
- Record/tier/audio counts.
- Rights status.
- Available formats.
- Direct link to corpus detail and downloads.

### 11.3 Corpus detail

- Description and provenance.
- Source and contributor information where available.
- Languages/dialects.
- Tier coverage.
- Statistics.
- Audio availability.
- Citation.
- License and rights.
- Known limitations.
- Prepared downloads.
- Search scoped to that corpus.

### 11.4 Explore languages

- Display language identity rather than ISO-only grouping.
- English name, Traditional Chinese name, autonym where available.
- ISO and dialect metadata.
- Participating corpora.
- Tier and audio coverage.
- Direct language-wide downloads and search.

### 11.5 Concordance

- Full search-mode and scope controls.
- Keyword-in-context results.
- Sentence expansion.
- Sort, sample, and pagination controls.
- Result-count confidence/status.
- Download current result.
- Save/share query recipe.

### 11.6 Dictionary

- Preserve and improve the existing Kakarayan dictionary experience.
- Surface, normalized, prefix, fuzzy, and meaning search.
- Group occurrences by headword candidate without pretending automatic groups are curated
  dictionary entries.
- Show forms, pronunciations, glosses, examples, corpus distribution, and language.
- Allow switching to raw concordance occurrences.

### 11.7 Dataset builder

Use a staged but non-modal workflow:

1. Choose release.
2. Choose languages, dialects, and corpora.
3. Choose record unit: text, sentence, word, morpheme, token, or audio manifest.
4. Choose filters and search constraints.
5. Choose included tiers and metadata fields.
6. Choose format.
7. Preview records, schema, estimated size, and rights.
8. Download locally or select a prepared package.

Selections must remain visible and editable.

Explain dependencies such as:

- Morpheme exports require compatible segmented corpora.
- Time-aligned formats require valid audio timings.
- Canonical XML downloads operate at source-file/package granularity.
- Very large selections use prepared downloads.

### 11.8 Prepared downloads

- Browse by release, language, corpus, format, and tier.
- Show exact size, checksum, scope, source commit, license, and citation.
- Provide direct browser download.
- Provide `curl` and optional CLI examples.
- Provide checksum-verification examples.
- Explain compression requirements.

### 11.9 Formats and data model

- Audience-oriented format chooser.
- Precise included tables/tier mappings.
- Round-trip and lossiness notes.
- Examples small enough to understand.
- Recommended formats by use case.
- Copyable loading examples for Python/pandas or PyArrow, R/Arrow or readr, DuckDB SQL,
  SQLite, spreadsheet software, ELAN, and Praat where applicable.
- A minimal worked example that traces one sentence from XML through relational tables and
  back to its source locator.

### 11.10 Citation, rights, and provenance

- Site citation.
- FormosanBank release citation.
- Corpus-specific citations.
- Machine-readable BibTeX and RIS downloads where source metadata supports them.
- Rights vocabulary and meaning.
- AI-derived/addendum disclosures where present in the source.
- Source commit and build-tool commit.
- Checksum instructions.

### 11.11 About and methodology

- Purpose and audience.
- Canonical-versus-derived distinction.
- Static architecture and privacy.
- Normalization method.
- Statistics method.
- Known limitations.
- Contribution and issue links.
- Attribution to the original Kakarayan researcher and FormosanBank contributors.

### 11.12 Error and offline states

- Useful static 404.
- Missing-shard explanation.
- Corrupt-download/checksum error.
- Browser capability failure.
- Offline state.
- Unsupported format explanation.
- Link to prepared packages when local custom export is too large.

### 11.13 Discoverability, no-script access, and diagnostics

- Provide meaningful page title, description, canonical URL, Open Graph metadata, favicon,
  and a generated sitemap for stable informational routes.
- Prevent query-state variants from becoming misleading duplicate search-engine pages.
- Provide a useful `<noscript>` block with project explanation, latest prepared-download
  links, citation, rights, documentation, and the GitHub repository.
- Do not claim that concordance or custom export works without JavaScript.
- Provide a "copy/download diagnostics" action containing only application version, data
  release, browser capabilities, failed public asset URL, and sanitized error details.
- Never include search history, private filesystem paths, or corpus content beyond the
  record the user explicitly chooses to report.
- Link errors to a prefilled public issue URL when it remains within safe URL-length limits.
- Provide a visible contact/takedown path for rights holders and source communities.

### 11.14 Lightweight linguistic summaries

For a deliberately scoped language/corpus/tier selection, provide:

- Frequency lists for source-exact and normalized forms.
- Frequency lists for translations and glosses where meaningful.
- Type, token, and type/token counts with a warning that type/token ratio is length-sensitive.
- One- through five-token n-gram tables when the source tokenization supports them.
- Concordance-result distribution by corpus, display language, dialect, and available tier.
- Bounded left/right collocate counts around a selected token.
- A documented association score only if its formula, minimum-frequency rule, and edge cases
  are tested and shown; raw counts must always remain available.
- Reproducible sampling with a visible seed.
- CSV/TSV/JSON export of every summary table.

Use the same normalization, tokenization, filters, release ID, and recipe model as search and
downloads.

Make an accessible data table the primary representation. Small charts may supplement the
table but may not be the only way to read or export results.

Estimate work before running n-gram or collocation analysis. Bound the scope, keep it in a
Worker, support cancellation, and offer a local-recipe path when it exceeds browser limits.

Do not present descriptive corpus frequencies as claims about speakers, communities,
language vitality, grammaticality, or population-wide usage.

## 12. Export and download capabilities

### 12.1 Browser-generated exports

Support for appropriately sized selections:

- CSV.
- TSV.
- JSON.
- JSON Lines.
- Parquet.
- Plain text.
- Interlinear plain text.
- Audio-reference manifest.
- Reproducible export recipe.

Where technically reliable and size-safe, also support:

- XLSX.
- ZIP containing multiple relational tables.
- XML fragments clearly labeled as a derived selection, not canonical source files.

All browser exports must:

- Use deterministic row ordering.
- Preserve Unicode.
- Offer raw and spreadsheet-safe delimited modes where formula injection is relevant.
- Include a README or sidecar manifest for multi-file exports.
- Include source release and schema version.
- Include the export recipe.
- Estimate memory and output size before execution.
- Refuse unsafe selections with an alternative prepared package.

Stream query results and serialization where browser support permits so output is not held
in multiple full-size in-memory copies. Retain a bounded Blob fallback for browsers without
stream-to-file support. Test the fallback separately and set its limit conservatively.

The recipe must contain no executable code. Validate it against the versioned schema, reject
unknown fields, bound list and string sizes, and show the resolved selection before running
it in either the browser or local CLI.

### 12.2 Prepared release formats

Generate and validate:

Provide ZIP for broadly accessible multi-file packages. A `.tar.zst` variant may be offered
for efficient research workflows, but it must not be the only way to obtain a required
format. Split oversized packages deterministically and publish a part manifest with
checksums and reconstruction instructions.

#### Canonical XML

- Byte-for-byte source XML.
- Directory structure preserved.
- Corpus/language scopes where they can be selected without altering files.
- Checksums.
- Source commit.

#### Relational CSV and TSV

- One documented file per normalized table.
- UTF-8.
- Stable headers and row order.
- Explicit null representation.
- README and data dictionary.

#### JSON Lines

- One lossless-enough hierarchical sentence record per line.
- Source locators.
- Repeated tiers represented as arrays.
- Nested words and morphemes where selected.

#### Parquet

- Normalized tables.
- Dictionary encoding.
- Compression selected through measured results.
- Row-group sizing optimized for HTTP partial reads.
- Partitioned by language/corpus where useful.
- Arrow schema included.

#### SQLite

- Portable relational database.
- Tables and indexes documented.
- Views for common sentence and concordance analysis.
- No extensions required for basic use.
- Integrity check performed during publication.

#### XLSX

- Human-oriented workbook, not the archival representation.
- Separate sheets for metadata and manageable linguistic tiers.
- Split workbooks or sheets before Excel row limits.
- Freeze panes, filters, readable column widths, and documentation.
- Protect against spreadsheet formula execution by default.

#### CLDF

- Use the closest valid CLDF modules and documented custom tables.
- Validate with official tooling.
- Do not invent lexical, grammatical, or bibliographic claims absent from the source.
- Document which corpora map naturally to Wordlist/Dictionary/Example-style structures.
- Exclude incompatible corpora from specialized CLDF modules with an explanation.

#### ELAN EAF

- Generate only where media references and valid time alignment exist.
- Maintain tier hierarchy and language labels.
- Validate XML.
- Preserve media URL/reference without copying restricted media.
- Package a manifest and mapping notes.

#### Praat TextGrid

- Generate only for time-aligned material.
- Define interval-tier mappings.
- Reject overlapping/invalid intervals when the representation cannot preserve them.
- Document any conversion loss.

#### WebVTT and SRT

- Generate only for valid sentence-level timing.
- Preserve source language and translation tracks separately where practical.
- Validate monotonically ordered cue timing.
- Document missing or adjusted timing.

#### Plain text

- Sentence-per-line source forms.
- Optional translation-aligned variant.
- Interlinear display variant.
- Clear separators and escaping rules.

#### Audio manifest

- References, timings, scope, rights, availability, and checksums where known.
- No promise that every external audio URL permits automated fetching.
- No bulk audio redistribution without explicit compatible rights.

### 12.3 Formats not to misrepresent

Do not generate CoNLL-U unless actual POS, feature, head, and dependency data exists.

Do not generate TEI, LIFT, FLEx, Toolbox, or other specialist formats merely by renaming
fields. Add one only if a defensible mapping, validator, tests, and documentation are
implemented.

## 13. Rights, licensing, and citation

### 13.1 Required rights model

Create a corpus-level rights manifest with explicit statuses such as:

- `redistributable`
- `metadata_and_links_only`
- `restricted_component`
- `unknown_requires_review`

Do not infer a uniform corpus-data license from repository visibility.

Distinguish:

- Kakarayan source-code license.
- FormosanBank repository license.
- Corpus/source licenses.
- Audio rights.
- AI-derived-content disclosures or addenda.

Publication must fail closed for ambiguous bulk redistribution.

Metadata and source links may still be displayed where allowed.

The rights registry must preserve, not reinterpret, the current public FormosanBank
`LICENSE.md`, `AI-USE-ADDENDUM.md`, `NOTICE-AI.md`, corpus README restrictions, XML-root
copyright/citation attributes, dataset cards, and stricter upstream notices.

Use this evidence precedence:

1. A record/component-specific notice.
2. A corpus-specific README, dataset card, license, or source notice.
3. Central FormosanBank terms and AI-use addendum.
4. `unknown_requires_review` when the result remains ambiguous.

Do not attempt automated legal interpretation of prose. Encode a reviewed conclusion in
the checked-in metadata overlay and retain links to all evidence.

Carry the current noncommercial-AI, attribution, provenance, TDM-reservation, and
license-notice requirements into:

- Human-readable site terms.
- Corpus and download pages.
- Every package README.
- Release descriptions and manifests.
- Dataset cards.
- HTML metadata and link relations where a standard applies.
- Machine-readable TDM/RSL/content-signal files where technically applicable.

GitHub Pages project sites cannot control origin-root `robots.txt` or
`/.well-known/tdmrep.json` for the entire `formosanbank.github.io` origin. Include
project-scoped signals, document that limitation, and provide the exact root-level files
that the FormosanBank organization-site or custom-domain maintainer must install. Never
claim a project-scoped file protects the whole origin.

### 13.2 UI requirements

Show rights:

- On corpus pages.
- In the dataset builder.
- Before download.
- In every multi-file package README.
- In machine-readable manifests.

Do not require accounts or server-stored acceptance.

If acknowledgment is appropriate, keep it local to the browser and do not imply it changes
the underlying license.

### 13.3 Code-license prerequisite

Kakarayan did not contain a `LICENSE` file at planning time. FormosanBank's central
`LICENSE.md` also states that its code and scripts receive no additional software license
unless a file or directory says otherwise.

Before publishing the final PR, the maintainer must confirm:

- Permission to extend and redistribute Kakarayan.
- Permission and terms for importing, copying, adapting, or executing FormosanBank QC code
  as part of the Kakarayan publisher.
- Attribution for the original researcher's work.
- The Kakarayan code license and any notices required for reused FormosanBank code.
- Ownership of the GitHub Pages deployment and release process.

Do not choose a code license on the maintainer's behalf.

If this remains unresolved, implementation can be completed, but the PR must be clearly
blocked from public deployment rather than silently assigning a license.

### 13.4 Community and cultural responsibility

Public availability does not erase community interests in Indigenous language materials.

- Preserve community, speaker, collector, and contributor attribution provided by sources.
- Surface culturally sensitive or access notices without minimizing them.
- Do not infer speaker identity, demographic traits, locations, vitality, or cultural
  categories absent from reviewed source metadata.
- Do not rank languages or corpora by quality, importance, or completeness.
- Provide a direct correction, rights, and takedown contact path.
- Make it possible to withdraw a corpus from new prepared releases without breaking the
  provenance record for prior releases.
- Record reviewer-needed cultural and terminology questions in the status document and PR;
  do not silently invent an answer.

## 14. Internationalization and typography

Support English and Traditional Chinese at full feature parity.

Reuse the existing gettext terminology where possible.

Implement one translation source of truth:

- Either convert existing `.po` catalogs to browser JSON during build.
- Or migrate catalogs once with a documented maintenance workflow.

Do not maintain duplicate manually synchronized translations.

Requirements:

- Locale-aware number, date, duration, and byte formatting.
- Correct `lang` attributes for the page and tier content.
- A language switcher that retains current route and query state.
- Fonts/stacks that render IPA, Formosan orthographies, and Traditional Chinese.
- No normalization that removes contrastive symbols.
- Interface search labels that distinguish form, phonology, translation, and gloss.

Missing translations must be caught in CI.

## 15. Accessibility and inclusive design

Target WCAG 2.2 AA.

At minimum:

- Fully keyboard-operable navigation and controls.
- Visible focus indicators.
- Semantic headings and landmarks.
- Correct form labels and descriptions.
- Accessible table/card alternatives.
- Live-region status for asynchronous search and export.
- No color-only encoding.
- Sufficient color contrast.
- Reduced-motion support.
- Touch targets appropriate for mobile.
- Screen-reader-readable interlinear structure.
- Captions/transcript access where the source supports it.
- Language metadata on multilingual strings.
- No focus loss when results update.

Run automated accessibility checks and complete a documented manual keyboard/screen-reader
smoke test.

## 16. Privacy and security

The site should collect no user data.

Do not add:

- Analytics by default.
- Tracking pixels.
- Advertising.
- Authentication.
- Cookies.
- Server logs beyond GitHub's unavoidable hosting behavior.

Do not upload corpus text, audio, metadata, or generated indexes to third-party AI,
translation, analytics, error-reporting, or hosted-search services.

Do not build semantic embeddings or AI-derived annotations for this product. Search must
use transparent lexical, relational, and documented linguistic projections.

Security requirements:

- Treat all corpus strings and metadata as untrusted text.
- Parse XML with external-entity resolution and network access disabled; enforce realistic
  file, tree-depth, text, and expansion limits without rejecting valid current corpora.
- Do not use unsanitized HTML insertion.
- Validate and bound all URL-derived query state.
- Sanitize archive paths to prevent traversal.
- Reject unsafe symlinks and paths that escape the pinned checkout or build directory.
- Prevent formula execution in spreadsheet-oriented exports.
- Set a restrictive CSP through a meta tag where compatible with required Workers/Wasm.
- Avoid remote executable scripts and fonts.
- Bundle dependencies and assets locally.
- Run dependency and license audits.
- Pin GitHub Actions to immutable commit SHAs where practical.
- Give workflows the minimum permissions needed.
- Never expose repository tokens to pull-request code.
- Never use `pull_request_target` to execute pull-request code.
- Run FormosanBank checkout, QC imports, XML parsing, and artifact generation in a job with
  read-only repository permissions and no deployment environment or write credentials.
- Give release/Pages write permission only to a later trusted job that consumes a
  checksummed validated artifact and does not execute upstream scripts or generated content.
- Use protected-environment approval for publication if the organization supports it.

## 17. Performance and storage budgets

Treat these as release gates:

- Published Pages artifact below 900 MiB.
- No individual interactive query shard above 50 MiB compressed.
- Target common shards at or below 25 MiB.
- Initial route transfer below 2 MiB on a cold load.
- Application JavaScript below 500 KiB compressed before lazy DuckDB/Wasm chunks.
- Catalogue bootstrap below 1 MiB compressed.
- Typical cold scoped exact search produces first results within 5 seconds on a normal
  laptop and broadband connection.
- Typical warm exact search produces first results within 2 seconds.
- Main thread remains responsive during search and export.
- Typical query memory below 500 MiB.
- Hard-stop or warn before estimated browser memory exceeds 1 GiB.
- Every GitHub Release asset below 1.9 GiB.
- Split large packages deterministically.
- Complete standard-runner build fits available disk and job duration.

Measure real generated data rather than estimating from fixtures.

Publish a size report in CI and the PR.

## 18. Browser support

Support the current and previous major versions of:

- Chrome.
- Firefox.
- Safari.
- Edge.

Include an iOS Safari smoke test where available.

Detect missing WebAssembly, Worker, stream, or file-download capabilities and provide a
prepared-download fallback.

Do not assume File System Access API availability.

Use Blob/download fallback for all supported browser exports.

## 19. GitHub Actions and release design

### 19.1 `ci.yml`

Run on pull requests and pushes.

Include:

- Existing Python tests.
- Ruff check and format check.
- Existing mypy checks.
- Publisher unit and integration tests.
- TypeScript lint and strict type check.
- Frontend unit/component tests.
- Production site build.
- JSON Schema validation.
- Small-fixture publisher build.
- Playwright smoke tests against the built subpath.
- Accessibility checks.
- Generated-output determinism check.
- Broken-link and route check.
- Dependency/license review where available.

The pull request workflow must not publish Pages or Releases.

### 19.2 `deploy-pages.yml`

Run only from `main` or explicit authorized manual invocation.

Steps:

- Build the frontend.
- Obtain or reuse a validated current interactive-data bundle.
- Assemble `build/pages`.
- Verify base path, manifests, checksums, size budget, and links.
- Upload a Pages artifact.
- Deploy through the official Pages action.
- Read the deployment output URL and run a post-deployment smoke test for HTML, hashed
  assets, Wasm/Worker loading, catalogue compatibility, a representative search, byte-range
  retrieval, direct download links, and the 404 page.

Use the `github-pages` environment and least-privilege permissions.

Concurrency must cancel obsolete deployments without interrupting a newer deployment.

The smoke test must tolerate only documented CDN propagation behavior and must fail the
workflow on persistent asset/version mismatch. Document how to redeploy the previous
known-good application/data pair.

### 19.3 `publish-data.yml`

Support `workflow_dispatch` with:

- FormosanBank ref.
- Release label.
- Dry-run mode.
- Optional corpus/language scope for debugging only.

For a real release:

- Check out the exact public FormosanBank ref.
- Confirm clean and resolved commit.
- Run full validation.
- Generate all required artifacts in partitions that remain within standard-runner disk.
- Run checksums and format validators.
- Enforce size limits.
- Create a clearly named draft Kakarayan data release.
- Upload assets with bounded retry and verify remote size/checksum metadata.
- Publish only after every asset and manifest validates.
- Produce a Pages-compatible interactive bundle and manifest.

Do not make a scheduled job automatically publish a changed upstream commit without
validation and maintainer intent.

A scheduled workflow may report that a newer FormosanBank commit exists, but real data
publication should remain explicit.

Publication must be idempotent:

- A dry run never creates or mutates a release.
- Re-running against an existing published release verifies it and exits without mutation.
- A partial draft may be resumed only after verifying every existing asset.
- A conflicting asset or manifest fails and requires a new release ID.
- Intermediate Actions artifacts use short retention and are not cited as public releases.

### 19.4 Release naming

Use separate version concepts:

- Application version.
- Data-schema version.
- FormosanBank source commit.
- Publication timestamp/release label.

Example:

```text
Kakarayan app: 1.0.0
Data schema: 1.0.0
Data release: data-2026.07.23+fb.abc1234
```

Do not imply the FormosanBank repository itself was released on that date unless it was.

## 20. Validation strategy

### 20.1 XML and corpus validation

- Parse every XML file.
- Reuse FormosanBank canonical QC rules where stable and public.
- Record all warnings and errors by source path.
- Check language resolution.
- Check local-ID collisions.
- Check tier ownership.
- Check audio timing validity.
- Check descendant text preservation.
- Check counts against independently calculated summaries.
- Fail on unexpected data loss.

Define every public statistic precisely. In particular, distinguish audio references from
unique media files, timed segments from untimed references, and transcribed duration from
total media duration. Never sum overlapping segments as unique media duration without
labeling the metric.

### 20.2 Artifact validation

- JSON validates against schemas.
- CSV/TSV headers and row counts match manifests.
- JSONL parses line-by-line.
- Parquet opens, matches Arrow schema, and supports representative filters.
- SQLite passes `PRAGMA integrity_check`.
- XLSX opens through a library and respects sheet/row limits.
- CLDF passes official validation.
- EAF and XML-based formats validate as XML and against available schemas.
- TextGrid parses with an independent library where possible.
- VTT/SRT timing is ordered and valid.
- Archives list only safe relative paths.
- SHA-256 values match after publication assembly.
- Generated files contain no absolute local paths, usernames, temporary URLs, credentials,
  Actions tokens, runner paths, or private repository names.
- A range-capable static test server proves representative Parquet partial reads.
- A post-deployment check proves the actual Pages CDN and MIME behavior used by the app.

### 20.3 Cross-representation reconciliation

For the full build and fixtures, reconcile:

- Corpus counts.
- Text counts.
- Sentence counts.
- Word counts.
- Morpheme counts.
- Token counts.
- Translation counts.
- Audio-reference counts.
- Duration totals.

Sample records deterministically and compare:

- Canonical XML.
- JSONL hierarchy.
- Relational Parquet.
- SQLite.
- Browser display record.
- Specialist format where applicable.

### 20.4 Search correctness

Build shared golden search cases from current Django tests and representative public XML.

Test:

- Source-exact search.
- Normalized search.
- Contrastive diacritics.
- Punctuation folding.
- Prefix.
- Substring.
- Regex.
- Fuzzy candidate ranking.
- English translation.
- Traditional Chinese translation.
- Gloss.
- Multiple languages/corpora.
- Seediq/Truku distinction.
- Duplicate XML IDs.
- Mixed segmented/unsegmented corpora.
- Empty and malformed query state.

Compare expected occurrences, not merely expected counts.

## 21. User-experience quality bar

The site should feel like a research instrument, not a file directory or generic dashboard.

Retain Kakarayan's existing weave-derived visual identity.

Requirements:

- Clear hierarchy and generous space.
- Dense linguistic data remains readable.
- Filters are understandable without documentation.
- Advanced controls are available without overwhelming first-time users.
- Every technical term has concise help.
- Counts, scopes, and active filters remain visible.
- Download consequences are explicit before execution.
- Mobile layout remains functional.
- Loading states report actual work.
- Errors suggest a recovery path.
- No decorative animation that interferes with corpus reading.

Use real corpus fixtures in visual tests.

## 22. Implementation sequence

The sequence below is intended to minimize rework while still delivering one pull request.

### Phase 0: Safety and baseline

- Confirm the current branch is not `main`.
- Confirm the worktree and intended file scope.
- Read `README.md`, `CLAUDE.md`, `pyproject.toml`, settings, ingestion, models, views,
  templates, CSS, i18n catalogs, and tests.
- Run the current test/lint/type-check baseline.
- Record failures that predate the branch.
- Inspect the current public FormosanBank checkout and applicable instructions.
- Inspect central license, AI-use, TDM, corpus-specific, XML-root, and media notices.
- Recalculate the source inventory.
- Confirm code-license/maintainer status or record the publication blocker.
- Create `IMPLEMENTATION_STATUS.md` with the baseline commit, checks, blockers, and next slice.

Exit condition:

- Existing behavior is understood.
- Baseline checks are documented.
- No implementation assumptions depend only on this plan.

### Phase 1: Architecture and contracts

- Finalize technology choice.
- Add concise architecture decisions.
- Define stable identifiers.
- Define table schemas.
- Define catalogue, search, release, and recipe schemas.
- Define rights vocabulary.
- Create the reviewed corpus/language metadata overlay and evidence links.
- Define format-support matrix.
- Build representative fixtures covering difficult XML structures.

Exit condition:

- Schemas validate.
- Fixtures cover repeated tiers, inline markup, segmentation, translations, audio, missing
  values, duplicate IDs, and shared ISO codes.

### Phase 2: Publisher foundation

- Implement CLI and configuration.
- Implement source-ref resolution and clean-checkout verification.
- Implement streaming discovery and parsing.
- Implement deterministic locators and IDs.
- Implement lossless mixed-content extraction.
- Implement normalized relational records.
- Implement statistics and provenance.
- Implement validation report.

Exit condition:

- Fixture build is deterministic.
- Full repository parses without unexplained loss.
- Statistics reconcile.

### Phase 3: Core data artifacts

- Generate catalogues and manifests.
- Generate normalized Parquet tables.
- Generate JSONL.
- Generate CSV and TSV.
- Generate SQLite.
- Generate canonical XML packages.
- Generate checksums and package READMEs.

Exit condition:

- Every core format validates.
- Full output sizes are measured.
- Release splitting rules are proven.

### Phase 4: Search/index proof at full scale

- Implement vocabularies and postings.
- Implement translation search data.
- Partition and compress.
- Benchmark all languages and largest corpora.
- Confirm Pages artifact budget.
- Adjust row groups and shard sizes based on measurement.
- Implement browser Worker query prototype.

Exit condition:

- Exact, prefix, translation, and scoped regex searches work against full data.
- Common-query performance and memory budgets are met.

### Phase 5: Static application foundation

- Configure Vite and static-safe routing.
- Port design tokens, assets, typography, and layout.
- Implement bilingual shell.
- Implement locale-safe formatting.
- Implement catalogue loader and data-version state.
- Implement common loading, error, empty, and offline states.
- Implement metadata/citation components.

Exit condition:

- Production build works under `/kakarayan/`.
- English and Traditional Chinese shell has no missing strings.
- Keyboard navigation and responsive layout pass smoke tests.

### Phase 6: Catalogue and metadata views

- Implement home.
- Implement corpus explorer and detail.
- Implement language explorer and detail.
- Implement release selector.
- Implement rights and citation views.
- Implement methodology, format guide, and about pages.

Exit condition:

- Every corpus and language is reachable.
- Counts and download links derive from manifests, not hard-coded values.

### Phase 7: Concordance and dictionary

- Implement query-state parsing/serialization.
- Implement scope and tier filters.
- Implement search Worker and cancellation.
- Implement concordance results.
- Implement dictionary grouping and examples.
- Implement interlinear expansion.
- Implement audio playback.
- Implement result sorting, sampling, and pagination/virtualization.
- Implement scoped frequency, distribution, n-gram, and collocation summaries.
- Port shared golden search behavior.

Exit condition:

- All search modes and filters work across the full generated data.
- Shared URLs reproduce searches.
- Stale asynchronous results cannot overwrite newer queries.

### Phase 8: Dataset builder and browser exports

- Implement staged selection workflow.
- Implement field/tier chooser.
- Implement preview and schema view.
- Implement size/memory estimation.
- Implement CSV, TSV, JSON, JSONL, Parquet, text, manifest, and recipe outputs.
- Implement optional safe XLSX/ZIP only if size and browser tests pass.
- Implement prepared-package fallback.
- Implement cancellation and progress.

Exit condition:

- Representative small and medium exports round-trip.
- Oversized selections are blocked before browser failure.
- Every export contains provenance.

### Phase 9: Specialist prepared formats

- Implement XLSX.
- Implement CLDF mappings and validation.
- Implement EAF for compatible aligned data.
- Implement TextGrid for compatible aligned data.
- Implement VTT/SRT for compatible aligned data.
- Implement interlinear/plain text.
- Implement audio manifest.
- Document applicability and loss.

Exit condition:

- Each claimed format has a validator, tests, documentation, and at least one real compatible
  corpus artifact.
- Incompatible selections show precise reasons.

### Phase 10: Automation

- Implement CI.
- Implement Pages assembly and deployment workflow.
- Implement data publication workflow.
- Pin actions and minimize permissions.
- Add deterministic caching.
- Add dry-run release build.
- Add artifact and Pages size reports.
- Add immutable draft-release publication, atomic Pages assembly, post-deployment smoke
  checks, and documented rollback.

Exit condition:

- Pull requests build and validate without publishing.
- A local or non-production dry run produces the exact Pages and Releases layouts.
- Main-only deployment guards are tested by workflow inspection and CI.

### Phase 11: Hardening

- Run full corpus build.
- Run all automated tests.
- Run cross-browser tests.
- Run accessibility scans and manual checks.
- Run performance benchmarks.
- Audit dependencies and licenses.
- Validate every link, manifest, checksum, and archive.
- Review English and Traditional Chinese copy.
- Review rights display.
- Verify no private path or data appears in output.

Exit condition:

- Every release gate in this plan is satisfied or a genuine external blocker is documented.

### Phase 12: Documentation and pull request

- Update `README.md` with static-site development and publication commands.
- Document data contracts, formats, rights, and architecture.
- Include exact local reproduction steps.
- Include maintainer setup for GitHub Pages if needed.
- Review the complete diff.
- Remove debug code, generated output, dead dependencies, and accidental files.
- Commit remaining coherent changes.
- Push the single feature branch.
- Open one draft pull request against `main`.
- Include scope, screenshots, architecture, generated-data metrics, validation, known external
  blockers, and post-merge deployment behavior.
- Mark ready for review only when implementation is complete.

Exit condition:

- The PR is merge-ready.
- The implementing engineer does not merge it.

## 23. Agentic implementation loop

For every phase:

1. Re-read the relevant plan section.
2. Inspect current code and generated evidence.
3. Select the smallest coherent vertical slice.
4. State concrete acceptance checks for that slice.
5. Implement production behavior.
6. Add or update tests.
7. Run the narrowest relevant checks.
8. Fix root causes.
9. Run the broader impacted checks.
10. Inspect the diff for unintended changes.
11. Commit the coherent slice to the feature branch.
12. Record measured results or decisions in documentation.
13. Select the next incomplete slice.

Do not batch weeks of unverified work into one final test run.

Do not reduce scope merely because a phase is difficult.

When blocked:

- Gather evidence.
- Try safe alternatives within the architecture.
- Distinguish code blockers from governance or source-data blockers.
- Continue independent work.
- Ask the maintainer only when a decision changes rights, public behavior, or architecture
  materially.

### 23.1 Durable progress and context-recovery protocol

This is a long-running implementation. Do not rely on conversation memory.

At the start of every resumed session or after context compaction:

1. Read `GOAL.md`.
2. Read this implementation plan.
3. Read `IMPLEMENTATION_STATUS.md`.
4. Run `git status --short --branch`.
5. Inspect the recent feature-branch commits.
6. Verify the last recorded checks against the current commit.
7. Resume the first incomplete acceptance item; do not restart completed work.

After every coherent commit, update `IMPLEMENTATION_STATUS.md` with:

- Current branch and commit.
- Completed plan phases and definition-of-done items.
- Exact commands that most recently passed.
- Full-data artifact sizes and performance measurements when available.
- Open failures classified as code, source-data, governance, or external-service issues.
- The next smallest concrete slice.

Keep evidence in repository files or reproducible command output, not only commentary.

If a build is interrupted, inspect and validate partial output before deleting or resuming
it. Generated output remains disposable; source and reviewed metadata do not.

Never mark a phase complete because code exists. Mark it complete only after its exit
condition and recorded checks pass.

### 23.2 Upstream synchronization and conflict safety

The branch begins from the Kakarayan commit recorded in Git history, but `main` may advance
during a long implementation.

- Fetch `origin` periodically and before opening the PR.
- Do not reset or discard work to match upstream.
- Do not overwrite unrelated maintainer changes.
- If the branch has not been shared, a clean rebase is acceptable after inspecting the diff.
- If the branch has been pushed or shared, prefer a non-destructive merge unless the
  maintainer explicitly authorizes rewriting history.
- Re-run all impacted checks after resolving conflicts.
- Re-review permissions and deployment guards if upstream workflow files changed.

### 23.3 Blocker and persistence policy

Licensing approval, Pages repository settings, external terminology review, or remote
service availability may require maintainer action.

An external blocker does not authorize stopping independent implementation.

- Finish all code, fixtures, tests, generated dry runs, documentation, and PR preparation
  that do not depend on the blocked decision.
- Record the exact blocker, evidence, owner, and smallest required action.
- Provide a safe default that does not publish or redistribute ambiguous material.
- Do not substitute a different architecture or silently reduce scope.
- Do not declare the whole implementation complete while a required definition-of-done
  item remains blocked.
- Do not repeatedly ask the same question when no new evidence exists.

## 24. Testing commands and developer experience

The final repository must offer a small documented command surface.

Target commands may be exposed through documented package scripts, a Makefile, or a task
runner, but avoid redundant wrappers.

At minimum provide commands for:

- Install/sync all dependencies.
- Run existing Django checks.
- Run publisher checks.
- Run frontend unit checks.
- Run Playwright.
- Build fixtures.
- Build full data.
- Build the production Pages artifact.
- Dry-run release artifacts.
- Serve the exact production build locally under the project subpath.
- Verify determinism.
- Verify checksums.

A new contributor should not need to infer command order from workflow YAML.

## 25. Pull request expectations

The single pull request must explain:

- The user problem.
- Why the architecture is static.
- How Kakarayan's existing work is preserved.
- How canonical FormosanBank data flows into derived artifacts.
- Search/index design.
- Browser export limits.
- Rights behavior.
- Pages and Releases storage split.
- Application and data versioning.
- Security and privacy.
- Accessibility.
- Tests and validators.
- Full-data metrics.
- Performance and storage measurements.
- Screenshots at desktop and mobile sizes in both interface languages.
- Local reproduction steps.
- Post-merge Pages setup or release steps.
- Any external governance blocker such as the missing code-license decision.

The PR must not claim a live production deployment before it has been merged and deployed
from `main`.

## 26. Definition of done

The implementation is complete only when all of the following are true:

- Work exists only on the dedicated feature branch.
- One pull request contains the complete implementation.
- The existing Django application remains intact and passing its baseline checks.
- The static application production build succeeds.
- It runs correctly at the `/kakarayan/` project path.
- Every public, valid corpus is represented.
- Every display language is represented distinctly.
- Every corpus/language has reviewed presentation metadata and source evidence.
- English and Traditional Chinese are complete.
- Corpus and language discovery are complete.
- Concordance and dictionary modes are complete.
- Scoped linguistic summaries and their exports are complete.
- Search modes and filters are complete.
- Interlinear display and source provenance are complete.
- Dataset-builder selection, preview, estimation, and download are complete.
- Browser export formats listed as required are complete.
- Prepared release formats listed as required are complete or applicability-gated honestly.
- Canonical XML downloads preserve original bytes.
- Generated relational artifacts reconcile with source counts.
- Search results pass shared golden cases.
- All manifests and schemas validate.
- Checksums validate.
- Two clean builds from identical inputs produce identical checksums.
- All applicable specialist formats validate.
- Rights and citations are visible and machine-readable.
- Central, corpus, component, AI-use, TDM, and community notices are preserved.
- No private data or private path is present.
- No runtime backend or database is required.
- No paid service is required.
- Pages artifact and shard budgets are satisfied.
- Typical search and memory budgets are satisfied.
- Accessibility requirements are verified.
- Browser compatibility is verified.
- CI is green.
- Pull requests do not publish.
- Main-only deployment guards are present.
- Data releases are immutable, Pages deployment is atomic, and rollback is documented.
- Historical prepared-only releases are distinguished from the current interactive release.
- Documentation allows a new contributor to reproduce the build.
- `IMPLEMENTATION_STATUS.md` accurately records the final verification state.
- The full diff has been reviewed and cleaned.
- The PR is opened but not merged.

## 27. Explicit non-goals

This pull request does not:

- Create a user account system.
- Store saved searches on a server.
- Collect analytics.
- Accept private corpora.
- Edit canonical FormosanBank data in the browser.
- Replace FormosanBank's QC process.
- Provide semantic/embedding/AI-generated search or annotation.
- Provide server-side arbitrary export jobs.
- Clip or transcode large audio collections in the browser.
- Guarantee availability of externally hosted media.
- Fabricate linguistic annotations absent from the source.
- Assign corpus or code licenses without maintainer authority.
- Merge itself into `main`.

## 28. Final handoff rule

If there is a conflict between a convenient implementation and these core principles:

1. Preserve canonical data and provenance.
2. Preserve rights and attribution.
3. Preserve zero-backend operation.
4. Preserve research correctness.
5. Preserve accessibility and usability.
6. Prefer measured simplicity over speculative infrastructure.

Return to [`GOAL.md`](GOAL.md) for the concise execution contract and completion loop.
