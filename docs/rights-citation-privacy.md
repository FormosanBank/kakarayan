# Rights, citation, and privacy

## Rights are data

FormosanBank contains material from different sources with different terms. Kakarayan uses
the public FormosanBank repository as the approved source set for noncommercial
distribution, while preserving central, corpus, upstream-source, citation, and community
terms.

Kakarayan keeps a machine-readable rights entry per corpus. Each entry records:

- A stable rights ID and corpus name.
- Redistribution status.
- Commercial-use status.
- Attribution text.
- License expression when one is supported by evidence.
- Evidence URLs.
- Notes.
- Review status and review date.

Current status values are intentionally explicit:

- `allowed`
- `restricted`
- `metadata_only`
- `review_required`

Each corpus discovered in the canonical public checkout defaults to `allowed`,
`noncommercial`, and `reviewed` for Kakarayan publication. A reviewed entry in
`publisher/metadata/rights.json` may apply a stricter rule. Artifacts fail closed when such
an override is unreviewed or does not allow redistribution.

## Evidence precedence

Reviewers should apply the most specific applicable evidence:

1. Record or component notice.
2. Corpus README, dataset card, license, or source notice.
3. Central FormosanBank terms, AI-use addendum, and notices.
4. The project-level public-repository noncommercial profile.

Stricter specific evidence is not weakened by a general repository notice.

## Publication behavior

Every artifact records the rights IDs it contains, whether it is publishable, and the exact
blocking reasons. Browser download controls show those states.

Production workflows require approved decisions for their artifact scope:

- Pages checks `site-query-data`.
- Data publication checks `site-query-data`, `release-core`, and `prepared-download`.
- The optional API accepts only a published data release.

This is a technical safety gate, not legal advice. A reviewer remains responsible for the
encoded conclusion.

Canonical packages include exact source XML, source paths, a source manifest, and the
applicable rights entry. Prepared multi-file formats include a package note and metadata.
Audio exports contain references unless separate rights allow redistribution of media.

## Kakarayan license

Kakarayan's original software, documentation, interface text, and project-produced assets
use [CC BY-NC 4.0](../LICENSE.md) unless a file or directory says otherwise. Canonical
FormosanBank records and third-party material retain their supplied terms. The Kakarayan
license cannot grant rights FormosanBank does not hold, and a stricter source-specific term
controls for the affected material.

## Citation

A reproducible citation should include:

- Kakarayan.
- FormosanBank.
- The Kakarayan release ID.
- The exact FormosanBank source commit.
- The corpus name and its supplied citation.
- Source path and record ID for quoted examples.
- Access date for a changing public interface.
- The checksum and filename for a downloaded artifact when relevant.

Suggested generic form:

```text
FormosanBank contributors. Kakarayan release <release-id>, derived from
FormosanBank commit <40-character-commit>, corpus <corpus>, record <record-id>,
<source-path>. Accessed <date>.
```

This template does not replace corpus-specific attribution or citation text. Preserve all
citations and copyright notices supplied by the source.

## Corrections and takedowns

Open a Kakarayan GitHub issue for a transcription correction, language or dialect label,
translation concern, attribution problem, sensitive item, rights question, or takedown
request. Include:

- Release ID.
- Corpus.
- Source path.
- Record or XML ID.
- A concise description.

Do not post private personal information in a public issue. If the report itself is
sensitive, contact a FormosanBank maintainer through the contact method listed by the
organization or repository.

Removing material from a future release must not rewrite the provenance record of a prior
immutable release. Maintainers may withdraw a published asset or release when required and
should record the reason without exposing sensitive detail.

## Browser privacy

Kakarayan does not require accounts and does not send study history to a Kakarayan server.

Stored locally:

- Saved corpus cards.
- Spaced-repetition state.
- Interface preferences.

Recordings remain in the active browser tab unless the user downloads them. Users can
export a card backup and delete browser storage through their browser. Clearing site data
removes local study records unless the user downloaded a backup.

Microphone access begins only after a user action and browser permission. Recordings stay
on the device until the user explicitly invokes an optional ASR action. The recording tool
supports local playback, download, and deletion.

## Third-party model requests

Optional MT and ASR actions send only the selected text or audio directly from the browser
to the named public Hugging Face Space. Before the first request, the interface identifies:

- The provider and service.
- What data will leave the browser.
- That the service may log infrastructure metadata under its own terms.
- That output may be incorrect.

Kakarayan does not proxy, store, or log the request. Canceling stops the browser request but
cannot promise deletion of data already received by a third party.

## Security posture

The static site has no authentication or privileged backend. Its content security policy
limits sources required by the application and optional model calls.

Browser regular-expression search uses a bounded RE2 implementation rather than the native
backtracking expression engine. Pattern length, record scope, and result count are capped.
DuckDB-Wasm runs in a local Worker only for bounded export and receives no network URL from
the user.

The live API:

- Downloads only from a configured HTTPS release manifest.
- Enforces response and database size limits.
- Verifies checksums before use.
- Opens SQLite immutable and read-only.
- Uses fixed SQL templates and bounded query steps.
- Uses exact CORS origins.
- Has no user URL fetch, write route, arbitrary SQL, regex, or upload.
- Disables access logs to avoid recording query text.

Publication actions are pinned, production environments can require approval, and secrets
are available only to the manual Space deployment job.

## Project-scoped web signals

A GitHub Pages project cannot control the root of `formosanbank.github.io`. Project-scoped
robots, text-and-data-mining, or rights files cannot truthfully claim control over the
whole origin.

If organization-wide signals are required, the owner of the organization site or a custom
domain must install them at the origin root. Kakarayan should document that external action
and continue to carry rights metadata in its own manifests and pages.
