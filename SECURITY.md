# Security policy

## Supported code

Security fixes target the current `main` branch and the currently published static site,
data release, and optional API release.

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

- The GitHub Pages site has no Kakarayan account or privileged backend.
- Saved cards and recordings stay in browser storage unless a user explicitly invokes a
  named third-party model service.
- The optional API is read-only and starts only after release checksum and SQLite integrity
  verification.
- Pull requests do not receive production deployment secrets.
- Published data remains subject to FormosanBank and corpus-specific rights.
