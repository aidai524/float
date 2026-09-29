#!/usr/bin/env bash
# Linux/macOS：用 crontab 每天跑 pnpm daily（VPS 上用这个替代 macOS 的 launchd 版）。
#
#   scripts/install-daily-cron.sh install   [HH:MM]
#   scripts/install-daily-cron.sh uninstall
#   scripts/install-daily-cron.sh status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARK="# float-daily"
LOG="$ROOT/.devsession/daily.log"
cmd="${1:-status}"
time="${2:-01:10}"
hh="${time%%:*}"
mm="${time##*:}"

case "$cmd" in
  install)
    NODEBIN="$(dirname "$(command -v node || true)")"
    # 优先 pnpm；Alpine 等没有 corepack/pnpm 的环境回退到 npx
    PNPM="$(command -v pnpm || true)"
    if [ -n "$PNPM" ]; then
      DAILY_CMD="\"$PNPM\" daily"
    else
      NPX="$(command -v npx || true)"
      [ -n "$NPX" ] || { echo "需要 pnpm 或 npx（Node 自带）" >&2; exit 1; }
      DAILY_CMD="\"$NPX\" --yes tsx scripts/daily-refresh.ts"
    fi
    mkdir -p "$ROOT/.devsession"
    # cron 环境极简：显式带 PATH，且 source .env（脚本本身也会兜底 loadEnvFile）
    entry="$mm $hh * * * cd $ROOT && export PATH=\"$NODEBIN:/usr/local/bin:/usr/bin:/bin\" && [ -f .env ] && set -a && . ./.env; set +a; $DAILY_CMD >> \"$LOG\" 2>&1 $MARK"
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true; echo "$entry" ) | crontab -
    echo "✓ 已安装 crontab：每天 $time 跑 pnpm daily（无 pnpm 时用 npx tsx）"
    echo "  日志：$LOG"
    echo "  查看：crontab -l | grep float-daily"
    ;;
  uninstall)
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true ) | crontab -
    echo "✓ 已卸载"
    ;;
  status)
    if crontab -l 2>/dev/null | grep -q "$MARK"; then
      echo "已安装："
      crontab -l | grep "$MARK"
      [ -f "$LOG" ] && { echo "--- 最近日志 ---"; tail -12 "$LOG"; }
    else
      echo "未安装"
    fi
    ;;
  *) echo "usage: $0 {install [HH:MM]|uninstall|status}"; exit 1 ;;
esac
