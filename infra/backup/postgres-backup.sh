#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-/backup/postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
VERIFY="${BACKUP_VERIFY:-true}"

mkdir -p "$BACKUP_DIR"

run_backup() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="$BACKUP_DIR/food-rescue-$timestamp.dump"
  latest="$BACKUP_DIR/latest.dump"

  echo "Starting PostgreSQL backup $file"
  pg_dump "$DATABASE_URL" --format=custom --blobs --no-owner --no-acl --file="$file"

  if [ "$VERIFY" = "true" ]; then
    pg_restore --list "$file" >/dev/null
    echo "Backup archive verified"
  fi

  ln -sf "$file" "$latest"
  find "$BACKUP_DIR" -name 'food-rescue-*.dump' -type f -mtime +"$RETENTION_DAYS" -delete
  echo "PostgreSQL backup complete"
}

while true; do
  run_backup
  sleep "$INTERVAL_SECONDS"
done
