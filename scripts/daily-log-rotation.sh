#!/usr/bin/env bash
# Daily log rotation entrypoint.
#
# Order (intentional):
#   A) Ingest YESTERDAY's logs/<date>.jsonl into Notion (so we never miss
#      lines written near midnight).
#   B) Ensure TODAY's logs/<date>.jsonl file exists so downstream collectors
#      and tail consumers don't race the first append after rotation.
#
# Notes:
#   - Rotation is implicit in services/interactionLog.js: the daily filename
#     `<UTC YYYY-MM-DD>.jsonl` rolls over automatically on the first append
#     after midnight UTC. This script does NOT delete or move yesterday's
#     file; ingestion is non-destructive.
#   - Schedule this script daily a few minutes after 00:00 UTC (e.g. 00:05 UTC).
#   - Required env (read by the Node script via dotenv or shell export):
#       NOTION_API_KEY
#       NOTION_DATABASE_ID
#   - Pass-through args go to ingestDailyLogsToNotion.js, e.g.
#       bash scripts/daily-log-rotation.sh --date 2026-05-06
#       bash scripts/daily-log-rotation.sh --allow-missing --concurrency 4

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="${INTERACTION_LOG_DIR:-$REPO_ROOT/logs}"
TODAY_UTC="$(date -u +%F)"

# A) Ingest yesterday's JSONL into Notion (defaults to UTC yesterday).
node "$REPO_ROOT/scripts/ingestDailyLogsToNotion.js" "$@"

# B) Touch today's file so consumers can rely on its existence post-rotation.
mkdir -p "$LOG_DIR"
touch "$LOG_DIR/${TODAY_UTC}.jsonl"

echo "daily-log-rotation: ingest done; ensured ${LOG_DIR}/${TODAY_UTC}.jsonl exists"
