#!/usr/bin/env bash
# Respaldo diario: base SQLite (copia consistente) + fotos. Guarda 14 días.
set -euo pipefail
APP_DIR=/opt/coollab
OUT=/var/backups/coollab
D=$(date +%F)
sqlite3 "$APP_DIR/data/coollab.db" ".backup '$OUT/coollab-$D.db'"
tar -czf "$OUT/uploads-$D.tgz" -C "$APP_DIR" uploads
find "$OUT" -type f \( -name 'coollab-*.db' -o -name 'uploads-*.tgz' \) -mtime +14 -delete
echo "$(date -Is) respaldo OK"
