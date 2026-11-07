#!/usr/bin/env bash
# Runs ON THE SERVER as root, from /opt/us-app (ship.sh calls it). Safe to re-run.
set -euo pipefail
cd /opt/us-app
export DEBIAN_FRONTEND=noninteractive
DOMAIN=usapp.kosalexus.by

echo "== 0. Что уже стоит (только чтение) =="
ss -tlnp | grep -E ':80 |:443 |:3100 ' || echo "порты 80/443/3100 свободны"
free -h | head -2

echo "== 1. Пакеты =="
apt-get update -qq && apt-get install -y -qq git sqlite3 curl rsync >/dev/null
NODE_OK=0
if command -v node >/dev/null; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a==22&&b>=13)?0:1)' && NODE_OK=1 || true
fi
if [ "$NODE_OK" = 0 ]; then
  echo "Node < 22.13 — ставлю Node 22 (CRM не должна зависеть от системного node; если зависит, остановитесь и напишите)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
fi
node -v
id usapp >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin usapp

echo "== 2. Swap =="
if [ "$(swapon --show | wc -l)" = 0 ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 3. Настройки (.env) =="
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  read -r -s -p "Вставьте BOT_TOKEN от BotFather (ввод скрыт) и Enter: " TOK; echo
  read -r -p "Username бота (без @): " BU
  SEC=$(openssl rand -hex 24)
  sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$TOK|; s|^BOT_USERNAME=.*|BOT_USERNAME=$BU|; s|^WEBHOOK_SECRET=.*|WEBHOOK_SECRET=$SEC|" server/.env
fi
chmod 600 server/.env
mkdir -p server/data

echo "== 4. Сборка =="
npm --prefix server ci --omit=dev --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=600 npm --prefix web ci --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=600 npm --prefix web run build
chown -R usapp:usapp server/data
chmod 640 server/.env && chown root:usapp server/.env

echo "== 5. Сервис =="
cp deploy/us-app.service /etc/systemd/system/us-app.service
systemctl daemon-reload && systemctl enable us-app >/dev/null 2>&1 && systemctl restart us-app
sleep 3
curl -fsS http://127.0.0.1:3100/api/health && echo " <- сервис работает"

echo "== 6. HTTPS-прокси =="
L80=$(ss -tlnpH 'sport = :80' | head -1 || true)
if echo "$L80" | grep -q nginx; then
  echo "На 80 порту nginx — добавляю отдельный сайт $DOMAIN (CRM не трогаю)"
  cp deploy/nginx-usapp.conf /etc/nginx/sites-available/$DOMAIN
  ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
  nginx -t && systemctl reload nginx
  command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect
elif [ -z "$L80" ]; then
  echo "80 порт свободен — ставлю Caddy (сам получит сертификат)"
  apt-get install -y -qq caddy >/dev/null
  cp deploy/Caddyfile.example /etc/caddy/Caddyfile
  systemctl restart caddy
else
  echo "!! На 80 порту не nginx: $L80"; echo "Остановился, чтобы не сломать CRM. Покажите этот вывод Claude."; exit 2
fi

echo "== 7. Webhook бота =="
set -a; . server/.env; set +a
npm --prefix server run set-webhook
sleep 2
curl -fsS "https://$DOMAIN/api/health" && echo " <- снаружи по HTTPS работает"
echo "ГОТОВО"
