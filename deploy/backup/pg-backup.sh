#!/usr/bin/env bash
# Encrypted, offsite Postgres backup for docker-compose.prod.yml.
#
# Runs on the HOST (not in a container), from the host crontab, e.g.:
#   17 3 * * * cd /opt/blazeflow && deploy/backup/pg-backup.sh >> /var/log/blazeflow-backup.log 2>&1
#
#   1. pg_dump -Fc inside the `db` container (consistent snapshot, no downtime)
#   2. encrypt with age to a PUBLIC key (the box can write backups but can't read them;
#      the private key lives offline with the owner, never on the server)
#   3. upload to an offsite rclone remote (a separate R2 bucket / Hetzner Storage Box / S3)
#   4. prune: local copies older than LOCAL_RETENTION_DAYS, remote older than RETENTION_DAYS
#
# Config: deploy/backup/backup.env (copy backup.env.example), never committed.
# Needs on the host: docker compose, age (https://age-encryption.org), rclone.
# Restore: docs/backup-restore.md
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/backup.env}"
# shellcheck source=/dev/null
[[ -f "$ENV_FILE" ]] && set -a && . "$ENV_FILE" && set +a

: "${AGE_RECIPIENT:?Set AGE_RECIPIENT (age public key, age1...) in backup.env}"
: "${RCLONE_REMOTE:?Set RCLONE_REMOTE (e.g. offsite:blazeflow-backups/postgres) in backup.env}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$HERE/../.." && pwd)}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/blazeflow}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-3}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"   # optional dead-man's switch (healthchecks.io etc.)

for bin in docker age rclone; do command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }; done
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] || { echo "RETENTION_DAYS must be >= 1" >&2; exit 1; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAILED: $*"; rm -f "${tmp:-}"; [[ -n "$HEALTHCHECK_URL" ]] && curl -fsS -m 10 "$HEALTHCHECK_URL/fail" >/dev/null || true; exit 1; }
trap 'fail "line $LINENO"' ERR

mkdir -p "$LOCAL_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$LOCAL_DIR/blazeflow-$stamp.dump.age"
tmp="$out.partial"

log "dumping database"
cd "$COMPOSE_DIR"
# The dump never touches disk unencrypted: pg_dump | age > file.
# pipefail makes a pg_dump failure fail the whole pipeline.
$COMPOSE exec -T db sh -c 'pg_dump -Fc --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | age -r "$AGE_RECIPIENT" -o "$tmp"
[[ -s "$tmp" ]] || fail "empty dump"
mv "$tmp" "$out"
sha256sum "$out" | awk '{print $1}' > "$out.sha256"
log "wrote $(basename "$out") ($(du -h "$out" | cut -f1))"

log "uploading to $RCLONE_REMOTE"
rclone copy --no-traverse "$out" "$RCLONE_REMOTE/"
rclone copy --no-traverse "$out.sha256" "$RCLONE_REMOTE/"
rclone check --one-way --size-only "$LOCAL_DIR" "$RCLONE_REMOTE" --include "$(basename "$out")" \
  || fail "upload verification"

log "pruning remote copies older than ${RETENTION_DAYS}d, local older than ${LOCAL_RETENTION_DAYS}d"
rclone delete --min-age "${RETENTION_DAYS}d" --include 'blazeflow-*.dump.age*' "$RCLONE_REMOTE"
find "$LOCAL_DIR" -maxdepth 1 -name 'blazeflow-*.dump.age*' -mtime "+$LOCAL_RETENTION_DAYS" -delete

[[ -n "$HEALTHCHECK_URL" ]] && curl -fsS -m 10 "$HEALTHCHECK_URL" >/dev/null || true
log "done"
