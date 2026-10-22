# Kakarayan catch-up and cleanup plan

Drafted October 21, 2026. This plan takes Kakarayan from its current state (six weeks
behind FormosanBank, buggy, slow and manual to release) to a current, reliable, easy to
release service. It keeps the architecture and the frontend design. It does not rewrite
the application.

## Progress

Updated October 22, 2026.

| Phase | Status |
| --- | --- |
| 1. Release blockers | Done in #98, CI green, awaiting merge |
| 2. Release pipeline | Done in #99, CI green, awaiting merge |
| 3. Catch-up release | Waiting on the merges and the host's deploy-key bootstrap |
| 4. Operations | Monitor workflow and `production` environment done; alarms and budget need a notification email |
| 5. Cleanup | Done in draft #100, to merge after the catch-up release |

Changes from the original plan, found during implementation:

- **No container registry.** New org packages default to private, so the deploy job pipes
  the CI-tested image to the host over the restricted SSH key instead.
- **Cutover gap stays at a few minutes.** Pages' production smoke test needs the new API
  live, so Pages still builds after the API switches.
- **xz was needed.** The current corpus compresses to 1,775 MiB with gzip. Deterministic
  multithreaded xz brings it to 1.2 GB.
- **Two more full-data bugs.**
  - FormosanBank's new `languages.csv` registry added Pazeh. Kakarayan's hardcoded copy
    broke the CLDF export, so it now reads the registry.
  - Reverse lookups of common glosses hit the 10 s deadline (15.9 s to 0.03 s fixed).

Local full-data validation of FormosanBank `d7951d1`:

| Check | Result |
| --- | --- |
| Build | 16 min |
| Reconciliation | 6 min, down from 49 |
| Contract sample | 466 real requests, all 200 |
| Benchmark | Every case within budget |
| Activation | 132 s with 57 MB of memory |

## 1. Where things stand

Evidence gathered October 21, 2026.

