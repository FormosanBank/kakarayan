# Search semantics

Kakarayan v1 has one matching contract for publication, API queries, and reproducible
exports.

## Normalization

- All searchable text is normalized to Unicode NFC.
- Case-insensitive matching uses Unicode case folding.
- Orthographic forms retain diacritics, apostrophes, and internal punctuation. Surrounding
  whitespace and punctuation are removed.
- Translation and gloss text collapses repeated whitespace and preserves punctuation and
  characters.
- Empty normalized queries are invalid.

The executable golden cases are in `tests/fixtures/search-semantics.json`.

## Match modes

- `exact`: the complete normalized value equals the normalized query.
- `prefix`: the complete normalized value starts with the normalized query.
- `contains`: the normalized value contains the normalized query.

These definitions apply in both directions. A Formosan-direction query searches forms. A
translation-direction query searches translations or glosses in the requested translation
language.

Regex and fuzzy matching are not part of the v1 contract. They can only be added after
representative relevance and performance testing.

## Scope

Every query requires one FormosanBank display-language identifier. Corpus, dialect,
translation-language, audio, and linguistic-tier filters narrow that language scope. Results
are ordered by stable source and record identifiers and paginated with a query-bound cursor.
