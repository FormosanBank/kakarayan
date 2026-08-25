# Data and formats

FormosanBank XML is the canonical source. Kakarayan artifacts are immutable projections of
one clean, pinned public FormosanBank commit.

## Release contents

One full publication contains three groups.

### Query read model

`formosanbank.sqlite.gz` is the compressed read-only database activated by the query
service. Its manifest records both compressed and expanded sizes and SHA-256 values. It is
not downloaded by ordinary browsers.

The schema represents texts, sentences, words, morphemes, forms, phonology, translations,
audio references, tokens, and publication metadata. Search-ready canonical columns follow
[search-semantics.md](search-semantics.md).

### Static site metadata

`site-metadata.zip` contains only the small `api/v1/*.json` documents required by Pages. It
has strict file-count, member-size, expanded-size, path, symlink, schema, and release-identity
checks. It contains no corpus search records.

### Prepared research downloads

Prepared downloads are intended for complete or large-scale analysis. The curated public
set includes normalized tabular packages, the SQLite read model, and specialist formats
produced by `publisher/prepared.py`. Canonical XML remains available in FormosanBank. The
Downloads page shows sizes, checksums, included tiers, rights, and citation evidence.

The production release exposes 11 curated downloads. Hierarchical JSONL partitions are
bundled into one archive. Corpus-specific canonical XML is not duplicated in the Kakarayan
release.

The time-alignment package stores every valid sentence timing and media reference in one
JSONL table. It also includes EAF, WebVTT, and SRT files for media with multiple cues, plus
TextGrid when those cues do not overlap. A one-cue clip stays in the JSONL table because
six separate interchange files add no alignment information. Audio bytes are never copied
into the package.

Prepared Parquet remains available when published. Kakarayan does not load an analytical
database runtime into the browser to create custom Parquet files.

## Interactive datasets

The Research builder calls the API for a bounded preview and a finite export. It supports:

- one Formosan language;
- optional corpus and dialect scope;
- Formosan or reverse-translation queries;
- exact, prefix, or contains matching;
- sentence (`S`), word (`W`), and morpheme (`M`) row levels;
- separate selected columns for each level;
- complete-row filtering, where every selected optional tier must exist on its owner;
- 1 to 100,000 rows per selected level;
- CSV, TSV, or JSON Lines.

Each preview returns at most 250 rows. A single level downloads as one table. Two or three
levels download as a ZIP containing one table per level and a manifest. The API streams
rows and ZIP members instead of keeping the completed download in server or browser memory.
Use a prepared artifact when the complete corpus or more than 100,000 rows per level is
needed.

## Column meanings

Identity and ancestry columns include `id`, `xml_id`, `parent_id`, `text_id`,
`sentence_id`, `word_id`, and `position`. Only ancestry columns that apply to the selected
level are offered.

Tier columns include `form`, `standard`, `original`, `alternate_forms`,
`translation_columns`, `phonology`, `audio`, and `unclear`. Values come only from the row
owner. A word translation is never placed in an S row, and a morpheme gloss is never placed
in a W row. `form` uses standard, original, then alternate FORM as a display fallback while
the three source fields remain separately selectable.

Selecting `translation_columns` expands the TRANSL elements found in the exact returned row
window into deterministic columns such as `translation_eng_1`, `translation_eng_2`, and
`translation_zho_1`. XML language tags determine the middle component. Repeated TRANSL
elements in one language retain XML order through the numeric suffix. Every output row has
the same headers and an empty cell when that owner lacks a particular language or
occurrence. `complete_fields=true` requires at least one owner-level TRANSL element, not a
value in every generated language column. A selection that would produce more than 256
TRANSL columns is rejected as too wide.

The packed `translations` field remains in API v1 for existing clients. It joins values as
`xml_lang:text` with ` | ` separators and is not offered by the visual Dataset Builder.

Sentence-only columns are `tokens`, `token_count`, and `source`. W and M rows may include
`class` and `sclass`. Provenance columns are repeated on every level: `language_id`,
`corpus_id`, `dialect`, and `source_path`.

The same wide-column serializer supplies preview rows, API exports, and recipe execution.
CSV and TSV
exports escape cells that spreadsheet software could interpret as formulas.

## Export recipes

A downloaded recipe records the exact release, selected XML levels, columns for each level,
complete-row behavior, output format, and spreadsheet-safety policy. It validates against
`schemas/export-recipe.schema.json`.

Execute a recipe against the matching full release directory. Recipe execution verifies and
activates that release's SQLite database in a temporary directory, then uses the same query
and streaming serializer as the web API:

```bash
uv run python -m publisher.recipes \
  --release build/data-release \
  --recipe path/to/recipe.json \
  --output build/recipe-output.zip
```

The release ID is required to match. A one-level recipe writes one table. A multi-level
recipe writes a deterministic ZIP. Repeating the same recipe against the same immutable
release produces byte-identical output.

## Provenance and verification

`release-manifest.json` is authoritative for release contents. `SHA256SUMS` is derived from
its sorted artifact list. Each artifact records scope, rights IDs, publishability, format,
language and corpus coverage, tiers, media type, size, and checksum.

Verify a local release before use or publication:

```bash
uv run python -m publisher.verify_release --release build/data-release
```

Verification rejects unsafe paths, unexpected files, duplicate assets, checksum or size
mismatches, invalid schemas, invalid SQLite, and requested rights scopes that are not
publishable.

## Audio

Audio fields are evidence references. A download includes media only when the release
artifact and its rights decision explicitly allow redistribution. Otherwise Kakarayan
preserves locators, offsets, and provenance without silently copying source media.

## Versioning

Schema version `1.0.0` defines the current release, static API, recipe, and query contracts.
A breaking field or semantic change requires a new version. Adding another immutable data
release does not change the contract version.
