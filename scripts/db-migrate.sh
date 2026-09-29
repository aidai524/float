#!/usr/bin/env bash
# 把 supabase/migrations + seed 应用到 .env 里配置的 Supabase（云端）。
#   scripts/db-migrate.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

: "${SUPABASE_DB_POOLER_URL:?未配置 SUPABASE_DB_POOLER_URL}"

PSQL="${PSQL:-}"
if [ -z "$PSQL" ]; then
  for c in psql /opt/homebrew/opt/libpq/bin/psql; do
    command -v "$c" >/dev/null 2>&1 && PSQL="$c" && break
  done
fi
[ -n "$PSQL" ] || { echo "未找到 psql（brew install libpq）" >&2; exit 1; }

shopt -s nullglob
for f in "$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/seed/*.sql; do
  printf '→ %s\n' "$(basename "$f")"
  "$PSQL" "$SUPABASE_DB_POOLER_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "✓ migrations + seed 已应用"
