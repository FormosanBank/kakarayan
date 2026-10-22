#!/usr/bin/env bash
# Deploy one CI-tested API image and one published data release on the Lightsail host.
#
# Runs as the forced command of the restricted deploy key, or locally on the host:
#   deploy.sh deploy <commit> <release-id> < api-image.tar.gz
#   deploy.sh status
# The image is read from stdin only when it is not already loaded. Any failure after the
# first change restores the previous checkout, .env, data generation, and containers.
set -euo pipefail

cd "$(dirname "$0")"
repo=$(git rev-parse --show-toplevel)
api=http://127.0.0.1:7860
releases=${KAKARAYAN_RELEASES_URL:-https://github.com/FormosanBank/kakarayan/releases/download}
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-$*}"

status() {
  curl -fsS --max-time 5 "$api/readyz" || echo "readyz unavailable"
  echo
  docker compose ps --format '{{.Service}}: {{.Status}}'
  df -h --output=avail / | tail -1 | xargs echo "free disk:"
}

case "${args[0]:-}" in
  status) status; exit 0 ;;
  deploy) ;;
  *) echo "usage: deploy <commit> <release-id> | status" >&2; exit 2 ;;
esac
commit=${args[1]:-}
release=${args[2]:-}
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit: $commit" >&2; exit 2; }
[[ $release =~ ^fb-[0-9]{8}-[0-9a-f]{7,12}$ ]] || { echo "invalid release: $release" >&2; exit 2; }
image="kakarayan-api:$commit"
manifest_url() {
  echo "$releases/data-$1/release-manifest.json"
}

exec 9> "$repo/.deploy.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

if ! docker image inspect "$image" > /dev/null 2>&1; then
  echo "loading $image"
  gunzip | docker load > /dev/null
fi
revision=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[ "$revision" = "$commit" ] || { echo "$image was built from $revision" >&2; exit 1; }

previous_commit=$(git -C "$repo" rev-parse HEAD)
previous_release=$(curl -fsS --max-time 5 "$api/readyz" | jq -r '.release_id // empty' || true)
cp .env .env.previous

rollback() {
  echo "deploy failed; restoring $previous_commit and ${previous_release:-the previous data}" >&2
  git -C "$repo" checkout -q --detach "$previous_commit"
  cp .env.previous .env
  if [ -n "$previous_release" ] && [ -d "data/generations/$previous_release" ]; then
    docker compose run --rm --no-deps api .venv/bin/python -m api.prepare_release \
      --manifest "$(manifest_url "$previous_release")" --data-root /data || true
  fi
  docker compose up -d --remove-orphans
}
trap rollback ERR

echo "checking out $commit"
git -C "$repo" fetch -q origin
git -C "$repo" checkout -q --detach "$commit"
if grep -q '^KAKARAYAN_API_IMAGE=' .env; then
  sed -i "s|^KAKARAYAN_API_IMAGE=.*|KAKARAYAN_API_IMAGE=$image|" .env
else
  echo "KAKARAYAN_API_IMAGE=$image" >> .env
fi

# The running container keeps its own files open, so it serves until the restart below.
echo "activating $release"
docker compose run --rm --no-deps api .venv/bin/python -m api.prepare_release \
  --manifest "$(manifest_url "$release")" --data-root /data
docker compose up -d --remove-orphans

echo "waiting for readiness"
for _ in $(seq 60); do
  if curl -fsS --max-time 3 "$api/readyz" 2> /dev/null \
    | jq -e --arg r "$release" --arg c "$commit" \
      '.release_id == $r and .image_commit == $c' > /dev/null; then
    break
  fi
  sleep 3
done
curl -fsS --max-time 3 "$api/readyz" \
  | jq -e --arg r "$release" --arg c "$commit" '.release_id == $r and .image_commit == $c'

echo "running smoke queries"
query="$api/v1/releases/$release"
curl -fsS --max-time 15 "$query/dictionary?q=mama&language_id=lang_amis&match=exact" > /dev/null
sentence=$(curl -fsS --max-time 15 \
  "$query/concordance?q=mama&language_id=lang_amis&match=contains&limit=1" | jq -er '.items[0].id')
curl -fsS --max-time 15 "$query/sentences/$sentence" > /dev/null

trap - ERR
echo "deployed $image with $release"
status
