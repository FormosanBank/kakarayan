# Publication operations

## Repository configuration

The repository contains the CC BY-NC 4.0 license, reviewed public-repository corpus policy,
Pages workflow, data-release workflow, and direct-browser MT and ASR service configuration.
Repository administrators still control settings that a writer cannot change:

1. In **Settings > Pages**, set the source to **GitHub Actions**.
2. Give the `github-pages` environment the desired protection rules.
3. Require maintainer approval for the `data-release` environment.
4. In **Settings > Code security**, enable the dependency graph. This is repository
   metadata analysis and does not run a corpus build.

The existing public `FormosanBank/formosan-mt` and `FormosanBank/formosan_asr` Spaces need
no Kakarayan secret. The optional corpus REST API is separate. If maintainers want it, they
must create a public Hugging Face Docker Space, set `HF_SPACE_REPO`, add a narrowly scoped
`HF_TOKEN`, and protect the `hugging-face-space` environment.

### Current external state

Checked on 2026-08-10:

- Pages uses GitHub Actions and is public at `https://formosanbank.github.io/kakarayan/`.
- The `data-release` and `github-pages` environments exist.
- A reviewed software license and the first immutable data release are published.
- The dependency graph remains unavailable, so dependency review reports a warning and
  skips instead of blocking unrelated checks.
- The public MT and ASR Spaces have configured browser routes at `/translate` and
  `/transcribe`.

### Publication order

1. Merge reviewed Kakarayan changes to `main`.
2. Dispatch `publish-data.yml` once with `dry_run: false` and the intended FormosanBank ref.
3. Inspect the resulting draft release, source commit, rights catalogue, checksums, counts,
   research exports, and `site-release.tar`.
4. Publish that exact draft without replacing any asset. The release event deploys Pages
   automatically from the verified browser bundle.
5. Verify the public URL, downloads, lookup routes, static API, and model consent flows.

A dry run remains available for policy review, but it is not a required precursor to a real
run. A real run performs the same validation before it creates a draft, so running both
would duplicate the expensive corpus build.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. Feature branches use
the pull-request run rather than launching a second identical push run.

It checks:

- Ruff formatting and lint.
- Mypy.
- Full pytest with PostgreSQL 16.
- Publisher determinism and release verification with invented fixtures.
- API container build.
- Frontend lint, types, unit tests, npm audit, build, and site budgets.
- Chromium mobile plus Chromium, Firefox, and WebKit desktop Playwright routes, compressed
  search, bounded RE2, Worker summaries, Parquet signatures, and serious WCAG violations.
- JavaScript, Python, and R clients.
- Pull request dependency changes.

Actions and the PostgreSQL service image are pinned to immutable digests or commits.
Pull requests receive read-only repository permission and no deployment credential.

## GitHub Pages

`deploy-pages.yml` runs after relevant site changes reach `main`, when a Kakarayan data
release is published, or by explicit dispatch. A manual dispatch can select a published
release ID; otherwise the workflow uses the newest published release that contains a
verified Pages bundle.

The workflow:

1. Checks that the Kakarayan software license is present.
2. Selects a published, non-prerelease data release with `site-release.tar`.
3. Verifies the bundle size and checksum against the published release manifest.
4. Safely extracts the bundle and verifies every static API, search shard, search index,
   checksum, source commit, count, and rights decision.
5. Imports the release's prepared-download catalogue and assembles the Vite public tree.
6. Builds the application, verifies the Pages size budgets, and runs the production
   Chromium smoke and accessibility suite.
7. Uploads one Pages artifact and deploys those exact saved bytes.

The full Chromium, Firefox, WebKit, mobile, unit, lint, type, and audit suite remains in CI.
Deployment does not repeat those checks or parse the FormosanBank XML again.

The build budget is 900 MiB total and 50 MiB for any one file. Bulk downloads never enter
the Pages artifact.

## Data release

`publish-data.yml` is manual and defaults to `dry_run: true`.

A dry run performs both public-corpus builds and all release verification with a read-only
token. It creates no release and transfers no large artifact to a write-enabled job.

A real run additionally:

1. Resolves the FormosanBank ref once and captures one public model catalogue.
2. Builds all research formats and browser search data in parallel from those immutable
   inputs. The slower research job determines wall-clock time; the browser build no longer
   runs afterward in Pages.
