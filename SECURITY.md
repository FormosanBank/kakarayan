# Security policy

## Supported code

Security fixes target the current `main` branch and the currently published site, data
release, and required query API.

## Report a vulnerability

Use the repository's private
[GitHub security advisory form](https://github.com/FormosanBank/kakarayan/security/advisories/new)
when available. Include the affected commit or release, impact, reproduction steps, and a
safe proof of concept.

Do not include credentials, private corpus material, personal information, or an active
exploit in a public issue. If private reporting is unavailable, open a minimal issue asking
a maintainer for a private contact channel without disclosing the vulnerability.

For a corpus correction, attribution concern, rights request, or takedown, follow
[`docs/rights-citation-privacy.md`](docs/rights-citation-privacy.md) instead.

## Security boundaries

- The site has no Kakarayan account, session, or privileged write API.
- Saved cards and recordings stay in browser storage unless a user explicitly invokes a
  named third-party model service.
- The query API is read-only and starts only from an explicitly activated release. Full
  checksum and SQLite integrity verification occur before process startup.
- Query work, page size, custom export rows, and export bytes are bounded.
- Operational records contain route templates and durations, not raw queries, sentence
  text, recordings, or model input.
- Pull requests do not receive production deployment secrets.
- Published data remains subject to FormosanBank and corpus-specific rights.
