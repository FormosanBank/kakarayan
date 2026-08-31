# Search semantics

Kakarayan v1 has one matching contract for publication, API queries, and reproducible
exports.

## Normalization

- All searchable text is normalized to Unicode NFC.
- Case-insensitive matching uses Unicode case folding.
- Orthographic forms retain diacritics, apostrophes, and internal punctuation. Surrounding
  whitespace and punctuation are removed.
- Translation and gloss text collapses repeated whitespace and removes surrounding
  punctuation. Internal punctuation and characters are preserved.
- Empty normalized queries are invalid.

Displayed tier values are never replaced by these keys. Original, standardized, and
alternate `FORM` text is copied from the pinned XML, including punctuation. Token and
frequency views keep both the selected surface spelling and its normalized key. The selected
surface uses standard `FORM`, then original, then alternate as fallbacks. As a result,
`word` and `word,` remain visibly distinct source strings but share one normalized frequency
key.

The executable golden cases are in `tests/fixtures/search-semantics.json`.

## Match modes

- `exact`: the complete normalized value equals the normalized query.
- `prefix`: the complete normalized value starts with the normalized query.
- `contains`: the normalized value contains the normalized query.

These definitions apply in both directions. A Formosan-direction sentence query searches
original, standardized, and alternate `FORM` values at S, W, and M levels, plus the selected
token projection. Dictionary lookup searches the token projection and owner-level W and M
`FORM` values. A translation-direction query searches S, W, and M `TRANSL` values tagged
with the requested XML language. Reverse dictionary results place a matching source
translation first so the displayed evidence and query highlight agree with the match.
When a concordance match exists only below the sentence level, its bounded summary evidence
shows the matching tier and value so the collapsed result can highlight what matched.

The Lookup page and landing-page lookup use the same dictionary and concordance routes. The
Dataset Builder uses the same sentence candidate matcher; W and M datasets apply the same
normalization directly to `FORM` or `TRANSL` values owned by the selected XML level. The
interface presents the Formosan language plus every available translation language in one
search-language selector while retaining the Formosan language as the result scope.

Regex and fuzzy matching are not part of the v1 contract. They can only be added after
representative relevance and performance testing.

## Scope

Every query requires one FormosanBank display-language identifier. Corpus, dialect,
translation-language, audio, and linguistic-tier filters narrow that language scope. Results
are ordered by stable source and record identifiers and paginated with a query-bound cursor.
