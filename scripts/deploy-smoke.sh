#!/usr/bin/env bash
# Post-deploy smoke checks (routing + version stamps). Usage:
#   bash scripts/deploy-smoke.sh https://postosaas.com
set -euo pipefail

BASE="${1:-https://postosaas.com}"
BASE="${BASE%/}"

echo "== GET ${BASE}/api/health =="
curl -sS "${BASE}/api/health"
echo ""
echo "Expected: JSON with ok:true and path /api/health"

echo ""
echo "== GET ${BASE}/api/version =="
curl -sS "${BASE}/api/version"
echo ""
echo "Expected: JSON {\"sha\":\"...\",\"buildTime\":\"...\"}"

echo ""
echo "== Response headers ${BASE}/api/version (x-backend-sha, x-request-id, x-upstream-path) =="
curl -sS -D- -o /dev/null "${BASE}/api/version" | grep -iE "x-backend-sha|x-request-id|x-upstream-path" || true

echo ""
echo "== Pass-through x-request-id (optional) =="
curl -sS -D- -o /dev/null -H "x-request-id: edge-smoke-1" "${BASE}/api/version" | grep -i x-request-id || true

echo ""
echo "Nginx: use deploy/nginx/postosaas.proxy.example.conf — split access_log + proxy_set_header X-Request-Id \$request_id."
echo "Node prod: set TRUST_PROXY=1 (and restart) so client IP/logs match the proxy chain."
