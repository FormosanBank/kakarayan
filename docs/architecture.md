# Architecture

## Decision summary

Kakarayan uses a static-first architecture because the public corpus, catalogue, and common
learner workflows do not require a mutable server. GitHub Pages provides the application
shell, versioned metadata, and compressed search shards. GitHub Releases hold large research
packages. A no-cost Hugging Face Docker Space may expose a read-only API over the same
release, but it is never required for core use.

This design gives the project:

- No required hosting bill.
- No accounts, server sessions, or server-side study records.
- A reproducible relationship between a public source commit and every derived file.
- A usable fallback when Hugging Face services sleep or fail.
- A narrow security boundary for the optional API.

## Trust and source boundaries

The canonical input allowlist is public FormosanBank material:

- `Corpora/<Corpus>/XML/**/*.xml`
- `dialects.csv`
- Reviewed public orthography conversion tables
- Public repository terms and notices
- Public Hugging Face organization metadata when explicitly refreshed

The publisher rejects a dirty checkout, a non-FormosanBank origin, a commit mismatch,
symlinked XML, malformed XML, entity expansion, and network access from XML parsing. Private
repositories and private training data are outside the build boundary.

Kakarayan does not write back to FormosanBank. It does not reconstruct archival XML from
normalized tables. Canonical XML packages contain the exact public source bytes and paths.

## Data flow

```text
public FormosanBank commit
          |
          v
safe XML projection and reviewed metadata
          |
          +--> normalized SQLite and relational tables
          +--> compressed browser search shards
          +--> static API catalogues
          +--> prepared linguistic packages
          +--> rights, checksums, and release manifests
                         |
              +----------+-----------+
              |                      |
              v                      v
      GitHub Pages site       GitHub data release
                                      |
                                      v
                         optional read-only API Space
```

Each build records the 40-character FormosanBank commit, a release ID derived from that
commit and its timestamp, artifact sizes, SHA-256 values, rights IDs, and format summaries.

## Static application

The application is React 19, strict TypeScript, and Vite. It uses a small internal hash
router so all routes work at the GitHub Pages project path without rewrite rules.

The application loads the release metadata and catalogue files together. It refuses to show
a partial release when release IDs disagree. Search shards load only after the user chooses
a language and optional corpus. Shards are capped at 1,000 records and are gzip-compressed.
Both compressed and uncompressed SHA-256 values are recorded because web hosts differ in
whether they transparently decode `.gz` responses.

Common exact, prefix, translation, phonology, and gloss searches use these scoped shards.
Fuzzy work is bounded by a documented Unicode edit distance and record cap. User patterns
compile through RE2JS, a non-backtracking engine, only after language and corpus scope
limits are checked. The browser never evaluates a pattern as JavaScript.

Each language and corpus scope has a checksummed vocabulary index for source-exact,
normalized source, translation, phonology, gloss, and RE2 candidate selection. Postings
name deterministic shard parts. Common queries scan the compact vocabulary and download
only candidate record shards, then recheck every record before display. An empty posting
set produces an immediate empty result without downloading sentence records.

The dataset builder preflights shard transfer and decoded size before reading data. It caps
rows, refuses unsafe scopes, and preserves deterministic source order. Linguistic summaries
run in a dedicated Worker and cap the record count. DuckDB-Wasm is a separate lazy chunk
used only for bounded Parquet export, so the initial route does not load its 39 MiB
single-threaded module. None of these paths requires cross-origin isolation or a backend.

The service worker is additive. Network access remains authoritative, successful responses
are cached, and the shell may be used offline after a prior visit. Failure to register the
service worker does not prevent normal use.

## Browser storage

IndexedDB stores saved study cards, review state, and local recordings. Preferences use
browser-local state. Kakarayan has no synchronization account and no analytics endpoint.

Backups are explicit JSON downloads. Imports validate their version and contents. Anki TSV
and tabular exports protect formula-like leading characters before opening in spreadsheet
software.

## Publisher

The publisher uses a normalized SQLite database as its internal read model. It streams CSV
and JSON Lines during XML projection, creates search and prepared formats from the immutable
database, packages large directories as soon as they are complete, and removes transient
files to bound disk use.

Stable IDs combine source scope and source identity instead of trusting XML-local IDs to be
globally unique. The normalized model preserves:

- Corpus, source path, local XML ID, and ordinal.
- Text, sentence, word, and morpheme containment.
- Repeated FORM, PHON, TRANSL, and AUDIO tiers in source order.
- Original and standard form labels.
- Raw attribute maps and inline mixed-content structure.
- Raw and parsed timing, duration, and availability.
- Corpus, language, dialect, source, citation, and copyright context.

Release verification checks the schema, exact file set, every size and checksum, SQLite
integrity, gzip integrity, uncompressed shard checksums, and shard record counts.

## Large-file split

GitHub Pages receives only:

- The application shell and assets.
- Static JSON catalogues.
- The compressed search shards.

It does not receive SQLite, normalized bulk tables, canonical XML archives, or prepared
linguistic packages. The project budget is 900 MiB total and 50 MiB per file.

GitHub Releases receive approved bulk packages and the SQLite snapshot. The generated
download catalogue points to immutable `data-<release-id>` assets.

## Optional live API

The FastAPI service reads one immutable SQLite snapshot. Startup requires a local or HTTPS
manifest, validates the named database size and SHA-256, runs SQLite integrity checks, and
opens the database in immutable read-only mode.

The service exposes fixed query templates only. It has no write routes, arbitrary SQL,
regular expressions, user-provided remote URLs, or uploads. Query lengths, page sizes,
cursors, SQLite steps, CORS origins, and download size are bounded.

Health does not imply readiness. `/healthz` confirms the process is alive; `/readyz`
confirms a verified release is available.

## Preserved Django application

The earlier Django/PostgreSQL application stays under `corpus/` and `config/`. It remains a
useful server-backed dictionary implementation and tests established normalization and
search behavior. The public Pages architecture does not depend on it, and the publisher
does not treat its relational model as an archival representation.

CI runs the legacy suite with PostgreSQL 16 to prevent regressions.

## Key design decisions

1. Canonical XML remains authoritative.
2. Static access is the core contract; the live API is a convenience.
3. Public visibility is not treated as redistribution permission.
4. Unknown rights fail closed at publication, not at source discovery.
5. Original and standardized forms never overwrite each other.
6. Display language identity is not keyed by ISO code alone.
7. Browser exports are bounded selections; large formats are prepared offline.
8. Local learning state stays local unless a user explicitly downloads a backup.
9. Model calls go directly from the browser to the named provider after consent.
10. Pull requests can validate but cannot deploy.
11. Descriptive summaries never become claims about speakers or grammaticality.
12. Reviewed learning content fails closed when authorship, review, citation, or rights
    metadata is absent.
