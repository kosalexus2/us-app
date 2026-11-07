#!/usr/bin/env bash
# Run ON THE SERVER from /opt/us-app:  ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
npm --prefix server ci --omit=dev
# Building the frontend needs ~400 MB RAM. On a 1 GB VPS with other apps, add swap first (see SETUP.md).
npm --prefix web ci
npm --prefix web run build
sudo systemctl restart us-app
sleep 2
curl -fsS http://127.0.0.1:3100/api/health && echo " <- us-app is up"
