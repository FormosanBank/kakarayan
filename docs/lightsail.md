# Lightsail query API deployment

This runbook deploys the Kakarayan query API and its read-only SQLite database to
one Ubuntu Lightsail instance in Tokyo. GitHub Pages continues to serve the
React site. GitHub Releases continues to store immutable data-release files.

The deployed request path is:

```text
browser
  -> GitHub Pages: React, styles, and small catalogues
  -> Lightsail Caddy: HTTPS termination
  -> Lightsail FastAPI: indexed public queries and streamed exports
  -> Lightsail SQLite: one local immutable read model
```

SQLite is a file inside the API host. It is not exposed to the internet and it is
not a separate database server. Caddy is the only public process. It obtains and
renews the TLS certificate, then forwards HTTPS requests to FastAPI over Docker's
private network.

## Required deployment order

Prepare the instance before merging, but do not point Pages at it yet:

1. Attach a static IP, configure the firewall, add swap, and install Docker.
2. Clone the pull-request branch and verify that the API image builds.
3. Merge the query-API pull request into `main`.
4. Build and publish one query-compatible data release from `main`.
5. Activate that exact release on Lightsail and verify `/readyz`.
6. Set `KAKARAYAN_API_URL` to the Lightsail HTTPS URL.
7. Deploy Pages with the same release ID.

The `data-release` environment accepts only `main`, so the official compatible
release cannot be published from the pull-request branch. Pages also refuses to
deploy when its release and the API release differ. These checks prevent a partial
cutover.

## 1. Prepare Lightsail networking

In the Lightsail console:

1. Open **Networking**, choose **Create static IP**, select the Tokyo instance,
   name the address, and attach it.
2. Copy the new static IPv4 address. Do not keep using the instance's original
   dynamic address because that address changes after a stop and start.
3. On the instance's **Networking** tab, allow inbound IPv4 TCP 80 and TCP 443.
4. Keep TCP 22 for SSH. Prefer restricting it to the administrator's current IP
   while allowing the Lightsail browser SSH client.
5. Do not add a public rule for port 7860. Compose binds that port to loopback.

For the initial deployment, create a free hostname by replacing the dots in the
static IP with dashes and appending `.sslip.io`. For example:

```text
Static IP: 203.0.113.10
Hostname:  203-0-113-10.sslip.io
API URL:   https://203-0-113-10.sslip.io
```

Use a project-owned domain later by pointing an A record such as
`api.kakarayan.example` to the same static IP. The server configuration does not
otherwise change.

## 2. Connect and inspect the instance

The easiest first connection is **Connect using SSH** in the Lightsail console.
The shell should open as `ubuntu`. A local SSH client is also valid:

```bash
chmod 600 /absolute/path/to/hunter-ssh-tokyo.pem
ssh -i /absolute/path/to/hunter-ssh-tokyo.pem ubuntu@STATIC_IP
```

Inspect the machine before changing it:

```bash
uname -a
free -h
swapon --show
df -h /
```

The production 4 GiB host gives the API a 3 GiB ceiling and Caddy a 128 MiB
ceiling. The remaining memory is available to Ubuntu, Docker, filesystem cache,
and deployment work. Add a 2 GiB swap file once as protection against short
deployment spikes:

```bash
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
fi
sudo swapon /swapfile
grep -qF '/swapfile none swap sw 0 0' /etc/fstab \
  || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Swap is slower than RAM. It is a safety net for deployment spikes, not a way to
make slow queries fast. If normal traffic uses swap continuously, inspect the
active query workload and memory use before increasing concurrency or host size.

## 3. Install Docker Engine and Compose

Use Docker's Ubuntu package repository so Engine and the Compose plugin update
through `apt`:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq tmux
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
```

Adding `ubuntu` to the Docker group gives that account root-equivalent control of
containers. End the SSH session and reconnect so the new group takes effect, then
verify the installation:

```bash
docker version
docker compose version
docker run --rm hello-world
```

## 4. Stage the application before merge

Clone the public repository and check out the pull-request branch:

```bash
sudo install -d -o ubuntu -g ubuntu /opt/kakarayan
git clone https://github.com/FormosanBank/kakarayan.git /opt/kakarayan
cd /opt/kakarayan
git checkout <PULL_REQUEST_BRANCH>
git status --short --branch
```

Create the host-only configuration:

```bash
cd /opt/kakarayan/deploy/lightsail
cp .env.example .env
nano .env
```

