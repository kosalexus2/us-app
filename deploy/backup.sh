#!/usr/bin/env bash
# Daily SQLite backup (safe while the app is running). Cron example:
#   15 4 * * * /opt/us-app/deploy/backup.sh
set -euo pipefail
DIR=/opt/us-app/backups
mkdir -p "$DIR"
sqlite3 /opt/us-app/server/data/us-app.db ".backup '$DIR/us-app-$(date +%F).db'"
find "$DIR" -name 'us-app-*.db' -mtime +14 -delete
