#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore refused. Set CONFIRM_RESTORE=YES after stopping API and worker." >&2
  exit 1
fi
required=(POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD OBJECT_STORAGE_BUCKET RESTIC_REPOSITORY RESTIC_PASSWORD)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required restore variable: ${key}" >&2
    exit 1
  fi
done

export PGPASSWORD="${POSTGRES_PASSWORD}"
export RCLONE_CONFIG_DESTINATION_TYPE=s3
export RCLONE_CONFIG_DESTINATION_PROVIDER=Minio
export RCLONE_CONFIG_DESTINATION_ENDPOINT=http://minio:9000
export RCLONE_CONFIG_DESTINATION_ACCESS_KEY_ID="${MINIO_ROOT_USER}"
export RCLONE_CONFIG_DESTINATION_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}"
export RCLONE_CONFIG_DESTINATION_ENV_AUTH=false
export AWS_ACCESS_KEY_ID="${RESTIC_AWS_ACCESS_KEY_ID:-}"
export AWS_SECRET_ACCESS_KEY="${RESTIC_AWS_SECRET_ACCESS_KEY:-}"

restore_root="/tmp/eauto-restore"
rm -rf "${restore_root}"
mkdir -p "${restore_root}"
restic check
restic restore "${RESTORE_SNAPSHOT:-latest}" --target "${restore_root}" --tag eauto-production

dump="$(find "${restore_root}" -type f -path '*/postgres/eauto.dump' -print -quit)"
objects="$(find "${restore_root}" -type d -path '*/objects' -print -quit)"
if [[ -z "${dump}" || -z "${objects}" ]]; then
  echo "Restore snapshot does not contain the expected database and object data." >&2
  exit 1
fi

pg_restore \
  --host=postgres \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --clean --if-exists --no-owner --exit-on-error \
  "${dump}"
rclone sync "${objects}" "destination:${OBJECT_STORAGE_BUCKET}" \
  --checksum --delete-during --transfers=4 --checkers=8
rm -rf "${restore_root}"
echo "Restore completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