3. Checks the software license and requires site, core, and prepared artifact rights.
4. Packs the browser release deterministically as `site-release.tar`.
5. Transfers both validated outputs to the separately permissioned `data-release`
   environment, joins their manifests, and verifies every byte and rights decision again.
6. Creates `data-<release-id>` as a draft GitHub release.
7. Uploads every manifest-named SQLite, metadata, prepared asset, and Pages bundle.
8. Uploads the release manifest last and compares the complete remote asset set, sizes,
   and available server-side digests with the local validated output.

Verification rejects any individual release asset at 2 GiB or larger, matching GitHub's
per-asset limit. Large logical datasets are compressed or partitioned into smaller assets.

The workflow never publishes the draft. A maintainer must inspect its notes, assets,
checksums, rights, and source commit before publishing it in GitHub.

If a run fails after draft creation, keep the draft for diagnosis or delete that exact
draft through the GitHub interface. Do not reuse its tag for different bytes.

## Optional corpus API Space

`deploy-api.yml` is manual and accepts a release ID. It:

1. Checks the software license and environment configuration.
2. Requires a published, non-prerelease `data-<release-id>`.
3. Downloads its manifest and SQLite file.
4. Verifies the database checksum.
5. Assembles a minimal Docker Space with the exact immutable manifest URL.
6. Builds the Docker image.
7. Clones the configured Space, replaces its application files, commits, and pushes with
   lease protection.

No Hugging Face secret is exposed to pull requests or ordinary CI. This workflow is not
used by browser MT or ASR, which call the existing public FormosanBank Spaces directly.

The API can sleep under a free hosting plan. The site must continue to present the static
API and browser search as the reliable path.

## Local production rehearsal

Use a clean public checkout and new output directories:

```bash
SOURCE_COMMIT="$(git -C build/formosanbank rev-parse HEAD)"

uv run python - <<'PY'
import json
from pathlib import Path

from publisher.model_catalog import build_model_catalog

Path("build/models.json").write_text(
    json.dumps(build_model_catalog(), ensure_ascii=False, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

uv run python -m publisher.cli \
  --repo build/formosanbank \
  --output build/pages-release \
  --source-commit "$SOURCE_COMMIT" \
  --model-catalog build/models.json \
  --site-only

uv run python -m publisher.cli \
  --repo build/formosanbank \
  --output build/data-release \
  --source-commit "$SOURCE_COMMIT" \
  --model-catalog build/models.json \
  --compress-database \
  --release-only

uv run python -m publisher.verify_release --release build/pages-release
uv run python -m publisher.verify_release --release build/data-release
uv run python -m publisher.site_bundle pack \
  --release build/pages-release \
  --output build/site-release.tar
uv run python -m publisher.site_bundle attach \
  --release build/data-release \
  --bundle build/site-release.tar
uv run python -m publisher.assemble_site \
  --release build/pages-release \
  --public site/public \
  --download-manifest build/data-release/release-manifest.json
npm --prefix site run build
uv run python -m publisher.verify_site --site site/dist
npm --prefix site run test:e2e
```

The live API verifies and expands the deterministic gzip snapshot at startup.

For a repeated determinism check, capture one public model-catalog document and supply the
same bytes to both builds with `--model-catalog path/to/models.json`. `--model-catalog` and
`--refresh-models` are mutually exclusive. This separates external Hugging Face metadata
changes from publisher determinism and records the exact catalogue input under test.

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

Pages deployments are immutable artifacts. Roll back by dispatching `deploy-pages.yml`
with a known good published release ID, or by selecting a prior deployment in GitHub Pages.

Data releases are immutable. Do not replace assets under an existing release tag. Create a
new release from a corrected source or publisher commit.

The Space pins one release URL. Roll it back by dispatching `deploy-api.yml` with an earlier
published release ID.

Generated `build/` output is disposable. Source XML, reviewed metadata, code, and published
release records are not.

## Routine update checklist

1. Review upstream FormosanBank changes and any stricter corpus rights evidence.
2. Dispatch one real data workflow run. Use a dry run only when separate policy review
   requires it.
3. Inspect counts, warnings, exclusions, sizes, checksums, and changes from the previous
   release.
4. Review and publish the draft without changing its assets.
5. Confirm the release-triggered Pages deployment succeeds.
6. Optionally update the Space to the published release.
7. Verify the public site, static metadata, release assets, API readiness, and source links.
