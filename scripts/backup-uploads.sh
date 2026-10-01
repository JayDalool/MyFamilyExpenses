#!/usr/bin/env bash
# Back up the receipt files (the app's /app/uploads volume).
#
# The nightly pg_dump only stores file *paths*. Without this, a lost volume
# leaves the database pointing at receipts that no longer exist.
#
# Usage: scripts/backup-uploads.sh [backup-root]
# Env:   APP_CONTAINER (default myfamilyexpenses-app-1)
#        KEEP_DAYS     (default 60; receipts can be legal records, keep longer than the DB dumps)
#
# A backup only counts once it is read back: the archive must list cleanly and
# hold the same number of files as the live volume.
set -euo pipefail

BACKUP_ROOT="${1:-/srv/server/backups/uploads/myfamilyexpenses}"
APP_CONTAINER="${APP_CONTAINER:-myfamilyexpenses-app-1}"
KEEP_DAYS="${KEEP_DAYS:-60}"
DATE="$(date +%F_%H-%M-%S)"
OUT="$BACKUP_ROOT/uploads_$DATE.tar.gz"
TMP="$OUT.partial"

mkdir -p "$BACKUP_ROOT"
trap 'rm -f "$TMP"' EXIT

docker exec "$APP_CONTAINER" tar -czf - -C /app uploads > "$TMP"

live_count="$(docker exec "$APP_CONTAINER" sh -c 'find /app/uploads -type f | wc -l')"
archive_count="$(tar -tzf "$TMP" | grep -vc '/$' || true)"

if [ "$live_count" -ne "$archive_count" ]; then
  echo "BACKUP FAILED: live volume has $live_count files, archive has $archive_count" >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT
chmod 640 "$OUT"

find "$BACKUP_ROOT" -type f -name 'uploads_*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Uploads backup ok: $OUT ($archive_count files, $(du -h "$OUT" | cut -f1))"
