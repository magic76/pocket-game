#!/data/data/com.termux/files/usr/bin/bash

# Pocket Game Hub Stop Script
DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.server.pid"
STOPPED=0

find_running_server() {
    for p in $(pgrep -f 'node.*server\.js' 2>/dev/null || true); do
        [ "$p" = "$$" ] && continue
        PROCESS_DIR=$(readlink "/proc/$p/cwd" 2>/dev/null || true)
        if [ "$PROCESS_DIR" = "$DIR" ]; then
            echo "$p"
        fi
    done
}

stop_pid() {
    TARGET_PID="$1"
    [ -z "$TARGET_PID" ] && return
    if ! kill -0 "$TARGET_PID" 2>/dev/null; then
        return
    fi
    echo "🛑 正在停止機上棋藝盒伺服器 (PID: $TARGET_PID)..."
    kill "$TARGET_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
        kill -0 "$TARGET_PID" 2>/dev/null || return
        sleep 0.2
    done
    # Only an explicit stop may force-close a stuck server process.
    kill -9 "$TARGET_PID" 2>/dev/null || true
}

# 1. 檢查 PID 檔案並終止
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        stop_pid "$PID"
        STOPPED=1
    fi
    rm -f "$PID_FILE"
fi

# 2. PID 檔遺失時，依工作目錄精準停止本專案的 server.js。
DANGLING_PIDS=$(find_running_server)
if [ -n "$DANGLING_PIDS" ]; then
    for p in $DANGLING_PIDS; do
        stop_pid "$p"
        STOPPED=1
    done
fi

if [ "$STOPPED" -eq 1 ]; then
    echo "✅ 機上棋藝盒 (Pocket Game Hub) 伺服器已成功關閉！"
else
    echo "ℹ️ 目前沒有正在運行的遊戲伺服器。"
fi
