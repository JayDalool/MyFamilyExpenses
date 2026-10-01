#!/usr/bin/env bash
# Encrypted offsite copy of receipts + database with restic.
# Two targets: Backblaze B2 and a USB disk. A target that is not configured or not
# reachable is reported loudly. The script exits non-zero unless BOTH succeed.
#
# Config lives outside the repo, in a file only Jay creates (never committed):
#   OFFSITE_ENV (default /srv/server/private/myfamilyexpenses/offsite.env), mode 600
#
#   RESTIC_PASSWORD_FILE=/srv/server/private/myfamilyexpenses/restic.pass
#   B2_ACCOUNT_ID=...            # application key id (restricted to the one bucket)
#   B2_ACCOUNT_KEY=...
#   B2_REPO=b2:<bucket>:myfamilyexpenses
#   USB_MOUNT=/mnt/mfe-backup    # must be a real mount point
#   USB_REPO=/mnt/mfe-backup/restic-myfamilyexpenses
#
# Both repos use the same password file. Keep a copy of that password OFF this server.
set -uo pipefail

OFFSITE_ENV="${OFFSITE_ENV:-/srv/server/private/myfamilyexpenses/offsite.env}"
APP_CONTAINER="${APP_CONTAINER:-myfamilyexpenses-app-1}"
DB_CONTAINER="${DB_CONTAINER:-myfamilyexpenses-db-1}"

if [ ! -r "$OFFSITE_ENV" ]; then
  echo "OFFSITE FAILED: cannot read $OFFSITE_ENV" >&2
  exit 2
fi
# shellcheck disable=SC1090
set -a; . "$OFFSITE_ENV"; set +a

: "${RESTIC_PASSWORD_FILE:?missing in $OFFSITE_ENV}"

backup_to() {
  local repo="$1"
  restic -r "$repo" cat config >/dev/null 2>&1 || restic -r "$repo" init || return 1

  docker exec "$APP_CONTAINER" tar -cf - -C /app uploads \
    | restic -r "$repo" backup --stdin --stdin-filename uploads.tar --tag uploads || return 1

  docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    | restic -r "$repo" backup --stdin --stdin-filename database.sql --tag database || return 1

  # Keep 7 daily, 8 weekly, 12 monthly, 3 yearly versions of each.
  restic -r "$repo" forget --group-by tags --keep-daily 7 --keep-weekly 8 \
    --keep-monthly 12 --keep-yearly 3 --prune || return 1
  # Read-check a sample of the stored data each run.
  restic -r "$repo" check --read-data-subset=5% || return 1
}

status=0

if [ -n "${B2_REPO:-}" ] && [ -n "${B2_ACCOUNT_ID:-}" ]; then
  echo "== B2 =="
  backup_to "$B2_REPO" && echo "B2 ok" || { echo "B2 FAILED" >&2; status=1; }
else
  echo "B2 NOT CONFIGURED" >&2; status=1
fi

if [ -n "${USB_REPO:-}" ] && [ -n "${USB_MOUNT:-}" ] && mountpoint -q "$USB_MOUNT"; then
  echo "== USB =="
  backup_to "$USB_REPO" && echo "USB ok" || { echo "USB FAILED" >&2; status=1; }
else
  echo "USB NOT MOUNTED OR NOT CONFIGURED" >&2; status=1
fi

exit "$status"
