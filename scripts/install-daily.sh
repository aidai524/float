#!/usr/bin/env bash
# 安装/卸载 macOS 每日定时任务（launchd）。默认每天 01:10 跑 pnpm daily。
#
#   scripts/install-daily.sh install   [HH:MM]
#   scripts/install-daily.sh uninstall
#   scripts/install-daily.sh status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="ai.float.daily"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$ROOT/.devsession/daily.log"

cmd="${1:-status}"
time="${2:-01:10}"
hh="${time%%:*}"
mm="${time##*:}"

case "$cmd" in
  install)
    PNPM="$(command -v pnpm || true)"
    [ -n "$PNPM" ] || { echo "找不到 pnpm" >&2; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.devsession"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$ROOT" &amp;&amp; ./scripts/devsession.sh touch &amp;&amp; "$PNPM" daily &gt;&gt; "$LOG" 2&gt;&amp;1</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>$((10#$hh))</integer><key>Minute</key><integer>$((10#$mm))</integer></dict>
  </array>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLISTEOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "✓ 已安装：每天 $time 跑 pnpm daily"
    echo "  日志：$LOG"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ 已卸载"
    ;;
  status)
    if [ -f "$PLIST" ]; then
      echo "已安装：$PLIST"
      launchctl list | grep "$LABEL" || echo "  （launchd 中未激活）"
      [ -f "$LOG" ] && { echo "--- 最近日志 ---"; tail -12 "$LOG"; }
    else
      echo "未安装"
    fi
    ;;
  *) echo "usage: $0 {install [HH:MM]|uninstall|status}"; exit 1 ;;
esac
