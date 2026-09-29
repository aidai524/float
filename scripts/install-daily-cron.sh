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
    PNPM="$(command -v pnpm || true)"
    [ -n "$PNPM" ] || { echo "找不到 pnpm" >&2; exit 1; }
    NODEBIN="$(dirname "$(command -v node || command -v pnpm)")"
    mkdir -p "$ROOT/.devsession"
    # cron 环境极简：显式带 PATH，且 source .env（脚本本身也会兜底 loadEnvFile）
    entry="$mm $hh * * * cd $ROOT && export PATH=\"$NODEBIN:/usr/local/bin:/usr/bin:/bin\" && [ -f .env ] && set -a && . ./.env; set +a; \"$PNPM\" daily >> \"$LOG\" 2>&1 $MARK"
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true; echo "$entry" ) | crontab -
    echo "✓ 已安装 crontab：每天 $time 跑 pnpm daily"
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
