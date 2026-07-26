#!/bin/sh
set -eu

backup_file="${1:-}"
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "Uso: $0 /backups/arquivo.dump" >&2
  exit 2
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
verification_db="nova_aurora_verify_$(date -u +%s)_$$"

cleanup() {
  dropdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" --if-exists "$verification_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

createdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" "$verification_db"
pg_restore \
  --host "$PGHOST" \
  --port "$PGPORT" \
  --username "$PGUSER" \
  --dbname "$verification_db" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$backup_file"

psql --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" --dbname "$verification_db" --set ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  users_count bigint;
  accounts_count bigint;
  unbalanced_count bigint;
BEGIN
  SELECT count(*) INTO users_count FROM users;
  SELECT count(*) INTO accounts_count FROM ledger_accounts;
  SELECT count(*) INTO unbalanced_count
  FROM (
    SELECT transaction_id
    FROM ledger_entries
    GROUP BY transaction_id
    HAVING sum(amount_minor) <> 0
  ) invalid_transactions;

  IF users_count < 2 THEN
    RAISE EXCEPTION 'Backup inválido: usuários ausentes.';
  END IF;
  IF accounts_count = 0 THEN
    RAISE EXCEPTION 'Backup inválido: contas do ledger ausentes.';
  END IF;
  IF unbalanced_count <> 0 THEN
    RAISE EXCEPTION 'Backup inválido: % transações desequilibradas.', unbalanced_count;
  END IF;
END $$;
SQL

printf '{"timestamp":"%s","level":"info","service":"nova-aurora-backup-verifier","event":"backup.verified","file":"%s","temporaryDatabase":"%s","signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$backup_file" "$verification_db"
