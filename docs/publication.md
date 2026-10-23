# Publication and deployment

Kakarayan publishes one immutable data release, activates that exact release in the query
API, and then deploys the matching static site. One workflow does all three:

```text
FormosanBank commit -> build and verify -> published data release
                    -> query API on that release (approval required)
                    -> Pages built against that API release
```

Pages never deploys a site that points at a missing or different query release.

## Repository configuration

Configured once by an administrator:

1. **Settings > Pages > Source** is **GitHub Actions**.
2. Environments `data-release` and `github-pages` are limited to `main`.
3. Environment `production` is limited to `main`, requires a maintainer's approval, and
   holds two secrets:
   - `LIGHTSAIL_DEPLOY_KEY`: the private half of the restricted deploy key
     ([lightsail.md](lightsail.md#deploy-key)).
   - `LIGHTSAIL_KNOWN_HOSTS`: the host's pinned SSH host key line.
4. Repository variables:
   - `KAKARAYAN_API_URL`: the API's public HTTPS base URL, no trailing slash.
   - `LIGHTSAIL_HOST`: the host's static IP.
5. The software license stays present as `LICENSE.md`.

## Pull request checks

`.github/workflows/ci.yml` runs:
- Python formatting, lint, typing, tests, and dependency audit;
- an API image build and fixture readiness test;
- frontend audit, lint, typing, unit tests, production build, and site verification;
- one Chromium contract and accessibility journey;
- dependency review.

On `main` it keeps the tested API image as an artifact for 90 days. The scheduled weekly run
adds Firefox, WebKit, mobile, and the constrained performance profile.

## Release

Dispatch **Release** on `main` with:

- `source_ref`: the FormosanBank branch, tag, or commit, usually `main`;
- `dry_run`: `true` to build and validate only;
- `verify_determinism`: `true` only for publisher or schema changes. It repeats the complete
  build and compares manifests.

The workflow:

1. Resolves the source ref once and requires successful main CI for the dispatched commit.
2. Builds the release, verifies schemas, SQLite, checksums, inventory, source identity, and
   rights, and reconciles every prepared format against the database.
3. Starts the API on the verified database. Every sampled real record and query
   (`api/benchmark.py --sample-database`) must return 200, then the query benchmark must
   meet its budgets. The API log is kept with the measurements.
4. Uploads the assets, verifies each one against the manifest, and publishes the release.
   A partially uploaded draft from an interrupted run resumes only when every existing asset
   matches. Published releases are never changed.
5. Waits for approval of the `production` environment, then deploys the API
   (**Deploy the query API**).
6. Deploys Pages for the same release (**Deploy GitHub Pages**) and verifies the live site.

A routine release takes about an hour of runner time. Lookups show as unavailable for the
few minutes between the API switching releases and Pages finishing, because the site
refuses to mix releases. Release during quiet hours.

## Smaller deploys

- **Frontend only:** dispatch **Deploy GitHub Pages** with the release the API already
  serves. No data is rebuilt.
- **API code only:** dispatch **Deploy the query API** with the current release, then
  Pages if the frontend changed. The read-model version must still match the release.
- **Publisher or schema changes:** run a full **Release**.

## Local full-release rehearsal

Use a clean FormosanBank checkout and new output paths:

```bash
SOURCE_COMMIT="$(git -C /absolute/path/to/FormosanBank rev-parse HEAD)"

uv run python -m publisher.cli \
  --repo /absolute/path/to/FormosanBank \
  --output build/data-release \
  --source-commit "$SOURCE_COMMIT" \
  --refresh-models \
  --compress-database \
  --release-only

uv run python -m publisher.verify_release \
  --release build/data-release \
  --max-artifact-mib 2048
```

To try the release locally:
1. Activate it outside the release directory:
   ```bash
   uv run python -m api.prepare_release \
     --manifest build/data-release/release-manifest.json \
     --data-root build/active
   ```
2. Start the API with `build/active/current/formosanbank.sqlite` and its manifest.

## Rollback

Data releases are immutable, and the host keeps the previous generation.

1. Dispatch **Deploy the query API** with the prior release ID, from a `main` commit whose
   read model matches that release. `deploy.sh` reselects the retained generation without
   downloading it again.
2. Dispatch **Deploy GitHub Pages** with the same prior release ID.

`deploy.sh` also rolls back by itself when activation, readiness, or its smoke queries fail.

## Failure recovery

- A failed build publishes nothing.
- A failed API deploy leaves the previous image, settings, and data serving.
- A failed Pages build leaves the current site in place.
- A release mismatch makes Pages stop before upload.
- Generated local `build/` output is disposable; source XML and published releases are not.

## Monitoring

**Monitor** runs every 30 minutes against the public API. It checks readiness, release
identity, and one real query, opens an issue when they fail, and closes it on recovery.

Weekly, it opens an issue when the live data is more than 30 days behind FormosanBank `main`.

GitHub pauses scheduled workflows after 60 days without repository activity.
