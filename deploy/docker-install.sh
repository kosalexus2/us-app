#!/usr/bin/env bash
# Установка Us App на сервер, где уже работают Docker и Caddy в контейнере (CRM и др.).
# Ничего чужого не трогает: добавляет свой контейнер us-app и один блок в Caddyfile (с резервной копией).
# Запуск на сервере под root:  bash <(curl -fsSL https://raw.githubusercontent.com/kosalexus2/us-app/main/deploy/docker-install.sh)
set -euo pipefail
DOMAIN=usapp.kosalexus.by
APP=/opt/us-app
REPO=https://github.com/kosalexus2/us-app.git

echo "== 1. Проверка сервера (только чтение) =="
command -v docker >/dev/null || { echo "Docker не найден"; exit 2; }
CADDY=$(docker ps --format '{{.Names}}' | grep -i caddy | head -1 || true)
[ -n "$CADDY" ] || { echo "Контейнер Caddy не найден. Пришлите вывод 'docker ps' Claude."; exit 2; }
NET=$(docker inspect "$CADDY" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
CF=$(docker inspect "$CADDY" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -z "$CF" ]; then
  D=$(docker inspect "$CADDY" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')
  [ -n "$D" ] && CF="$D/Caddyfile"
fi
[ -n "$CF" ] && [ -f "$CF" ] || { echo "Не нашёл Caddyfile (контейнер $CADDY). Пришлите вывод Claude."; exit 2; }
echo "Caddy: $CADDY, сеть: $NET, Caddyfile: $CF"
free -m | head -2

echo "== 2. Код =="
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git >/dev/null; }
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else rm -rf "$APP"; git clone --depth 1 "$REPO" "$APP"; fi
mkdir -p "$APP/data"

echo "== 3. Настройки =="
if [ ! -f "$APP/server/.env" ]; then
  cp "$APP/server/.env.example" "$APP/server/.env"
  read -r -s -p "Вставьте токен бота от BotFather (ввод скрыт) и нажмите Enter: " TOK </dev/tty; echo
  read -r -p "Username бота без @ [usapp_kosalexus_bot]: " BU </dev/tty
  BU=${BU:-usapp_kosalexus_bot}
  SEC=$(openssl rand -hex 24)
  sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$TOK|; s|^BOT_USERNAME=.*|BOT_USERNAME=$BU|; s|^WEBHOOK_SECRET=.*|WEBHOOK_SECRET=$SEC|" "$APP/server/.env"
fi
chmod 600 "$APP/server/.env"

echo "== 4. Сборка образа (3-6 минут, чужие контейнеры не останавливаются) =="
printf '%s\n' \
 'FROM node:22-slim AS web' \
 'WORKDIR /w' \
 'COPY web/package*.json web/' \
 'RUN npm --prefix web ci --no-audit --no-fund' \
 'COPY web web' \
 'RUN NODE_OPTIONS=--max-old-space-size=450 npm --prefix web run build' \
 'FROM node:22-slim' \
 'WORKDIR /app' \
 'COPY server/package*.json server/' \
 'RUN npm --prefix server ci --omit=dev --no-audit --no-fund' \
 'COPY server server' \
 'COPY --from=web /w/web/dist web/dist' \
 'ENV NODE_ENV=production' \
 'WORKDIR /app/server' \
 'CMD ["node","src/index.js"]' > "$APP/Dockerfile.usapp"
docker build -f "$APP/Dockerfile.usapp" -t us-app "$APP"

echo "== 5. Запуск =="
docker rm -f us-app >/dev/null 2>&1 || true
docker run -d --name us-app --restart unless-stopped --network "$NET" --memory 300m \
  --env-file "$APP/server/.env" -e HOST=0.0.0.0 -e PORT=3100 -e DB_PATH=/data/us-app.db \
  -v "$APP/data:/data" us-app >/dev/null
sleep 4
docker exec us-app node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>r.text()).then(t=>console.log('health:',t))"
echo "== 5b. Автообновление (проверка GitHub раз в минуту) =="
(crontab -l 2>/dev/null | grep -v us-app-auto || true; echo "* * * * * flock -n /tmp/usapp-upd.lock bash $APP/deploy/auto-update.sh >> /var/log/us-app-update.log 2>&1 # us-app-auto") | crontab -
echo "Готово: новые коммиты в GitHub сами попадут на сервер в течение 1-3 минут"

echo "== 6. Caddy: добавляю сайт $DOMAIN =="
if grep -q "$DOMAIN" "$CF"; then
  echo "Блок уже есть, пропускаю"
else
  cp "$CF" "$CF.bak-usapp"
  printf '\n%s {\n    encode gzip\n    reverse_proxy us-app:3100\n}\n' "$DOMAIN" >> "$CF"
fi
if docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile
else
  echo "!! Caddyfile не прошёл проверку, возвращаю прежний"
  [ -f "$CF.bak-usapp" ] && cp "$CF.bak-usapp" "$CF"
  exit 3
fi

echo "== 7. Webhook бота =="
docker exec us-app node src/setup-bot.js
echo "Жду сертификат HTTPS (до минуты)..."
for i in 1 2 3 4 5 6; do
  sleep 10
  if curl -fsS "https://$DOMAIN/api/health" 2>/dev/null; then echo; echo "ГОТОВО: https://$DOMAIN работает"; exit 0; fi
done
echo "Сайт пока не отвечает по HTTPS. Подождите минуту и откройте https://$DOMAIN. Если не откроется, пришлите экран Claude."
