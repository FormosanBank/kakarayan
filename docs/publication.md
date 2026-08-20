# Publication and deployment

Kakarayan publishes one immutable data release, activates that exact release in the required
query API, and then deploys the matching static site. The order is intentional:

Production-scale validation results for the current v1 architecture are recorded in
[v1-evidence.md](v1-evidence.md).

```text
FormosanBank commit -> draft data release -> published data release
                    -> query API ready on that release
                    -> Pages built against that API release
```

Pages must not deploy a site that points at a missing or different query release.

## Repository configuration

An administrator configures these once:

1. Set **Settings > Pages > Build and deployment > Source** to **GitHub Actions**.
2. Create the `data-release` environment and require the intended maintainer approval.
3. Keep the `github-pages` environment restricted to `main`.
4. Choose one query API host. For Lightsail, follow [lightsail.md](lightsail.md). For the
   guarded Hugging Face deployment, create the `hugging-face-space` environment, set its
   `HF_SPACE_REPO` variable to `owner/name`, and add a narrowly scoped `HF_TOKEN` secret.
5. After the selected API is ready, set repository variable `KAKARAYAN_API_URL` to its
   public HTTPS base URL.
6. Enable the dependency graph when an administrator is available. It improves dependency
   review but is not a runtime deployment requirement.

The software license must remain present as `LICENSE` or `LICENSE.md`.

## Pull request checks

`.github/workflows/ci.yml` runs:

- Python formatting, lint, typing, API and publisher tests, and dependency audit;
- a generic API Docker image build;
- frontend audit, lint, typing, unit tests, production build, and site verification;
- one Chromium contract and accessibility journey;
- pull-request dependency review when repository metadata is available.

The full Chromium, Firefox, WebKit, and mobile matrix runs on the scheduled check rather
than duplicating platform-neutral routes on every pull request. Full corpus publication and
performance evidence belong to release validation, not ordinary PR CI.

## Build and publish a data release

Dispatch **Build and publish a data release** on `main` with:

- `source_ref`: the exact intended FormosanBank ref or 40-character commit;
- `dry_run: true` for a validation-only build, or `false` to prepare a draft release.

The workflow resolves the source ref once, captures one model catalogue, parses the source
once, and builds one complete release. It verifies schemas, SQLite, checksums, artifact
inventory, source identity, and rights. A real run transfers the already verified output to
the protected `data-release` job and creates `data-<release-id>` as a draft GitHub release.

Inspect the draft before publication:

- source and Kakarayan commits;
- counts and warnings;
- rights decisions and blocked artifacts;
- `release-manifest.json` and `SHA256SUMS`;
- `formosanbank.sqlite.gz` compressed and expanded identity;
- `site-metadata.zip`;
- curated prepared downloads and sizes.

Publish the draft without changing or replacing its assets. An existing release tag must
never be reused for different bytes.

## Deploy the query API

For the small Tokyo Lightsail proof of concept, follow
[the Lightsail runbook](lightsail.md). It builds the same generic API image, activates
the published release into a host-mounted data directory, and puts Caddy HTTPS in front
of the service. Continue with Pages only after `/readyz` reports the selected release.

After publishing the data release, dispatch **Deploy query API to Hugging Face** with its
release ID. The workflow:

1. Requires a published, non-prerelease GitHub data release.
2. Requires its manifest and compressed SQLite asset.
3. Assembles a minimal Docker Space pinned to the immutable release manifest URL.
4. Replaces the configured Space contents and pushes one release commit.

The container runs `api.prepare_release` while the image is built. Download, expansion,
checksum verification, and SQLite integrity checks therefore finish before the serving
process starts. Uvicorn starts from only the local active database and manifest.

Wait until:

```bash
curl --fail --silent "$KAKARAYAN_API_URL/readyz"
```

returns the selected release ID.

## Deploy Pages

Dispatch **Deploy GitHub Pages** with the same release ID. A relevant push to `main` also
attempts deployment using the newest compatible release.

The workflow:

1. Selects a published release containing `site-metadata.zip`.
2. Downloads only its manifest and static metadata package.
3. Verifies the package checksum, safe ZIP paths, size limits, schemas, and release IDs.
4. Assembles `site/public/api` plus curated download metadata.
5. Requires the configured API `/readyz` to match the selected release.
6. Builds and verifies the site under a 10 MiB total and 2 MiB per-file budget.
7. Runs the production Chromium contract and accessibility journey.
8. Uploads and deploys the exact verified Pages artifact.

Pages contains no corpus index, record shard, query database, or prepared bulk dataset.

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

Activate it outside the release directory:

```bash
uv run python -m api.prepare_release \
  --manifest build/data-release/release-manifest.json \
  --database build/active/formosanbank.sqlite \
  --activate build/active/release-manifest.json
```

Start the API with the two active paths, extract `site-metadata.zip` with
`publisher.extract_metadata`, assemble Pages with `publisher.assemble_site`, and require
`/readyz` to match before building the site. The concise invented-data commands are in the
root [README](../README.md).

## Verification commands

```bash
uv run python -m publisher.verify_release --release build/data-release
uv run python -m publisher.verify_site --site site/dist
uv run pytest api/tests publisher/tests
npm --prefix site test
npm --prefix site run test:e2e -- --project=desktop-chromium
```

Release verification checks exact file inventory, safe paths, schemas, sizes, checksums,
SQLite identity, and requested rights scopes. Static-site verification checks required
shell files, every static metadata envelope, and strict size budgets.

## Rollback

Data releases are immutable. Keep the prior published release available.

1. Dispatch the API workflow with the prior release ID.
2. Wait for `/readyz` to report that ID.
3. Dispatch Pages with the same prior release ID.
4. Verify lookup, record detail, downloads, and static release metadata.

Do not deploy Pages first and do not replace assets under an existing release tag.

## Failure recovery

- A failed data build creates no published release.
- A failed draft can be inspected or deleted through GitHub; do not reuse its tag with
  changed bytes.
- A failed API deployment leaves the previously deployed Space revision available.
- A failed Pages build does not replace the current Pages deployment.
- A release mismatch makes the API unready or stops Pages before upload.
- Generated local `build/` output is disposable; source XML and published releases are not.

## Routine update

1. Review the intended FormosanBank commit and any changed rights evidence.
2. Run one real data publication, using dry run only when separate policy review needs it.
3. Inspect and publish the draft unchanged.
4. Deploy the API to that release and confirm readiness.
5. Deploy Pages to that release.
6. Verify English and Traditional Chinese routes, both lookup directions, detail expansion,
   research preview/export, downloads, local cards, and MT/ASR consent boundaries.
