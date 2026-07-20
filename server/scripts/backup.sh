#!/bin/sh
# Nightly Postgres dump with local retention. Runs inside the cron container
# (which has pg_dump); dumps land in BACKUP_DIR (a host-mounted volume in
# compose, so they survive container rebuilds). Copy them off the server too —
# a backup on the same disk as the database only protects against one class of
# failure.
set -eu

DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DIR"
F="$DIR/yik-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$F"
echo "[backup] wrote $F ($(du -h "$F" | cut -f1))"

find "$DIR" -name 'yik-*.sql.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup] pruned dumps older than $KEEP_DAYS days (kept: $(ls "$DIR" | wc -l))"
