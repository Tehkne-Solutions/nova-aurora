#!/bin/sh
set -eu

backup_file="${1:-}"
DATA_DIR="${OBJECT_STORAGE_DATA_DIR:-/data}"

if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "Uso: CONFIRM_OBJECT_STORAGE_OFFLINE=OBJECT_STORAGE_IS_STOPPED CONFIRM_OBJECT_STORAGE_RESTORE=RESTORE_NOVA_AURORA_OBJECT_STORAGE $0 /backups/arquivo.tar.gz" >&2
  exit 2
fi
if [ "${CONFIRM_OBJECT_STORAGE_OFFLINE:-}" != "OBJECT_STORAGE_IS_STOPPED" ]; then
  echo "Restauração bloqueada. Pare o object storage e confirme CONFIRM_OBJECT_STORAGE_OFFLINE=OBJECT_STORAGE_IS_STOPPED." >&2
  exit 3
fi
if [ "${CONFIRM_OBJECT_STORAGE_RESTORE:-}" != "RESTORE_NOVA_AURORA_OBJECT_STORAGE" ]; then
  echo "Restauração bloqueada. Defina CONFIRM_OBJECT_STORAGE_RESTORE=RESTORE_NOVA_AURORA_OBJECT_STORAGE." >&2
  exit 4
fi

checksum_file="$backup_file.sha256"
if [ ! -f "$checksum_file" ]; then
  echo "Checksum obrigatório não encontrado: $checksum_file" >&2
  exit 5
fi
(cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$checksum_file")")
tar -tzf "$backup_file" >/dev/null

mkdir -p "$DATA_DIR"
printf '{"timestamp":"%s","level":"warning","service":"nova-aurora-object-storage-restore","event":"restore.started","file":"%s","signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$backup_file"

find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -C "$DATA_DIR" -xzf "$backup_file"

printf '{"timestamp":"%s","level":"info","service":"nova-aurora-object-storage-restore","event":"restore.completed","file":"%s","signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$backup_file"

# Tehkné Solutions
