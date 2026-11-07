#!/usr/bin/env bash
# Запускать НА МАКЕ из папки us-app:  ./deploy/ship.sh
# Копирует код на сервер и запускает установку. Пароль root спросит ssh.
set -euo pipefail
cd "$(dirname "$0")/.."
SRV=${1:-root@87.232.67.3}
rsync -az --delete --exclude node_modules --exclude .git --exclude 'server/.env' --exclude 'server/data' --exclude 'web/dist' ./ "$SRV:/opt/us-app/" --rsync-path="mkdir -p /opt/us-app && rsync"
ssh -t "$SRV" 'bash /opt/us-app/deploy/install.sh'
