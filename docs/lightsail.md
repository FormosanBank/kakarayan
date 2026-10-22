# Lightsail query API

The Kakarayan query API and its read-only SQLite database run on one Ubuntu Lightsail
instance in Tokyo. GitHub Pages serves the React site, and GitHub Releases stores the
immutable data releases.

```text
browser
  -> GitHub Pages: React, styles, and small catalogues
  -> Lightsail Caddy: HTTPS termination
  -> Lightsail FastAPI: indexed public queries and streamed exports
  -> Lightsail SQLite: one local immutable read model
```

SQLite is a file on the host, not a database server. Caddy is the only public process.
It obtains and renews the TLS certificate and forwards to FastAPI over Docker's private
network. The API port is bound to loopback.

Releases are deployed by the **Release** or **Deploy the query API** workflows
([publication.md](publication.md)), which run `deploy/lightsail/deploy.sh` on the host
through a restricted SSH key. This document covers host setup and operations.

## Host layout

```text
/opt/kakarayan                        repository checkout, detached at the deployed commit
/opt/kakarayan/deploy/lightsail/.env  host settings, including the pinned image
/opt/kakarayan/deploy/lightsail/data  generations/<release-id>/, current, previous
```

The API container runs as UID 10001 with a read-only root filesystem. `data/` must be owned
by 10001.

## One-time host setup

1. In the Lightsail console:
   - Attach a static IP.
   - Allow inbound TCP 22, 80, and 443.
   - Do not open 7860.
2. Make a hostname from the static IP, such as `203-0-113-10.sslip.io` for `203.0.113.10`.
   A project-owned domain can replace it later with an A record. Nothing else changes.
3. Add 2 GiB of swap as a safety net for deployment spikes:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
4. Install Docker Engine and the Compose plugin from Docker's Ubuntu repository, plus
   `git`, `jq`, and `curl`. Then add `ubuntu` to the `docker` group and reconnect.
5. Clone the repository and create the host settings:
   ```bash
   sudo install -d -o ubuntu -g ubuntu /opt/kakarayan
   git clone https://github.com/FormosanBank/kakarayan.git /opt/kakarayan
   cd /opt/kakarayan/deploy/lightsail
   cp .env.example .env
   mkdir -p data && sudo chown 10001:10001 data
   ```
   Set `KAKARAYAN_HOSTNAME` in `.env`. Keep the 2 GiB host defaults.
6. Install the deploy key (below), then run the Release workflow.

## Deploy key

GitHub Actions deploys with a dedicated key that can only run `deploy.sh`:

```bash
ssh-keygen -t ed25519 -N '' -C kakarayan-deploy -f kakarayan-deploy
```

On the host, append one line to `~/.ssh/authorized_keys`. Replace `PUBLIC_KEY` with the
contents of `kakarayan-deploy.pub`:

```text
restrict,command="/opt/kakarayan/deploy/lightsail/deploy.sh" PUBLIC_KEY
```

`restrict` disables shells, PTYs, forwarding, and agent use for that key. Any command sent
with it is passed to `deploy.sh`. The script accepts only `status` or
`deploy <40-character commit> <release-id>`.

In the `production` environment on GitHub:
- Store the private key as `LIGHTSAIL_DEPLOY_KEY`.
- Store the output of `ssh-keyscan -t ed25519 STATIC_IP` as `LIGHTSAIL_KNOWN_HOSTS`, after
  checking its fingerprint against the host's own
  `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.

Delete the local key files after storing them.

## What a deploy does

`deploy.sh deploy <commit> <release-id>`, with the CI image on stdin:

1. Loads the image if needed and checks its revision label.
2. Checks out that commit and pins `KAKARAYAN_API_IMAGE` in `.env`.
3. Downloads, verifies, and atomically selects the release generation while the old
   container keeps serving its own files.
4. Restarts the API and waits until `/readyz` reports the release and image commit.
5. Runs a dictionary query, a sentence search, and a sentence detail request.

If any step after the first change fails, it restores the previous checkout, `.env`, data
generation, and containers. The same command works from an SSH session on the host:

```bash
/opt/kakarayan/deploy/lightsail/deploy.sh deploy FULL_COMMIT RELEASE_ID < api-image.tar.gz
/opt/kakarayan/deploy/lightsail/deploy.sh status
```

The image is read from stdin only when it is not already loaded. Activation needs free disk
for the compressed and expanded database plus 256 MiB. The current corpus needs about 10 GB.

## First deploy from the flat layout

Hosts deployed before October 2026 serve `data/formosanbank.sqlite` and
`data/active-release.json` from image `kakarayan-api:lightsail`. The first `deploy.sh` run
leaves those files and that image in place, activates `data/current`, and switches to the
pinned image. If the deploy fails, rollback restores the old checkout and `.env`, so the old
container keeps serving them.

After the new release has served cleanly for a week, remove them:

```bash
cd /opt/kakarayan/deploy/lightsail
sudo rm data/formosanbank.sqlite data/active-release.json
docker image rm kakarayan-api:lightsail
```

## Operations

```bash
cd /opt/kakarayan/deploy/lightsail
./deploy.sh status
docker compose logs --tail=100 api caddy
docker compose logs --no-color --no-log-prefix --since 24h api |
  docker compose exec -T api .venv/bin/python -m api.log_summary
```

`api.log_summary` groups requests by route and status, with bytes, rows, and p95 timing upper
bounds. Logs exclude client IPs, query text, recordings, and model input, so they cannot count
unique people. Both containers rotate three 10 MB log files.

Keep one API worker. Rate and concurrency limits are process-local. Watch memory, swap,
disk, latency, and 429/503/504 counts before changing limits in `.env`. The **Monitor**
workflow checks the public API every 30 minutes and opens an issue when it fails.

## Rollback

Dispatch **Deploy the query API** with the previous release ID, from a `main` commit whose
read-model version matches it. The retained `previous` generation is reselected without a
download. Then deploy Pages with the same ID. GitHub Releases remain the durable data
source; application rollback does not need a snapshot.

## Snapshots and host replacement

Automatic daily snapshots are enabled. Before relying on one, rehearse a restore:

1. Create a disposable instance from a snapshot. Leave the production static IP in place.
2. Verify its disk, image, generation selectors, and local `/readyz`.
3. Delete that instance.

A replacement host gets a new SSH host key even when it receives the old static IP. Update
`LIGHTSAIL_KNOWN_HOSTS` after verifying the new fingerprint. Then confirm:
- `docker compose ps` shows both services healthy;
- `/readyz` reports the same release as Pages;
- one dictionary query and one sentence query succeed over HTTPS.

## Cost and capacity

Production uses the 2 GiB RAM, 2 vCPU, 60 GB general-purpose bundle in Tokyo, listed at
$12 per month with 3 TB transfer. The attached static IP and Caddy certificates are free.
Snapshots are billed per stored GB.

The API container gets 1,400 MiB and Caddy 128 MiB. Query concurrency stays at two, with one
analytical lane, because the plan has two vCPUs. Upsize only if latency, swap use, or memory
pressure regress. The host does not run MT or ASR models; those stay on Hugging Face.
