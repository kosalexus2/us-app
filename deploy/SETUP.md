# Деплой Us App на VPS (Hoster.by, Ubuntu 24.04, 1 CPU / 1 GB)

Домен: `usapp.kosalexus.by` → A-запись на `87.232.67.3` (уже создана).
**На этом сервере уже работает `crm.kosalexus.by`. Ничего из его конфигов, портов и файлов не трогаем.**

## 0. Сначала посмотреть, что уже стоит (ничего не меняя)

```bash
ssh root@87.232.67.3
sudo ss -tlnp | grep -E ':80|:443|:3100'     # кто слушает 80/443 и свободен ли 3100
systemctl list-units --type=service --state=running | grep -E 'nginx|apache|caddy|node|pm2'
free -h; df -h /
ls /etc/nginx/sites-enabled 2>/dev/null
```

От результата зависит шаг 4 (nginx уже есть → добавляем сайт; ничего нет → Caddy).
Если порт 3100 занят, поменяйте `PORT` в `.env` и в прокси-конфиге.

## 1. Пакеты и пользователь

```bash
sudo apt update && sudo apt install -y git sqlite3 curl
# Node 22 (если `node -v` < 22.13 или node нет):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd --system --create-home --shell /usr/sbin/nologin usapp || true
```

Если на сервере уже стоит другая версия Node для CRM, не ломайте её: приложение работает на Node 20+.

## 2. Swap на время сборки (1 GB RAM)

```bash
free -h | grep Swap     # если 0B:
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Код и настройки

```bash
sudo mkdir -p /opt/us-app && sudo chown $USER:$USER /opt/us-app
git clone https://github.com/kosalexus2/us-app.git /opt/us-app      # репозиторий приватный: нужен токен или deploy key
cd /opt/us-app
cp server/.env.example server/.env
nano server/.env        # BOT_TOKEN, BOT_USERNAME, WEBHOOK_SECRET (openssl rand -hex 24), WEBAPP_URL
chmod 600 server/.env
mkdir -p server/data && sudo chown -R usapp:usapp server/data
npm --prefix server ci --omit=dev && npm --prefix web ci && npm --prefix web run build
```

## 4. Сервис

```bash
sudo cp deploy/us-app.service /etc/systemd/system/us-app.service
sudo chown -R usapp:usapp /opt/us-app/server/data
sudo systemctl daemon-reload && sudo systemctl enable --now us-app
curl http://127.0.0.1:3100/api/health        # {"ok":true}
```

## 5. HTTPS-прокси

**Вариант A: на сервере уже есть nginx** (скорее всего, из-за CRM):

```bash
sudo cp deploy/nginx-usapp.conf /etc/nginx/sites-available/usapp.kosalexus.by
sudo ln -s /etc/nginx/sites-available/usapp.kosalexus.by /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d usapp.kosalexus.by       # если certbot нет: sudo apt install -y certbot python3-certbot-nginx
```

**Вариант B: веб-сервера нет:** установите Caddy (caddyserver.com/docs/install), положите содержимое
`deploy/Caddyfile.example` в `/etc/caddy/Caddyfile`, `sudo systemctl reload caddy`.

Проверка: `curl https://usapp.kosalexus.by/api/health`.

## 6. Бот

В @BotFather:
1. `/newapp` → выберите бота → название `Us App` → описание → картинка 640×360 → ссылка `https://usapp.kosalexus.by` → short name `app`.
   (Либо `/setmenubutton` с тем же URL.)
2. `/mybots → бот → Bot Settings → Configure Mini App` → включить главное мини-приложение с этим URL
   (тогда работают ссылки-приглашения вида `https://t.me/<bot>?startapp=invite_…`).

На сервере один раз:
```bash
cd /opt/us-app/server && set -a && . ./.env && set +a && npm run set-webhook
```
Ответы `{"ok":true,...}` = webhook, кнопка меню и команда `/start` настроены.

## 7. Обновления и бэкапы

```bash
cd /opt/us-app && ./deploy/deploy.sh
sudo crontab -e   # добавить:  15 4 * * * /opt/us-app/deploy/backup.sh
```

## Проверка, что всё живо
- `journalctl -u us-app -n 50 --no-pager`: логи
- Бот отвечает на `/start` кнопкой «Открыть Us App»
- В приложении: создать пространство → ссылка-приглашение → открыть вторым аккаунтом

## Безопасность (кратко)
- `.env` с `chmod 600`, токен бота никуда не коммитим; если токен засветился: `/revoke` в BotFather.
- `DEV_MODE` в продакшене **не** включать (иначе можно зайти под любым id без подписи Telegram).
- Приложение слушает только `127.0.0.1`; наружу выходит только через nginx/Caddy.
