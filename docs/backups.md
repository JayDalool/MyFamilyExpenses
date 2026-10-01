# Backups and restore

Two things must be backed up together. The database holds expense rows and only the
*path* of each receipt. The uploads volume holds the receipt files themselves.

| What | Where it lives | Backed up by | Kept |
| --- | --- | --- | --- |
| Database | `myfamilyexpenses-db-1`, volume `myfamilyexpenses_postgres-data` | `/srv/server/scripts/backup-postgres.sh` (03:30 nightly, outside this repo) | 14 days |
| Receipt files | `myfamilyexpenses-app-1:/app/uploads`, volume `myfamilyexpenses_uploads-data` | `scripts/backup-uploads.sh` (cron 03:40, installed 2026-09-30) | 60 days |

Both land on the same disk as the app. That protects against a bad deploy or a deleted
volume, not against disk loss. An offsite copy is still open (see `docs/jay/MY_ACTIONS.md`).

## Offsite copy (B2 + USB)

`scripts/backup-offsite.sh` writes an encrypted, versioned copy of the receipts and a
database dump to two restic repositories: Backblaze B2 and a USB disk. It exits non-zero
unless both succeed, so a missing disk is never silent. Retention: 7 daily, 8 weekly,
12 monthly, 3 yearly. Each run also read-checks 5% of the stored data.

Setup (Jay, once):

1. Backblaze: make a private bucket and an application key limited to that bucket.
2. Make a restic password. Save it in your password manager, NOT only on this server.
3. Create `/srv/server/private/myfamilyexpenses/offsite.env` (mode 600) with the values
   listed at the top of `scripts/backup-offsite.sh`, and the password file it points to.
4. Format the USB disk, mount it at `/mnt/mfe-backup` (fstab, by UUID, `nofail`).
5. Run `scripts/backup-offsite.sh` once by hand, then add the cron line.

```cron
0 4 * * * /srv/server/repos/MyFamilyExpenses/scripts/backup-offsite.sh >> /srv/server/backups/uploads/offsite.log 2>&1
```

Restore from either repo: `restic -r <repo> snapshots`, then
`restic -r <repo> dump latest uploads.tar --tag uploads > uploads.tar`.

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