| Area | Current state |
| --- | --- |
| Production | Healthy. API and Caddy up 6 to 8 weeks on Gabriel's Tokyo Lightsail host, serving `fb-20260903-e00edfe2bfb2` |
| Source freshness | Built from FormosanBank `e00edf3` (Sept 3). FormosanBank `main` is `d7951d1` (Oct 18): 1,329 commits, 7 new corpora, Wikipedias rewritten (12,747 XML files changed), XML 0.60 to 0.73 GB |
| Undeployed code | `main` is 21 commits ahead of production (PR #89 audit fixes, 130 files) and requires read-model version 2 |
| CI | Scheduled CI fails on dependency audits: npm `brace-expansion`, `source-map-js`, `fast-uri`, Python `urllib3`, `virtualenv`. 12 Dependabot PRs open, all failing on that shared baseline |
| Release time | About 2 hours of runner time per release. XLSX alone is 53 of about 101 minutes (20 build, 33 verify) |
| Release effort | About 15 manual steps across GitHub, a laptop (image download and `scp`), and SSH |
| Server layout | Old flat layout (`data/formosanbank.sqlite` + `active-release.json`), image `kakarayan-api:lightsail` built on the host, 47 GB free disk |
| Query speed | Full-data loopback p95 is under 155 ms for every benchmark case. Database speed is not the bottleneck |
| Usage | Light. A few API sessions a week above background traffic. Each prepared download has 3 to 5 lifetime downloads. XLSX: 3 |
| Monitoring | None. No alarms, no alert contacts, no budget, no uptime check |
| Account security | IAM user `hunter` is in the Administrator group with no MFA |

### Known bugs

1. **Sentence detail returns 500 for every sentence without `<W>` children.** Tokens of
   unsegmented sentences have `word_id = NULL`, but `api/contracts.py` declares
   `Token.word_id: str` in strict mode. Reproduced on fixture sentence `s-two`. This is
   what failed full-data validation run 34192873622. It is on `main`, not in production.
2. **Every corpus is labelled CC BY-NC 4.0.** `publisher/rights.py` hardcodes the license.
   FormosanBank records the real license in each XML root `@copyright` (POL-042). 16 of 34
   corpora differ, including NC-SA, NC-ND, BY-SA, BY, and public domain.
3. **Docs embeds the retired GitBook.** FormosanBank now publishes its documentation at
   `https://formosanbank.github.io/FormosanBank/`, with English, Traditional Chinese, and
   Paiwan editions. English paths match the old GitBook paths one to one.
4. **The release benchmark loses the API log on failure.** It is written to
   `$RUNNER_TEMP` and never uploaded, which is why bug 1 went undiagnosed.
5. **The compressed database is close to GitHub's 2 GiB asset limit.** It is 1,530 MB
   today. With 22% source growth the next one will be about 1.9 GB.

### Code bloat, measured

The codebase is about 4.8k lines of API, 5.6k of publisher, and 13.7k of frontend
(including 4.5k of CSS). A dead-code scan found no unused Python. The excess is
duplication and size, not abandoned code:

- `api/app.py` repeats the same 13 dataset parameters in five places.
- `api/store.py` is 1,425 lines covering four separate query families.
- `publisher/build.py` is 1,244 lines mixing orchestration with index and summary SQL.
- The release ships the same tables in six encodings (SQLite, CSV, TSV, flat JSONL,
  Parquet, XLSX) plus hierarchical JSONL, CLDF, alignments, and text exports.
- 27 CSS classes are never referenced. Four legacy route aliases remain
  (`/dictionary`, `/sentences`, `/search`, `/guide`).

## 2. Target state

When this plan is complete:

- Production serves a release built from current FormosanBank `main`, and never falls
  more than about a month behind.
- A full release is one workflow dispatch plus one approval click, about 60 to 75
  minutes, with no laptop or SSH steps. A frontend-only change deploys in about 10 minutes.
- Bugs are caught before deployment: real-data contract checks run in every release build.
- Every corpus shows its actual FormosanBank license.
- CI is green. Dependency updates arrive as one grouped PR per ecosystem.
- Someone is notified when the API is unreachable or the host is unhealthy.
- The code is smaller, with fewer encodings, less duplication, and no XLSX.
- The frontend looks and behaves as it does now.

## 3. Decisions

Hunter approved all five recommendations on October 21, 2026.

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Drop XLSX? | Yes | 53 min and 904 MB per release for 3 lifetime downloads. CSV opens in Excel |
| D2 | Drop TSV and flat JSONL? | Yes | Duplicates of CSV and Parquet with 4 and 3 downloads. Saves about 10 min and 1 GB per release |
| D3 | Let GitHub deploy to the server? | Yes, with a restricted key | A forced-command SSH key can only run the deploy script, and it needs an approval click |
| D4 | Publish releases without draft review? | Yes | Every check is automated, and the deploy approval remains the human gate |
| D5 | Use a project domain for the API? | Yes, when convenient | `sslip.io` is widely blocked by security filters, including Hunter's home router. About $10 to $15 a year. Does not block the first release |

Owner actions that only Hunter or Gabriel can do:

- Enable MFA on IAM user `hunter`, and set a new console password.
- Allowlist `54.65.114.226` and `sslip.io` on the home router, or use another network.
- Choose and register the API domain if D5 is accepted.

## 4. Phases

Each phase is a branch and a PR. Nothing merges or deploys without approval. Phases 1 and
2 come first because they make the catch-up release possible and cheap. Cleanup comes
after the catch-up release, so freshness never waits on refactoring.

### Phase 1. Release blockers and correctness (about 1 to 2 days)

Branch `fix/release-blockers`.

1. **Sentence-detail 500.** Make `Token.word_id` nullable in `api/contracts.py`,
   regenerate `site/src/contractTypes.d.ts`, and add an API test that expands an
   unsegmented sentence.
2. **Real-data contract check.** Before the release benchmark, validate a deterministic
   sample of sentence details, dictionary pages, and concordance pages from every corpus
   against `api/contracts.py`. Run it directly against the built SQLite database. This
   would have caught bug 1 on the first full build.
3. **Keep failure evidence.** Copy the benchmark API log into the uploaded artifact.
4. **Real licenses.** Derive each corpus's license from its XML `@copyright` values,
   which the projection already stores in `texts.copyright`. Keep
   `redistribution: allowed` for every public corpus. When one corpus has several values,
   record all of them. The UI already displays the rights entry, so no new UI is needed.
5. **Docs.** Point the Docs route at `https://formosanbank.github.io/FormosanBank/`.
   English paths carry over. Map Traditional Chinese pages to the `zh/` edition where a
   page exists, and use the English page otherwise.
6. **Dependencies.** Update the vulnerable lockfile entries, triage the 12 Dependabot PRs
   (merge what passes, close what is superseded), and add Dependabot `groups` so each
   ecosystem produces one weekly PR.

Done when main CI is green, the new tests pass, and the docs embed loads in both locales.

### Phase 2. Fast, low-touch releases (about 2 to 3 days)

Branch `ops/release-pipeline`.

1. **Trim prepared formats** per D1 and D2. Remove the XLSX writer, its reconciliation,
   and `openpyxl`, plus TSV and flat JSONL if approved. Expected release time drops from
   about 101 to about 40 to 45 minutes of build and verify.
2. **Fix the size ceiling.** Measure the next database. Switch its compression from gzip
   to xz (standard library) if it would exceed 1.8 GB, and keep the compressed and
   expanded checksums in the manifest.
3. **Publish the API image to GitHub's container registry.** Main CI pushes
   `ghcr.io/formosanbank/kakarayan-api:<commit>` after its tests pass. The server pulls by
   digest. This removes the 14-day artifact expiry and the laptop download and `scp`.
4. **One server deploy script,** `deploy/lightsail/deploy.sh <commit> <release-id>`.
   - Pull and verify the image.
   - Pin `.env`.
   - Run `api.prepare_release`.
   - Restart the API.
   - Wait for `/readyz` to report the expected release and image.
   - Run three smoke queries.
   - On failure, restore the previous image and generation automatically.
5. **One Release workflow.** Chain the existing jobs: build and verify, then publish the
   release, then deploy to the API through the restricted key (approval required), then
   deploy Pages, then verify live. Build the Pages artifact while the API activates, so
   lookups are unavailable for about a minute during cutover instead of about ten.
   Frontend-only and API-only deploys remain separate dispatches.
6. **Staleness check.** A weekly scheduled job opens or updates one issue when
   FormosanBank `main` is more than 30 days newer than the live release.

Security for the deploy key: a dedicated key in `authorized_keys` with
`command="/opt/kakarayan/deploy/lightsail/deploy.sh",no-pty,no-port-forwarding`. The
script validates both arguments, accepting only a 40-character main commit and a release
ID that matches the published pattern. The private key and the pinned host key live in a
GitHub environment secret that requires Hunter's approval.

Done when a test dispatch reaches the API-deploy approval step with no manual
intervention, and `deploy.sh` passes a disposable rehearsal on a fixture release.

### Phase 3. Catch-up release (about 1 day, mostly waiting)

1. One-time host preparation over SSH:
   - Install the deploy key.
   - Add `KAKARAYAN_API_IMAGE` to `.env`.
   - Pull the first registry image.
2. Dispatch Release with FormosanBank `main` and `verify_determinism=true`, since the
   publisher changed in this cycle.
3. The first activation also migrates the server from the flat layout to generations. Keep
   `data/formosanbank.sqlite`, `active-release.json`, and image `kakarayan-api:lightsail`
   until the new release has run cleanly for a week. That is the rollback path.
4. Verify from outside Hunter's home network:
   - Both lookup directions.
   - An unsegmented sentence detail.
   - The new corpora.
   - Licenses on corpus pages.
   - Dataset preview and export.
   - Audio clips.
   - Docs.
   - Both locales.
   - Mobile.
5. Retire the flat-layout files and the old image after the week.

Done when Pages and the API serve the new release, `/readyz` reports the main-CI image, and
the checklist passes.

### Phase 4. Operations and security baseline (about half a day)

1. Lightsail alarms for status-check failures, sustained CPU, and low burst capacity,
   emailing Gabriel and Hunter.
2. A scheduled GitHub Actions uptime check every 30 minutes. It calls `/readyz` and one
   dictionary query from outside Taiwan and Hunter's network, and opens an issue on
   failure.
3. A monthly AWS budget alert in Gabriel's account, about $20.
4. Confirm SSH is key-only and unattended security upgrades are enabled on the host.
5. Move the API to the project domain if D5 is accepted: Caddy hostname,
   `KAKARAYAN_API_URL`, and one Pages redeploy. No data rebuild.

### Phase 5. Behavior-preserving cleanup (about 3 to 5 days)

Branch per area. Each change keeps routes, responses, and UI identical, verified by the
existing API, publisher, unit, and browser tests.

- **API.**
  - Replace the five copies of the dataset parameter list with one FastAPI dependency.
  - Split `store.py` by query family (search with dictionary evidence, datasets,
    summaries and frequencies), keeping one shared connection and budget layer.
  - Merge `dataset()` and `stream_dataset()` duplication.
- **Publisher.**
  - Move index and summary SQL out of `build.py` so it only orchestrates.
  - Remove code made dead by the format trim.
- **Frontend, no visual changes.**
  - Delete the 27 unused CSS classes and the four legacy route aliases.
  - Replace the duplicated title and description tables in `App.tsx` with one route table.
- **Docs.**
  - Shorten `docs/lightsail.md` and `docs/publication.md` to the new flow.
  - Delete the implemented September audit plan, which remains in git history.
  - Delete this plan when it is complete.

Done when the net line count is lower, every test passes unchanged, and a
frontend-and-API deploy reuses the Phase 3 release.

## 5. Out of scope

- Rewriting the frontend, changing its design, or adding a state framework.
- Replacing SQLite, adding a database server, serverless APIs, Kubernetes, or a CDN in front
  of the API. Measured query times do not justify them.
- Hosting the MT and ASR models. They stay on Hugging Face. Making them fast is a separate
  project, with its own cost decision, that Gabriel has raised.
- A phone app.

## 6. Capacity and scaling

The read-only SQLite model fits this workload. The 5.66 GB database will grow to about
7 GB. The 2 GB host maps up to 1 GB of it and serves full-data queries well within budget.
Upsize to the 4 GB plan (about $24 a month) only if p95 latency, swap use, or memory
pressure regress after the catch-up release. Runner disk and the 2 GiB asset limit are the
nearer constraints. Phase 2 addresses both.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Deploy key misuse | Forced command, argument validation, approval-gated environment secret, pinned host key |
| First activation fails during migration | Old flat files and image retained, and the previous generation stays selected on failure |
| Full-data surprises beyond bug 1 | Real-data contract sampling runs before the benchmark |
| Release size over 2 GiB | Measured in Phase 2, with xz compression when needed |
| License edge cases | Use only the XML `@copyright` values. Redistribution remains allowed for every public corpus |

## 8. Order and effort

| Phase | Effort | Depends on |
| --- | --- | --- |
| 0. Decisions and owner actions | About 1 hour | None |
| 1. Release blockers | 1 to 2 days | None |
| 2. Release pipeline | 2 to 3 days | D1 to D4 |
| 3. Catch-up release | About 1 day | 1, 2 |
| 4. Operations baseline | About half a day | 3 |
| 5. Cleanup | 3 to 5 days | 3 |

About two weeks of focused work. Production becomes current after Phase 3, roughly
halfway through.
