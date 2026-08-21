#!/data/data/com.termux/files/usr/bin/bash
# 機上離線棋藝盒一鍵啟動腳本 (自動清理舊處理程序)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

PID_FILE="$DIR/.server.pid"

echo "🔍 檢查是否有先前未結束的遊戲伺服器..."

# 1. 精確依據 PID 檔案清理舊進程
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "🛑 關閉先前運行的伺服器 (PID: $OLD_PID)..."
        kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
fi

# 2. 雙重確認：清理路徑為 pocket-game 的 server.js 處理程序（避免誤殺其他服務）
DANGLING_PIDS=$(pgrep -f "$DIR/server.js" 2>/dev/null || true)
if [ -n "$DANGLING_PIDS" ]; then
    for p in $DANGLING_PIDS; do
        if [ "$p" != "$$" ]; then
            echo "🛑 清理殘留處理程序 (PID: $p)..."
            kill -9 "$p" 2>/dev/null || true
        fi
    done
fi

sleep 0.5
echo "🛫 正在啟動機上離線棋藝盒 (Pocket Game Hub)..."

# 啟動 node server.js 並記錄 PID
trap 'rm -f "$PID_FILE"' EXIT INT TERM
node server.js &
NODE_PID=$!
echo "$NODE_PID" > "$PID_FILE"

wait "$NODE_PID"