Set `KAKARAYAN_HOSTNAME` to the hostname made from the attached static IP. Leave
the production and local frontend origins in `KAKARAYAN_CORS_ORIGINS`. The `.env`
file contains no password and is ignored by Git, but it remains host-specific.
Keep the 4 GiB host defaults of `3g` for the API and `128m` for Caddy. The default
`KAKARAYAN_QUERY_STEP_LIMIT=2000000` permits substantial analytical queries. Keep
the initial request controls at 60 requests per minute, 5 exports per minute, and
2 concurrent SQLite queries. Only one dataset or aggregate query may run at once,
which leaves one lane available for dictionary, sentence, and record-detail requests.
The API reuses both read-only connections with a 128 MiB SQLite cache per connection
and a 2 GiB immutable-file mapping ceiling. The larger instance still has two vCPUs,
so extra RAM improves cache and headroom without adding more query workers. A request
waits at most one second for a slot. Normal queries, previews, and exports have
separate 10, 15, and 120 second deadlines. These values can be tuned in `.env`
without changing code.

The application keys its limits from Uvicorn's resolved client address. Caddy supplies the
client address through proxy headers, and Uvicorn trusts those headers because the API port
is reachable only from loopback and Docker's private network. Do not expose port 7860 or
place an untrusted proxy on that network while `--forwarded-allow-ips=*` is configured.

Validate the Compose model and build the generic API image:

```bash
docker compose config --quiet
docker compose pull caddy
docker compose build api
docker image ls kakarayan-api
```

The repository `.dockerignore` limits the build context to the API and locked
Python dependency files. The multi-gigabyte local `build/` directory is never sent
to Docker. Do not start the stack yet because no compatible release is active.

## 5. Merge and publish a compatible data release

After pull-request checks pass, merge the query-API pull request into `main`. Then
update the server checkout:

```bash
cd /opt/kakarayan
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
cd deploy/lightsail
docker compose config --quiet
docker compose build api
```

Choose the exact current public FormosanBank commit from a trusted workstation:

```bash
gh api repos/FormosanBank/FormosanBank/commits/main --jq .sha
```

In `FormosanBank/kakarayan` on GitHub:

1. Open **Actions** and choose **Build and publish a data release**.
2. Choose **Run workflow** and select branch `main`.
3. Set `source_ref` to the full FormosanBank commit from the prior command.
4. Set `dry_run` to `false` and run it.
5. Approve the waiting `data-release` environment job when requested.
6. Inspect the resulting draft release, its source commit, manifest, checksums,
   rights decisions, counts, and asset sizes.
7. Publish the draft without changing its assets.

The workflow performs schema checks, SQLite checks, rights enforcement, reconciliation,
and query benchmarks. Leave `verify_determinism` disabled for a routine release. Enable it
before material publisher or schema changes when a second complete build is worth the time.

Record the release ID shown in `release-manifest.json`. It has a form like
`fb-YYYYMMDD-abcdef12`. The public manifest URL is:

```text
https://github.com/FormosanBank/kakarayan/releases/download/data-RELEASE_ID/release-manifest.json
```

## 6. Activate the release on Lightsail

The database is about 5 GB expanded. Activation temporarily keeps the compressed
download and the candidate database, so require at least 8 GB free before starting:

```bash
cd /opt/kakarayan/deploy/lightsail
df -h .
mkdir -p data
sudo chown 10001:10001 data
```

Run activation inside `tmux` so it continues if the browser SSH session drops:

```bash
tmux new -s kakarayan-activate
```

Inside the tmux session, replace `RELEASE_ID` and run:

```bash
docker compose run --rm --no-deps api \
  .venv/bin/python -m api.prepare_release \
  --manifest "https://github.com/FormosanBank/kakarayan/releases/download/data-RELEASE_ID/release-manifest.json" \
  --database /data/formosanbank.sqlite \
  --activate /data/active-release.json
```

Activation downloads the compressed database, verifies its size and SHA-256,
expands it, verifies the expanded size and SHA-256, runs SQLite integrity checking,
and atomically places the database and manifest in `deploy/lightsail/data`. It does
not build the corpus on the Lightsail instance.

Press `Ctrl-b`, then `d`, to detach from tmux. Reconnect later with:

```bash
tmux attach -t kakarayan-activate
```

When activation exits successfully, start both services:

```bash
set -a
. ./.env
set +a
docker compose up -d
docker compose ps
docker compose logs --tail=100 api caddy
curl --fail --silent http://127.0.0.1:7860/readyz | jq .
```

