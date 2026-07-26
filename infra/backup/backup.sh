#!/bin/sh
set -eu

export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
PGHOST="${POSTGRES_HOST:-postgres}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-nova_aurora}"
PGDATABASE="${POSTGRES_DB:-nova_aurora}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

backup_once() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  final="$BACKUP_DIR/nova-aurora-$timestamp.dump"
  temporary="$final.tmp"
  metadata="$final.json"

  echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"info\",\"service\":\"nova-aurora-backup\",\"event\":\"backup.started\",\"signature\":\"Tehkné Solutions\"}"
  pg_dump \
    --host "$PGHOST" \
    --port "$PGPORT" \
    --username "$PGUSER" \
    --dbname "$PGDATABASE" \
    --format custom \
    --compress 9 \
    --no-owner \
    --no-acl \
    --file "$temporary"

  pg_restore --list "$temporary" >/dev/null
  mv "$temporary" "$final"
  sha256sum "$final" >"$final.sha256"
  size="$(wc -c <"$final" | tr -d ' ')"
  checksum="$(cut -d' ' -f1 <"$final.sha256")"
  printf '{"database":"%s","createdAt":"%s","sizeBytes":%s,"sha256":"%s","format":"pg_dump-custom","signature":"Tehkné Solutions"}\n' \
    "$PGDATABASE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$size" "$checksum" >"$metadata"

  find "$BACKUP_DIR" -type f -name 'nova-aurora-*' -mtime "+$RETENTION_DAYS" -delete
  echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"info\",\"service\":\"nova-aurora-backup\",\"event\":\"backup.completed\",\"file\":\"$final\",\"sizeBytes\":$size,\"signature\":\"Tehkné Solutions\"}"
}

while true; do
  if ! backup_once; then
    rm -f "$BACKUP_DIR"/*.tmp
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"error\",\"service\":\"nova-aurora-backup\",\"event\":\"backup.failed\",\"signature\":\"Tehkné Solutions\"}" >&2
  fi
  sleep "$INTERVAL_SECONDS"
done
