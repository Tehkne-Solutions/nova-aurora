#!/bin/sh
set -eu

DATA_DIR="${OBJECT_STORAGE_DATA_DIR:-/data}"
BACKUP_DIR="${OBJECT_STORAGE_BACKUP_DIR:-/backups}"
RETENTION_DAYS="${OBJECT_STORAGE_BACKUP_RETENTION_DAYS:-14}"

if [ "${CONFIRM_OBJECT_STORAGE_OFFLINE:-}" != "OBJECT_STORAGE_IS_STOPPED" ]; then
  echo "Backup bloqueado. Pare o object storage e defina CONFIRM_OBJECT_STORAGE_OFFLINE=OBJECT_STORAGE_IS_STOPPED." >&2
  exit 3
fi
if [ ! -d "$DATA_DIR" ]; then
  echo "Diretório de dados do object storage não encontrado: $DATA_DIR" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/nova-aurora-object-storage-$timestamp.tar.gz"
temporary="$final.tmp"
metadata="$final.json"

printf '{"timestamp":"%s","level":"info","service":"nova-aurora-object-storage-backup","event":"backup.started","signature":"Tehkné Solutions"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

tar -C "$DATA_DIR" -czf "$temporary" .
tar -tzf "$temporary" >/dev/null
mv "$temporary" "$final"
sha256sum "$final" >"$final.sha256"
size="$(wc -c <"$final" | tr -d ' ')"
checksum="$(cut -d' ' -f1 <"$final.sha256")"
printf '{"kind":"seaweedfs-offline-volume-snapshot","createdAt":"%s","sizeBytes":%s,"sha256":"%s","signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$size" "$checksum" >"$metadata"

find "$BACKUP_DIR" -type f -name 'nova-aurora-object-storage-*' -mtime "+$RETENTION_DAYS" -delete
printf '{"timestamp":"%s","level":"info","service":"nova-aurora-object-storage-backup","event":"backup.completed","file":"%s","sizeBytes":%s,"signature":"Tehkné Solutions"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$final" "$size"

# Tehkné Solutions