The local readiness response must contain the selected release ID. Caddy may need
a short period to obtain its first certificate. Then test the public URL:

```bash
curl --fail --silent "https://$KAKARAYAN_HOSTNAME/readyz" | jq .
```

Test a real bounded lookup, replacing `RELEASE_ID`:

```bash
curl --fail --silent --get \
  "https://$KAKARAYAN_HOSTNAME/v1/releases/RELEASE_ID/dictionary" \
  --data-urlencode 'q=fangcalay' \
  --data-urlencode 'language_id=lang_amis' \
  --data-urlencode 'direction=formosan' \
  --data-urlencode 'match=exact' \
  --data-urlencode 'limit=5' | jq .
```

## 7. Connect GitHub Pages to the API

Only do this after the public `/readyz` response reports the intended release.

1. Open Kakarayan **Settings > Secrets and variables > Actions > Variables**.
2. Set repository variable `KAKARAYAN_API_URL` to the HTTPS API URL with no
   trailing slash, such as `https://203-0-113-10.sslip.io`.
3. Open **Actions > Deploy GitHub Pages > Run workflow**.
4. Select `main` and enter the same `RELEASE_ID`.
5. Approve the `github-pages` environment if requested.
6. Wait for the production browser checks and Pages deployment to finish.

The Pages workflow downloads the matching static metadata, checks Lightsail
`/readyz`, and stops before deployment if the IDs differ.

## 8. Verify the complete system

Open `https://formosanbank.github.io/kakarayan/` and check:

1. Formosan-to-translation dictionary lookup.
2. Translation-to-Formosan dictionary lookup.
3. Sentence search and one expanded record.
4. Research preview and one small export.
5. English and Traditional Chinese interface modes.

Inspect the instance after several requests:

```bash
cd /opt/kakarayan/deploy/lightsail
docker compose ps
docker stats --no-stream
free -h
df -h /
docker compose logs --tail=100 api caddy
```

The API disables Uvicorn access logs, so raw user search queries are not written to
the container log. A rate-limited request returns HTTP 429 with `Retry-After`. Limit headers
identify the active request or export bucket without logging the client IP.

## Routine release update

For later FormosanBank updates:

1. Publish a new immutable release from a pinned FormosanBank commit.
2. Check that at least 8 GB is free on Lightsail.
3. Pull the latest Kakarayan `main` and rebuild the generic API image.
4. Activate the new manifest with the same command used above.
5. Restart with `docker compose up -d` and verify `/readyz`.
6. Deploy Pages with that same release ID.

Keep the previous published GitHub release for rollback. Do not leave partial or
stale database copies in the host data directory after a successful activation.

## Rollback

Run the activation command with the prior published manifest, start the stack, and
confirm `/readyz`. Then deploy Pages with the prior release ID. GitHub Releases are
the durable immutable source, so rollback does not require a server snapshot.

## Resizing or replacing the host

The current production host was created from a Lightsail snapshot and kept the
same static IP. A replacement VM has a new SSH host key even when it receives the
old IP. Verify the new fingerprint before trusting it, then confirm all of the
following before considering the migration complete:

1. `hostname`, `free -h`, and `df -h /` show the intended new machine.
2. `docker compose ps` shows healthy API and Caddy services.
3. `docker inspect` shows the intended container memory limits.
4. `/readyz` reports the same immutable release ID as GitHub Pages.
5. One real dictionary query and one sentence query succeed over HTTPS.

Moving the static IP preserves the public API URL and TLS hostname. Caddy obtains
or renews the certificate on the replacement host. No Pages configuration or
release identity changes are required.

## Cost and capacity

Production uses the 4 GiB RAM, 2 vCPU, and 80 GB SSD general-purpose Lightsail
bundle in Tokyo. At the listed plan rate when this runbook was updated, it costs
$24 per month and includes 4 TB monthly transfer. The attached static IP has no
added charge while attached, and Caddy certificates are free. Optional Lightsail
snapshots are billed separately per stored GB.

The API permits 100,000 export rows per selected XML level. Its 3 GiB container
budget gives the persistent SQLite caches and mapped database pages room to reuse
the indexed data without allowing one process to consume the whole host. Caddy has
a 128 MiB ceiling. Keep total query concurrency at two and analytical concurrency at
one because this plan still has two vCPUs. Watch memory, swap, disk, latency, queue
rejections, and request deadlines before changing those values.

This host does not run MT or ASR models. Those remain independent Hugging Face calls,
so deploying the lookup API improves corpus tools but does not remove model warm-up
latency.
