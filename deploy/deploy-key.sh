#!/usr/bin/env bash
# Подготовка к приватному репозиторию: ключ только на чтение для автообновления.
# Запуск: bash <(curl -fsSL https://raw.githubusercontent.com/kosalexus2/us-app/main/deploy/deploy-key.sh)
set -euo pipefail
APP=/opt/us-app
KEY=/root/.ssh/usapp_deploy
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N '' -C usapp-server -f "$KEY" >/dev/null
echo
echo "ПУБЛИЧНЫЙ КЛЮЧ (его добавит Claude в GitHub):"
cat "$KEY.pub"
echo
SSHC="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
export GIT_SSH_COMMAND="$SSHC"
echo "Жду, пока ключ появится в GitHub (до 15 минут)..."
for i in $(seq 1 90); do
  if git ls-remote git@github.com:kosalexus2/us-app.git HEAD >/dev/null 2>&1; then
    git -C "$APP" remote set-url origin git@github.com:kosalexus2/us-app.git
    git -C "$APP" config core.sshCommand "$SSHC"
    git -C "$APP" fetch -q origin main
    echo "ГОТОВО: сервер читает репозиторий по ключу, можно закрывать репозиторий"
    exit 0
  fi
  sleep 10
done
echo "Ключ не заработал. Автообновление продолжает работать как раньше."
exit 1
