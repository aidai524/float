#!/usr/bin/env bash
# 每周跑 DefiLlama 解锁快照 + 回填（需要系统 Chromium，非 corepack 环境用 npx 兜底）。
#
#   scripts/install-unlocks-cron.sh install   [weekday 0-7] [HH:MM]   # 默认 1(周一) 02:00
#   scripts/install-unlocks-cron.sh uninstall
#   scripts/install-unlocks-cron.sh status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARK="# float-unlocks"
LOG="$ROOT/.devsession/unlocks.log"
cmd="${1:-status}"
dow="${2:-1}"
time="${3:-02:00}"
hh="${time%%:*}"
mm="${time##*:}"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "找不到 node" >&2; exit 1; }
NODEDIR="$(dirname "$NODE_BIN")"
CHROME="${CHROME_PATH:-/usr/bin/chromium}"

# 优先 pnpm；无则 npx（Alpine 上常见）
if command -v pnpm >/dev/null 2>&1; then
  IMPORT_CMD="pnpm unlocks:import"
else
  IMPORT_CMD="npx --yes tsx scripts/backfill-unlocks.ts"
fi

# node 路径在安装时就固化（避免 cron 运行时 command -v 找不到）
entry="$mm $hh * * $dow cd $ROOT && export PATH=\"$NODEDIR:/usr/local/bin:/usr/bin:/bin\" CHROME_PATH=$CHROME && mkdir -p .devsession && node scripts/fetch-defillama-browser.mjs && $IMPORT_CMD >> \"$LOG\" 2>&1 $MARK"

case "$cmd" in
  install)
    if [ ! -x "$CHROME" ]; then
      echo "⚠️  $CHROME 不存在或不可执行。先安装浏览器（Alpine: apk add chromium），或设 CHROME_PATH=..." >&2
    fi
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true; echo "$entry" ) | crontab -
    echo "✓ 已安装：每周 $dow 的 $time 取快照 + 回填"
    echo "  使用：CHROME_PATH=$CHROME"
    echo "  日志：$LOG"
    ;;
  uninstall)
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true ) | crontab -
    echo "✓ 已卸载"
    ;;
  status)
    if crontab -l 2>/dev/null | grep -q "$MARK"; then
      crontab -l | grep "$MARK"
      [ -f "$LOG" ] && { echo "--- 最近日志 ---"; tail -12 "$LOG"; }
    else
      echo "未安装"
    fi
    ;;
  *) echo "usage: $0 {install [weekday 0-7] [HH:MM]|uninstall|status}"; exit 1 ;;
esac
