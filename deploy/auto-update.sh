#!/usr/bin/env bash
# Автообновление Us App: раз в минуту (cron) проверяет GitHub и при новом коммите пересобирает и перезапускает контейнер.
# Данные (/opt/us-app/data) и настройки (server/.env) не трогаются. CRM и другие контейнеры не затрагиваются.
set -euo pipefail
APP=/opt/us-app
cd "$APP"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
echo "$(date -Is) найдено обновление, собираю"
git reset -q --hard origin/main
CADDY=$(docker ps --format '{{.Names}}' | grep -i caddy | head -1)
NET=$(docker inspect "$CADDY" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
docker build -f "$APP/Dockerfile.usapp" -t us-app "$APP"
docker rm -f us-app >/dev/null 2>&1 || true
docker run -d --name us-app --restart unless-stopped --network "$NET" --memory 300m \
  --env-file "$APP/server/.env" -e HOST=0.0.0.0 -e PORT=3100 -e DB_PATH=/data/us-app.db \
  -v "$APP/data:/data" us-app >/dev/null
docker image prune -f >/dev/null 2>&1 || true
echo "$(date -Is) обновлено до $(git rev-parse --short HEAD)"
