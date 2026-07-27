#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production. Copy .env.production.example and fill every pending value." >&2
  exit 1
fi

compose=(docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml)

npm run doctor:production -- --env=.env.production
"${compose[@]}" config --quiet

eauto_image="$(awk -F= '$1=="EAUTO_IMAGE" {sub(/^[^=]*=/, ""); print; exit}' .env.production | tr -d '\r')"
if [[ -z "${eauto_image}" ]]; then
  echo "EAUTO_IMAGE is missing after production validation." >&2
  exit 1
fi
printf 'Deploying immutable runtime: %s\n' "${eauto_image}"

# A pull failure is fatal. Continuing would silently redeploy an older local image.
"${compose[@]}" pull --policy always api worker migrate object-storage-init caddy postgres
"${compose[@]}" build --pull minio backup

docker image inspect "${eauto_image}" >/dev/null

"${compose[@]}" up -d postgres minio
"${compose[@]}" run --rm migrate
"${compose[@]}" run --rm object-storage-init
"${compose[@]}" up -d api worker caddy backup

"${compose[@]}" ps
api_domain="$(awk -F= '$1=="API_DOMAIN" {sub(/^[^=]*=/, ""); print; exit}' .env.production | tr -d '\r')"
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "https://${api_domain}/ready" >/dev/null; then
    echo "✓ production readiness verified at https://${api_domain}/ready"
    echo "✓ deployed ${eauto_image}"
    exit 0
  fi
  sleep 5
done

echo "Deployment started but readiness did not become healthy. Automatic rollback was not attempted because database migrations are forward-only." >&2
"${compose[@]}" logs --tail=200 api worker caddy >&2
exit 1
