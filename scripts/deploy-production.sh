#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production. Copy .env.production.example and fill every pending value." >&2
  exit 1
fi

npm run doctor:production -- --env=.env.production
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml pull api worker caddy postgres || true
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml build minio backup
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml up -d postgres minio
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml run --rm migrate
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml run --rm object-storage-init
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml up -d api worker caddy backup

docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml ps
api_domain="$(awk -F= '$1=="API_DOMAIN" {print $2}' .env.production | tail -1 | tr -d '\r')"
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "https://${api_domain}/ready" >/dev/null; then
    echo "✓ production readiness verified at https://${api_domain}/ready"
    exit 0
  fi
  sleep 5
done

echo "Deployment started but readiness did not become healthy." >&2
docker compose --env-file .env.production -f infra/compose/docker-compose.production.yml logs --tail=200 api worker caddy >&2
exit 1
