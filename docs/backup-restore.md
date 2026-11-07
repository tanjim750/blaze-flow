# Postgres backups and restore

`deploy/backup/pg-backup.sh` takes an encrypted, offsite backup of the production database.
It runs on the host from cron: `pg_dump -Fc` inside the `db` container, piped straight into
[age](https://age-encryption.org) (the plain dump never touches disk), then uploaded with
[rclone](https://rclone.org) to a separate bucket, then pruned.

| What | Default | Setting |
| --- | --- | --- |
| Offsite copies kept | 30 days | `RETENTION_DAYS` |
| Local copies kept (fast restores) | 3 days | `LOCAL_RETENTION_DAYS`, in `LOCAL_DIR` (`/var/backups/blazeflow`) |
| Encryption | age, public-key | `AGE_RECIPIENT` (public key only on the server) |
| Alerting | optional | `HEALTHCHECK_URL` (pinged on success, `/fail` on failure) |

For defence in depth, also set a lifecycle rule on the bucket that deletes objects after
`RETENTION_DAYS + 7` days. Prefer bucket credentials that can't overwrite or delete (object
lock or versioning), so a compromised server can't wipe its own backups.

## One-time setup (owner)

1. **On your own machine, not the server**, create the key pair:
   `age-keygen -o blazeflow-backup.key`. It prints the public key (`age1...`). Store
   `blazeflow-backup.key` in your password manager plus one offline copy. **Without it the
   backups can't be decrypted.**
2. On the server: `apt install age rclone`, then `rclone config` and add a remote (e.g.
   `offsite`) for a bucket that is **separate from the media bucket**, such as a second R2
   bucket with its own API token scoped to that bucket, or a Hetzner Storage Box.
3. `cp deploy/backup/backup.env.example deploy/backup/backup.env && chmod 600 deploy/backup/backup.env`,
   then fill in `AGE_RECIPIENT` and `RCLONE_REMOTE`. The file is git-ignored.
4. Run it once by hand: `deploy/backup/pg-backup.sh`. It should end with `done`, and
   `rclone ls offsite:blazeflow-backups/postgres` should list the file.
5. Add the cron job (`crontab -e` as a user that can run `docker compose`):
   ```
   17 3 * * * cd /opt/blazeflow && deploy/backup/pg-backup.sh >> /var/log/blazeflow-backup.log 2>&1
   ```
   That is 03:17 server time, after the 02:xx maintenance jobs in `deploy/crontab`.

## Restore

Practise this before you need it: restore into a scratch database once a quarter (step 4).

1. Get the backup. Use the newest local copy in `/var/backups/blazeflow`, or download one:
   ```sh
   rclone lsl offsite:blazeflow-backups/postgres | sort -k2,3 | tail
   rclone copy offsite:blazeflow-backups/postgres/blazeflow-YYYYMMDDTHHMMSSZ.dump.age .
   rclone copy offsite:blazeflow-backups/postgres/blazeflow-YYYYMMDDTHHMMSSZ.dump.age.sha256 .
   [ "$(sha256sum blazeflow-*.dump.age | cut -d' ' -f1)" = "$(cat blazeflow-*.dump.age.sha256)" ] && echo checksum-ok
   ```
2. Decrypt where the private key is (copy it to the server only for the restore, then delete it):
   `age -d -i blazeflow-backup.key -o restore.dump blazeflow-YYYYMMDDTHHMMSSZ.dump.age`
3. **Full restore over production** (downtime; stop the writers first):
   ```sh
   dc() { docker compose -f docker-compose.prod.yml --env-file .env.production "$@"; }
   dc stop web frontend scheduler outbox-worker ai-qa-worker   # whichever are running
   dc exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < restore.dump
   dc run --rm migrate      # no-op if the dump is from the same release
   dc up -d
   curl -fsS http://127.0.0.1:3000/api/health/ready/
   ```
4. **Test restore into a scratch database** (no downtime, for drills):
   ```sh
   dc exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_test'
   dc exec -T db sh -c 'pg_restore --no-owner -U "$POSTGRES_USER" -d restore_test' < restore.dump
   dc exec -T db psql -U blazeflow -d restore_test -c 'select count(*) from users;'
   dc exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_test'
   ```
5. `shred -u restore.dump blazeflow-backup.key` on the server when done.

Media files live in R2, not in Postgres. Turn on R2 bucket versioning or a replica bucket
separately if you need point-in-time recovery for files too.
