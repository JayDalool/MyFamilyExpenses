# Backups and restore

Two things must be backed up together. The database holds expense rows and only the
*path* of each receipt. The uploads volume holds the receipt files themselves.

| What | Where it lives | Backed up by | Kept |
| --- | --- | --- | --- |
| Database | `myfamilyexpenses-db-1`, volume `myfamilyexpenses_postgres-data` | `/srv/server/scripts/backup-postgres.sh` (03:30 nightly, outside this repo) | 14 days |
| Receipt files | `myfamilyexpenses-app-1:/app/uploads`, volume `myfamilyexpenses_uploads-data` | `scripts/backup-uploads.sh` | 60 days |

Both land on the same disk as the app. That protects against a bad deploy or a deleted
volume, not against disk loss. An offsite copy is still open (see `docs/jay/MY_ACTIONS.md`).

## Receipt-file backup

```bash
scripts/backup-uploads.sh                 # default: /srv/server/backups/uploads/myfamilyexpenses
scripts/backup-uploads.sh /some/dir       # custom location
```

It streams a tarball out of the app container, then reads it back. The backup fails and
is discarded unless the archive holds the same number of files as the live volume.

To run it nightly, add a cron line after the database backup (03:30):

```cron
40 3 * * * /srv/server/repos/MyFamilyExpenses/scripts/backup-uploads.sh >> /srv/server/backups/uploads/backup.log 2>&1
```

## Restore

Receipt files (into a scratch folder first, then copy what you need):

```bash
mkdir -p /tmp/restore && tar -xzf uploads_<date>.tar.gz -C /tmp/restore
# to put files back into the live volume:
docker cp /tmp/restore/uploads/. myfamilyexpenses-app-1:/app/uploads/
```

Database: load the dump into a throwaway database first and check the row counts before
touching the real one.

```bash
docker exec myfamilyexpenses-db-1 sh -c 'createdb -U "$POSTGRES_USER" mfe_restore_drill'
gunzip -c <dump>.sql.gz | docker exec -i myfamilyexpenses-db-1 sh -c 'psql -U "$POSTGRES_USER" -d mfe_restore_drill -v ON_ERROR_STOP=1'
docker exec myfamilyexpenses-db-1 sh -c 'psql -U "$POSTGRES_USER" -d mfe_restore_drill -c "select count(*) from expenses"'
docker exec myfamilyexpenses-db-1 sh -c 'dropdb -U "$POSTGRES_USER" mfe_restore_drill'
```

## Drill log

| Date | What | Result |
| --- | --- | --- |
| 2026-09-30 | Receipt files: backup, extract, SHA-256 compare with the live volume | 142 of 142 files identical. Archive 335 MB. |
| not yet | Database dump loaded into a throwaway database, row counts compared | Pending (Jay) |
