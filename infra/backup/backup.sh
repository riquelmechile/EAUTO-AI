#!/usr/bin/env bash
set -euo pipefail
umask 077

required=(POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD OBJECT_STORAGE_BUCKET RESTIC_REPOSITORY RESTIC_PASSWORD)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required backup variable: ${key}" >&2
    exit 1
  fi
done

export PGPASSWORD="${POSTGRES_PASSWORD}"
export RCLONE_CONFIG_SOURCE_TYPE=s3
export RCLONE_CONFIG_SOURCE_PROVIDER=Minio
export RCLONE_CONFIG_SOURCE_ENDPOINT=http://minio:9000
export RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID="${MINIO_ROOT_USER}"
export RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}"
export RCLONE_CONFIG_SOURCE_ENV_AUTH=false
export AWS_ACCESS_KEY_ID="${RESTIC_AWS_ACCESS_KEY_ID:-}"
export AWS_SECRET_ACCESS_KEY="${RESTIC_AWS_SECRET_ACCESS_KEY:-}"

run_backup() {
  local started snapshot
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  snapshot="/tmp/eauto-backup-${started//[:]/-}"
  mkdir -p "${snapshot}/postgres" "${snapshot}/objects"
  trap 'rm -rf "${snapshot:-}"' RETURN

  pg_dump \
    --host=postgres \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --format=custom \
    --no-owner \
    --file="${snapshot}/postgres/eauto.dump"
  pg_dumpall \
    --host=postgres \
    --username="${POSTGRES_USER}" \
    --globals-only \
    --file="${snapshot}/postgres/globals.sql"
  rclone sync "source:${OBJECT_STORAGE_BUCKET}" "${snapshot}/objects" \
    --checksum --delete-excluded --transfers=4 --checkers=8

  if ! restic snapshots >/dev/null 2>&1; then
    restic init
  fi
  (
    cd "${snapshot}"
    restic backup . --tag eauto-production --host "${HOSTNAME:-eauto-backup}"
  )
  restic forget \
    --tag eauto-production \
    --keep-daily "${BACKUP_RETENTION_DAILY:-7}" \
    --keep-weekly "${BACKUP_RETENTION_WEEKLY:-4}" \
    --keep-monthly "${BACKUP_RETENTION_MONTHLY:-12}" \
    --prune
  restic check --read-data-subset="${BACKUP_CHECK_SUBSET:-1/20}"
  echo "Backup completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

if [[ "${BACKUP_ONCE:-false}" == "true" ]]; then
  run_backup
  exit 0
fi

while true; do
  if ! run_backup; then
    echo "Backup cycle failed at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  fi
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
