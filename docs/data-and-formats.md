# Data model and formats

## Record hierarchy

The canonical hierarchy is:

```text
Corpus
  Text
    Sentence
      Word
        Morpheme
```

FORM, PHON, TRANSL, and AUDIO are repeatable tiers. Their sibling order is meaningful and
is retained. Translations and audio may attach at different linguistic levels.

Normalized tables include `texts`, `sentences`, `words`, `morphemes`, `forms`,
`phonology`, `translations`, `audio`, and `tokens`. The SQLite database also contains
publication metadata and common sentence and concordance views.

## Identity and provenance

XML-local IDs are not globally unique. Every published ID is deterministic and includes
source scope. Records retain the local XML ID, source-relative path, containment IDs, and
ordinal so a result can be traced to the pinned XML.

Language rows use a display identity. Seediq and Truku intentionally remain distinct even
though both use ISO 639-3 `trv`. Unknown dialect information is preserved rather than
guessed.

Canonical token counts follow the public FormosanBank QC convention: use the standard
sentence FORM with original fallback, split on whitespace, and count chunks containing a
Unicode letter or digit.

## Text representation

Source orthography and FormosanBank standard orthography are separate fields. A standard
form is not presented as the original transcription.

The projection preserves:

- Unicode text in NFC.
- Raw element attributes as deterministic JSON.
- Inline mixed-content markup as structured JSON.
- FORM kind and notes.
- Translation language, kind, version, and notes.
- Word and morpheme class metadata.
- Audio file, URL, source, raw start/end values, parsed seconds, duration, and availability.
- Explicit nulls where a source field is absent.

CSV and TSV use `\N` for null. JSON uses `null`. Formula-like spreadsheet cells are
prefixed safely in XLSX and browser-delimited exports.

## Release core

`release-manifest.json` is the central machine-readable inventory. It contains:

- Schema and release versions.
- Exact FormosanBank source commit.
- Recalculated counts.
- Format summaries.
- Every generated artifact path, media type, byte size, SHA-256, scope, rights IDs,
  publication status, and blocking reason.
- For the release-only profile, each unique flat GitHub asset name and immutable download
  URL.

`SHA256SUMS` exactly covers all manifest artifacts plus the manifest itself.

`catalog.json`, `rights.json`, `models.json`, and `orthography.json` are top-level copies of
the primary public catalogues. `formosanbank.sqlite.gz` is the GitHub Release profile of
the immutable live-API and power-user snapshot. Its manifest entry records checksums and
sizes for both the gzip asset and decompressed SQLite content.

## Prepared packages

### Canonical XML

One deterministic ZIP per corpus contains the exact XML bytes under their original
repository paths, plus a manifest, rights entry, source commit, and package note. This is
the only archival representation Kakarayan publishes.

### Relational tables

- `csv-tables.zip`: one UTF-8 CSV per normalized table.
- `tsv-tables.zip`: one UTF-8 TSV per normalized table.
- `flat-jsonl-tables.zip`: one JSON Lines table per normalized table.
- `parquet-tables.zip`: Zstandard-compressed typed Parquet with 50,000-row groups.
- `formosanbank.xlsx`: documented worksheets, a dedicated rights sheet, filters, frozen
  headings, safe cells, and readable widths.

Relational formats are best for R, Python, databases, joins, and corpus statistics.
Every multi-file relational package carries its package note, data dictionary, and rights
catalogue.

## Browser selections

The research workbench can export at most 10,000 sentence records. It supports CSV, TSV,
JSON, JSON Lines, Parquet, plain text, interlinear text, audio-reference TSV, and a
non-executable recipe. The user chooses fields before preview and export. Formula-like
values are protected in delimited files.

Parquet is produced locally through lazy, single-threaded DuckDB-Wasm. Its first use
downloads the large WebAssembly chunk, while other formats do not. The builder reports
compressed transfer, decoded input, row limits, and rights status before enabling a data
download. A recipe remains available when redistribution review blocks the data itself.

Summary tables provide source and normalized frequency, translation frequency, corpus and
dialect distribution, one- through five-token n-grams, bounded collocates, and deterministic
seeded sample IDs. The current browser summary cap is 50,000 sentences. Tables are
descriptive, use the release tokenization, and are exportable as CSV or JSON.

### Hierarchical JSON Lines

`prepared/jsonl/` contains per-language and corpus ZIP packages. Each member is capped at
20,000 sentence records. A sentence record nests its translations, tokens, and audio
references for streaming application use.

### CLDF Generic

`formosanbank-cldf.zip` is a conservative CLDF Generic dataset with a LanguageTable and
ExampleTable. A source text is reconstructed from tokens only when the sentence has no
usable FORM. Records with neither are excluded and counted.

The package does not claim the corpus is a dictionary, wordlist, grammar, or dependency
tree. The exporter streams rows rather than retaining the complete corpus in memory and
validates source fields larger than Python's default CSV field limit.

### Plain and interlinear text

`text-exports.zip` contains plain sentence text and a simple backslash-marker interlinear
projection. It is intended for reading, inspection, and basic text tools, not as a
replacement for canonical XML.

### Audio reference manifest

The metadata package includes a TSV of audio references and timing. Kakarayan does not
bulk-download or redistribute audio unless a separate reviewed rights decision permits it.

### Time-aligned formats

`time-aligned.zip` can contain:

- ELAN EAF
- Praat TextGrid
- WebVTT
- SubRip SRT

These packages reference source audio. They do not embed it. Timing-dependent files are
created only when usable finite, nonnegative timings exist. TextGrid is omitted for scopes
with incompatible overlaps. Omissions are counted rather than silently repaired.

### Metadata package

`metadata-and-audio.zip` includes the human-readable package note, data dictionary, Arrow
schemas, SQLite schema, audio manifest, JSONL manifest, and explicit format exclusions.

## Intentionally excluded formats

Kakarayan does not generate:

- CoNLL-U without source-backed dependency syntax.
- TEI without a reviewed lossless mapping.
- LIFT without a consistent lexical database source.
- FLEx or Toolbox projects without validated project or marker mappings.

Renaming columns is not a valid format mapping.

## Browser selection exports

Search results can be downloaded as CSV, TSV, JSON, JSON Lines, plain text, interlinear
text, audio references, or a reproducible recipe. Browser exports are bounded to the loaded
selection and are not a substitute for bulk packages.

Recipes are declarative JSON validated by `schemas/export-recipe.schema.json`. They pin the
release, query mode, language and corpus scopes, selected IDs, row bound, fields, output
format, and spreadsheet protection. They contain no executable code.

Execute a recipe against a compatible release:

```bash
uv run python -m publisher.recipe_cli \
  --release build/data-release \
  --recipe selection.recipe.json \
  --output selection.csv
```

The runner uses the build search file when present and otherwise streams the packaged
hierarchical JSONL.

## Choosing a format

- Preserve and audit the source: canonical XML.
- Analyze tables in R or Python: Parquet, CSV, or TSV.
- Load a complete queryable snapshot: SQLite.
- Stream sentence objects: hierarchical JSON Lines.
- Exchange a conservative standards-based example dataset: CLDF Generic.
- Annotate or inspect aligned material: EAF or TextGrid.
- Work with subtitles: WebVTT or SRT.
- Share a small search result: browser CSV/TSV/JSON.
- Reproduce a search selection later: export recipe.

Always retain the release ID, source commit, rights metadata, and checksum with derived
work.
