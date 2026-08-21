#!/data/data/com.termux/files/usr/bin/bash

# Pocket Game Hub Stop Script
DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.server.pid"
STOPPED=0

# 1. 檢查 PID 檔案並終止
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "🛑 正在停止機上棋藝盒伺服器 (PID: $PID)..."
        kill "$PID" 2>/dev/null
        sleep 0.5
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null || true
        fi
        STOPPED=1
    fi
    rm -f "$PID_FILE"
fi

# 2. 針對 pocket-game 目錄下的 server.js 進行精準清理（避免誤殺其他 Node 服務）
DANGLING_PIDS=$(pgrep -f "$DIR/server.js" 2>/dev/null || true)
if [ -n "$DANGLING_PIDS" ]; then
    for p in $DANGLING_PIDS; do
        echo "🛑 清理殘留的遊戲進程 (PID: $p)..."
        kill -9 "$p" 2>/dev/null || true
        STOPPED=1
    done
fi

if [ "$STOPPED" -eq 1 ]; then
    echo "✅ 機上棋藝盒 (Pocket Game Hub) 伺服器已成功關閉！"
else
    echo "ℹ️ 目前沒有正在運行的遊戲伺服器。"
fi
