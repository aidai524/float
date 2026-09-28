#!/usr/bin/env bash
# Bark 通知。用法：scripts/notify.sh "标题" "正文" ["分组"]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

TITLE="${1:-MoonEvent}"
BODY="${2:-}"
GROUP="${3:-moonevent}"
URL="${BARK_PUSH_URL:-https://api.day.app/push}"

if [ -z "${BARK_DEVICE_KEY:-}" ]; then
  echo "notify: BARK_DEVICE_KEY 未配置，跳过" >&2
  exit 0
fi

PAYLOAD="$(jq -nc \
  --arg dk "$BARK_DEVICE_KEY" \
  --arg t "$TITLE" \
  --arg b "$BODY" \
  --arg g "$GROUP" \
  '{device_key:$dk, title:$t, body:$b, group:$g, ttl:600}')"

curl -s --max-time 15 -X POST "$URL" -H "Content-Type: application/json" -d "$PAYLOAD" >/dev/null 2>&1 || true
