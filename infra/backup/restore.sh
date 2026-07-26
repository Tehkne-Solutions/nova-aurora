#!/bin/sh
set -eu

backup_file="${1:-}"
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "Uso: CONFIRM_RESTORE=RESTORE_NOVA_AURORA $0 /backups/arquivo.dump" >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE:-}" != "RESTORE_NOVA_AURORA" ]; then
  echo "Restauração bloqueada. Defina CONFIRM_RESTORE=RESTORE_NOVA_AURORA." >&2
  exit 3
fi

checksum_file="$backup_file.sha256"
if [ -f "$checksum_file" ]; then
  (cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$checksum_file")")
fi
pg_restore --list "$backup_file" >/dev/null

export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
PGHOST="${POSTGRES_HOST:-postgres}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-nova_aurora}"
PGDATABASE="${POSTGRES_DB:-nova_aurora}"

printf '{"timestamp":"%s","level":"warning","service":"nova-aurora-restore","event":"restore.started","database":"%s","file":"%s","signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PGDATABASE" "$backup_file"

pg_restore \
  --host "$PGHOST" \
  --port "$PGPORT" \
  --username "$PGUSER" \
  --dbname "$PGDATABASE" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$backup_file"

printf '{"timestamp":"%s","level":"info","service":"nova-aurora-restore","event":"restore.completed","database":"%s","file":"%s","signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PGDATABASE" "$backup_file"
