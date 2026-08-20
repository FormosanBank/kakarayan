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

The production release exposes 11 curated downloads. Hierarchical JSONL partitions used
by export recipes are bundled into one archive. Corpus-specific canonical XML is not
duplicated in the Kakarayan release.

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
- optional translation-language and evidence-tier filters;
- explicit selected columns;
- 1 to 1,000 rows;
- CSV, TSV, or JSON Lines.

The preview returns at most 25 rows. Export output is capped at 5 MiB. Users who need more
than those limits should choose a prepared artifact rather than asking a phone or API
process to materialize a full corpus selection.

## Column meanings

| Field | Meaning |
| --- | --- |
| `id` | Stable sentence identifier |
| `text_id` | Containing text identifier |
| `standard` | FormosanBank standardized sentence form |
| `original` | Source orthography without replacement |
| `translations` | All sentence translations with XML language tags |
| `language_id` | FormosanBank display-language identifier |
| `corpus_id` | Source corpus identifier |
| `dialect` | Source dialect label |
| `source_path` | Canonical public XML path |
| `tokens` | Ordered surface token sequence |
| `audio` | Audio file and URL references |
| `phonology` | Available phonological tiers |
| `glosses` | Word and morpheme translation tiers |

The same serializer supplies preview rows, API exports, and recipe execution. CSV and TSV
exports escape cells that spreadsheet software could interpret as formulas.

## Export recipes

A downloaded recipe records the exact release, selection, fields, output format, and
spreadsheet-safety policy. It validates against `schemas/export-recipe.schema.json`.

Execute a recipe against the matching full release directory:

```bash
uv run python -m publisher.recipes \
  --release build/data-release \
  --recipe path/to/recipe.json \
  --output build/recipe-output
```

The release ID is required to match. Selection limits remain finite. Repeating the same
recipe against the same immutable release produces byte-identical CSV, TSV, or JSON Lines
output.

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
