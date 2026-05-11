#!/usr/bin/env bash
# Deterministic VPS deploy: pull pinned branch, stamp versions, clean install + build, reload nginx.
# After this script, restart the Node process (pm2/systemd) once so server.js picks up deploy-version.env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$REPO_ROOT"

git fetch --all --prune
git reset --hard origin/main

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use 20
fi

SHORT_SHA="$(git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_SHA="$SHORT_SHA"
export BUILD_TIME="$BUILD_TIME"
export REACT_APP_GIT_SHA="$SHORT_SHA"
export REACT_APP_BUILD_TIME="$BUILD_TIME"

{
  echo "GIT_SHA=$SHORT_SHA"
  echo "BUILD_TIME=$BUILD_TIME"
} > deploy-version.env

echo "[deploy] GIT_SHA=$SHORT_SHA BUILD_TIME=$BUILD_TIME" >&2

npm ci
(
  cd frontend
  rm -rf build
  npm ci
  npm run build
)

sudo nginx -t
sudo systemctl reload nginx

if [[ "${VERIFY:-}" == "1" ]]; then
  VERIFY_BASE="${VERIFY_BASE:-https://postosaas.com}"
  bash "$REPO_ROOT/scripts/deploy-smoke.sh" "$VERIFY_BASE"
fi

echo "[deploy] Done. Restart Node (pm2/systemd) so the API loads deploy-version.env." >&2
echo "[deploy] Prod: set TRUST_PROXY=1 on Node behind nginx (see deploy/nginx/postosaas.proxy.example.conf)." >&2
echo "[deploy] Optional: VERIFY=1 ./deploy.sh runs scripts/deploy-smoke.sh after nginx." >&2
