#!/usr/bin/env bash
# 开发会话守护：进程活跃时保持电脑不休眠 + 屏幕最暗；空闲 N 分钟后恢复并允许休眠。
#
#   scripts/devsession.sh start    # 启动守护（幂等）
#   scripts/devsession.sh touch    # 续期（有活动时调用）
#   scripts/devsession.sh stop     # 立即结束并恢复
#   scripts/devsession.sh status
#   scripts/devsession.sh run      # 内部：守护循环
#
# 活跃判定 = max(heartbeat mtime, $PI_SESSION_FILE mtime)。默认空闲 600s。
# 保持清醒用系统内置 caffeinate（无需权限）。Amphetamine 需 macOS 自动化权限，
# 默认关闭；授权后可设 DEVSESSION_USE_AMPHETAMINE=1 启用（带超时保护，不会卡死）。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.devsession"
mkdir -p "$STATE"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

DIM="${DEVSESSION_DIM:-0.0}"
IDLE="${DEVSESSION_IDLE_SECONDS:-600}"
TICK="${DEVSESSION_TICK_SECONDS:-30}"
EXIT_AFTER_IDLE="${DEVSESSION_EXIT_AFTER_IDLE:-1800}"
USE_AMPH="${DEVSESSION_USE_AMPHETAMINE:-0}"
BRIGHT="$ROOT/tools/bin/brightness"
HB="$STATE/heartbeat"
PIDFILE="$STATE/watchdog.pid"
CAFFEINE_PID="$STATE/caffeinate.pid"
SAVED="$STATE/brightness.saved"
LOG="$STATE/devsession.log"
SESSION_FILE="${PI_SESSION_FILE:-}"

log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }

# 带超时执行，避免 osascript 因权限弹窗永久阻塞
run_timeout() {
  local secs="$1"; shift
  "$@" >/dev/null 2>&1 &
  local p=$!
  ( sleep "$secs"; kill -9 "$p" 2>/dev/null ) &
  local w=$!
  wait "$p" 2>/dev/null
  kill -9 "$w" 2>/dev/null
  wait "$w" 2>/dev/null
}

get_bright() { [ -x "$BRIGHT" ] && "$BRIGHT" 2>/dev/null || true; }
set_bright() { [ -x "$BRIGHT" ] && "$BRIGHT" "$1" >/dev/null 2>&1 || true; }

caffeine_running() {
  [ -f "$CAFFEINE_PID" ] || return 1
  local p; p="$(cat "$CAFFEINE_PID" 2>/dev/null || echo)"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

activate() {
  # 保存原始亮度（只保存一次）
  if [ ! -f "$SAVED" ]; then
    local cur; cur="$(get_bright)"
    [ -n "$cur" ] && { echo "$cur" >"$SAVED"; log "saved brightness=$cur"; }
  fi
  # 压暗屏幕
  local cur; cur="$(get_bright)"
  [ "$cur" != "$DIM" ] && set_bright "$DIM"

  # 保持清醒：caffeinate（主）
  if ! caffeine_running; then
    nohup caffeinate -d -i -m -s >/dev/null 2>&1 &
    echo $! >"$CAFFEINE_PID"
    disown 2>/dev/null || true
    log "caffeinate started pid=$(cat "$CAFFEINE_PID")"
  fi

  # Amphetamine（可选，需已授权自动化权限）
  if [ "$USE_AMPH" = "1" ]; then
    run_timeout 5 osascript -e 'tell application "Amphetamine" to start new session with options {duration:10, interval:minutes, displaySleepAllowed:false}'
  fi
}

deactivate() {
  if caffeine_running; then
    kill "$(cat "$CAFFEINE_PID")" 2>/dev/null
    log "caffeinate stopped"
  fi
  rm -f "$CAFFEINE_PID"
  if [ "$USE_AMPH" = "1" ]; then
    run_timeout 5 osascript -e 'tell application "Amphetamine" to end session'
  fi
  if [ -f "$SAVED" ]; then
    local orig; orig="$(cat "$SAVED" 2>/dev/null || echo 0.5)"
    set_bright "$orig"
    rm -f "$SAVED"
    log "restored brightness=$orig"
  fi
}

is_running() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null || echo)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

watchdog() {
  echo $$ >"$PIDFILE"
  trap 'deactivate; [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ] && rm -f "$PIDFILE"; log "watchdog exit"; exit 0' TERM INT
  log "watchdog start dim=$DIM idle=${IDLE}s amph=$USE_AMPH session_file=${SESSION_FILE:-none}"

  local idle_secs=0
  while true; do
    # 自愈：每次循环重写 pidfile，防止被旧进程删除
    echo $$ >"$PIDFILE"
    local last=0 now age m
    last=$(stat -f %m "$HB" 2>/dev/null || echo 0)
    if [ -n "$SESSION_FILE" ] && [ -f "$SESSION_FILE" ]; then
      m=$(stat -f %m "$SESSION_FILE" 2>/dev/null || echo 0)
      [ "$m" -gt "$last" ] && last=$m
    fi
    now=$(date +%s); age=$(( now - last ))

    if [ "$age" -lt "$IDLE" ]; then
      activate
      idle_secs=0
    else
      deactivate
      idle_secs=$(( idle_secs + TICK ))
      if [ "$idle_secs" -ge "$EXIT_AFTER_IDLE" ]; then
        log "idle ${idle_secs}s, exiting"
        exit 0
      fi
    fi
    sleep "$TICK"
  done
}

cmd_start() {
  touch "$HB"
  # 通过进程扫描去重，避免残留 pidfile 导致重复启动多个 watchdog
  local existing
  existing="$(pgrep -f "bash .*devsession\.sh run" | head -1)"
  if [ -n "$existing" ]; then
    echo "$existing" >"$PIDFILE"
    echo "devsession already running (pid $existing)"
    return 0
  fi
  nohup "$0" run >/dev/null 2>&1 &
  disown 2>/dev/null || true
  echo "devsession started (pid $!)"
}
cmd_touch() { touch "$HB"; }
cmd_stop() {
  if is_running; then kill "$(cat "$PIDFILE")" 2>/dev/null; sleep 1; fi
  deactivate
  rm -f "$PIDFILE"
  echo "devsession stopped"
}
cmd_status() {
  if is_running; then echo "running pid=$(cat "$PIDFILE")"; else echo "not running"; fi
  echo "caffeinate=$(caffeine_running && echo active || echo off)"
  echo "brightness=$(get_bright)"
  [ -f "$SAVED" ] && echo "saved_brightness=$(cat "$SAVED")"
  echo "heartbeat_age=$(( $(date +%s) - $(stat -f %m "$HB" 2>/dev/null || date +%s) ))s"
}

case "${1:-status}" in
  start) cmd_start ;;
  touch) cmd_touch ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  run) watchdog ;;
  *) echo "usage: $0 {start|touch|stop|status}"; exit 1 ;;
esac
