# Rights, citation, and privacy

FormosanBank combines material from different sources. Kakarayan preserves central,
corpus-specific, component, citation, community, and upstream terms rather than assigning
one blanket license to every record.

## Rights records

Each corpus has a machine-readable rights entry with a stable ID, redistribution and
commercial-use decisions, attribution, evidence URLs, notes, review status, and review
date. Supported publication states are:

- `allowed`
- `restricted`
- `metadata_only`
- `review_required`

The public repository profile is noncommercial. A more specific reviewed source notice can
make a corpus stricter. Publication fails closed when an applicable decision is unreviewed
or does not permit the requested artifact scope.

Review evidence in this order:

1. Record or component notice.
2. Corpus README, dataset card, license, or source notice.
3. Central FormosanBank terms, addenda, and notices.
4. Project-level public-repository policy.

The most specific stricter evidence controls.

## Publication scopes

Every artifact records its rights IDs, publishability, and blocking reasons. Production
requires approved rights for:

- `site-metadata` for the small public catalogues;
- `release-core` for the immutable query read model and provenance core;
- `prepared-download` for research packages.

The query API serves only a published and activated release. The UI repeats the applicable
corpus rights and citations for records and downloads. These checks support responsible
publication but are not legal advice.

## Project license

Kakarayan's original software, documentation, interface text, and project-produced assets
use [CC BY-NC 4.0](../LICENSE.md) unless a file or directory states otherwise. Canonical
FormosanBank records and third-party materials retain their own terms. Kakarayan cannot
grant rights that FormosanBank or an upstream source does not hold.

## Citation

A reproducible citation should include:

- Kakarayan and the release ID;
- the exact FormosanBank source commit;
- corpus name and supplied corpus citation;
- source path and record ID for a quoted example;
- access date for the changing public interface;
- artifact filename and SHA-256 for downloaded data.

Suggested generic form:

```text
FormosanBank contributors. Kakarayan release <release-id>, derived from
FormosanBank commit <commit>, corpus <corpus>, record <record-id>, <source-path>.
Accessed <date>.
```

This does not replace corpus-specific attribution. Preserve all supplied citation and
copyright notices.

## Corrections and takedowns

Open a Kakarayan issue for transcription, language, dialect, translation, attribution,
sensitive-data, rights, or takedown concerns. Include the release ID, corpus, source path,
record ID, and a concise description.

Do not post private personal information in a public issue. Ask a FormosanBank maintainer
for a private channel when the report itself is sensitive. Maintainers may withdraw an
asset or release when required, while recording a non-sensitive reason. A later correction
does not silently rewrite the provenance of an earlier immutable release.

## Browser-local data

Kakarayan has no learner accounts and sends no deck history to its query API.

Stored locally:

- saved corpus cards;
- review state;
- interface preferences.

Recordings remain in the active tab unless the user downloads them or explicitly submits
one to ASR. Microphone access requires a user action and browser permission. Users can
export a deck backup; clearing site storage removes unexported local data.

## External models

Optional MT and ASR actions send only the chosen text or audio directly to the named public
Hugging Face service after consent. The interface identifies the provider, the transferred
data, possible provider logging, and the risk of incorrect output.

Kakarayan does not proxy or store model input. Cancellation stops the browser request but
cannot promise deletion of bytes already received by the provider.

## Query privacy and security

The query API is public, read-only, release-scoped, and bounded. It opens an activated
SQLite database in immutable read-only mode and uses fixed parameterized SQL. It has no
accounts, write route, arbitrary SQL, user-controlled URL fetch, upload, or regular
expression route.

Operational records include the route template, status, duration, response size, and
release ID. They do not include the URL query string, raw query, sentence text, recording,
or model input. CORS uses exact configured origins without credentials.

The service worker caches only the small application shell and static metadata. It does not
cache query responses, audio, downloads, or model requests.

## Security reports

Use the private GitHub security advisory form linked from [SECURITY.md](../SECURITY.md) for
software vulnerabilities. Use the correction and takedown process above for corpus or
rights issues.
