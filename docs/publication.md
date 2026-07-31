# Publication operations

## Required repository configuration

Before any production publication:

1. Maintainers approve and add a root `LICENSE` or `LICENSE.md`.
2. Corpus redistribution decisions are reviewed and encoded in the rights overlay.
3. GitHub Pages is configured to deploy from GitHub Actions.
4. The `github-pages` environment has the desired protection rules.
5. The `data-release` environment requires a maintainer approval.
6. For the optional API, create a public Hugging Face Docker Space.
7. Add environment variable `HF_SPACE_REPO` as `organization/space-name`.
8. Add environment secret `HF_TOKEN` with only the write scope required for that Space.
9. Protect the `hugging-face-space` environment.

The feature branch and pull request do not perform these external actions.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests, `main`, and feature branches.

It checks:

- Ruff formatting and lint.
- Mypy.
- Full pytest with PostgreSQL 16.
- Publisher determinism and release verification with invented fixtures.
- API container build.
- Frontend lint, types, unit tests, npm audit, build, and site budgets.
- Desktop and mobile Playwright routes, compressed search, and serious WCAG violations.
- JavaScript, Python, and R clients.
- Pull request dependency changes.

Actions and the PostgreSQL service image are pinned to immutable digests or commits.
Pull requests receive read-only repository permission and no deployment credential.

## GitHub Pages

`deploy-pages.yml` runs after a push to `main` or an explicit dispatch. A manual dispatch can
pin a public FormosanBank branch, tag, or commit. The workflow resolves that input to an
exact detached commit and records it in every output.

The workflow:

1. Checks the Kakarayan software-license prerequisite.
2. Validates the source ref syntax.
3. Fetches only the public FormosanBank repository.
4. Builds the site-only publication profile.
5. Refreshes public FormosanBank Hugging Face metadata.
6. Requires all `site-query-data` rights decisions to permit publication.
7. Requires the matching data release to be published and non-prerelease.
8. Imports and validates that release's prepared-download manifest.
9. Verifies the site release and assembles the Vite public tree.
10. Runs unit, audit, build, size, desktop, mobile, and accessibility checks.
11. Uploads one Pages artifact.
12. Deploys that exact saved artifact.

The build budget is 900 MiB total and 50 MiB for any one file. Bulk downloads never enter
the Pages artifact.

## Data release

`publish-data.yml` is manual and defaults to `dry_run: true`.

A dry run performs the full public-corpus build and all release verification with a
read-only token. It creates no release and transfers no large artifact to a write-enabled
job.

A real run additionally:

1. Checks the software license.
2. Requires site, core, and prepared artifact rights to permit publication.
3. Packs the exact validated output.
4. Transfers it to a separately permissioned `data-release` environment.
5. Verifies every byte and rights decision again.
6. Creates `data-<release-id>` as a draft GitHub release.
7. Uploads every manifest-named SQLite, metadata, and prepared asset.
8. Uploads the release manifest last.
9. Compares the complete remote asset set, sizes, and available server-side digests with
   the local validated output.

Verification rejects any individual release asset at 2 GiB or larger, matching GitHub's
per-asset limit. Large logical datasets are compressed or partitioned into smaller assets.

The workflow never publishes the draft. A maintainer must inspect its notes, assets,
checksums, rights, and source commit before publishing it in GitHub.

If a run fails after draft creation, keep the draft for diagnosis or delete that exact
draft through the GitHub interface. Do not reuse its tag for different bytes.

## Optional API Space

`deploy-api.yml` is manual and accepts a release ID. It:

1. Checks the software license and environment configuration.
2. Requires a published, non-prerelease `data-<release-id>`.
3. Downloads its manifest and SQLite file.
4. Verifies the database checksum.
5. Assembles a minimal Docker Space with the exact immutable manifest URL.
6. Builds the Docker image.
7. Clones the configured Space, replaces its application files, commits, and pushes with
   lease protection.

No Hugging Face secret is exposed to pull requests or ordinary CI.

The API can sleep under a free hosting plan. The site must continue to present the static
API and browser search as the reliable path.

## Local production rehearsal

Use a clean public checkout and new output directories:

```bash
SOURCE_COMMIT="$(git -C build/formosanbank rev-parse HEAD)"

uv run python -m publisher.cli \
  --repo build/formosanbank \
  --output build/pages-release \
  --source-commit "$SOURCE_COMMIT" \
  --refresh-models \
  --site-only

uv run python -m publisher.verify_release --release build/pages-release
uv run python -m publisher.assemble_site \
  --release build/pages-release \
  --public site/public \
  --download-manifest build/published-release/release-manifest.json
npm --prefix site run build
uv run python -m publisher.verify_site --site site/dist
npm --prefix site run test:e2e
```

To rehearse all research formats, replace `--site-only` with both
`--compress-database` and `--release-only`, then verify `build/data-release`. The live API
verifies and expands that deterministic gzip snapshot at startup.

## Release verification

`publisher.verify_release` requires:

- A valid release manifest schema.
- No duplicate or unsafe paths.
- An exact match between the file tree, manifest, and `SHA256SUMS`.
- Every file size and SHA-256 to match.
- A valid immutable SQLite database when present.
- Valid gzip and uncompressed search checksums.
- Correct search record counts.
- Optional publication approval for one or more artifact scopes.

`publisher.verify_site` requires:

- The application shell, 404 redirect, web manifest, service worker, metadata, and search
  manifest.
- An exact shard set.
- Total and per-file size budgets.

## Rollback and recovery

Pages deployments are immutable artifacts. Roll back by rerunning a known good Kakarayan
commit and pinned FormosanBank ref, or by selecting a prior deployment in GitHub Pages.

Data releases are immutable. Do not replace assets under an existing release tag. Create a
new release from a corrected source or publisher commit.

The Space pins one release URL. Roll it back by dispatching `deploy-api.yml` with an earlier
published release ID.

Generated `build/` output is disposable. Source XML, reviewed metadata, code, and published
release records are not.

## Routine update checklist

1. Review upstream FormosanBank changes and rights evidence.
2. Run the data workflow in dry-run mode.
3. Inspect counts, warnings, exclusions, sizes, and checksums.
4. Compare major counts with the previous release and explain material changes.
5. Run Pages production validation.
6. Create the draft data release only after rights approval.
7. Review and publish the draft manually.
8. Deploy Pages from `main`.
9. Optionally update the Space to the published release.
10. Verify the public site, static metadata, release assets, API readiness, and source links.
