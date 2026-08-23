#!/data/data/com.termux/files/usr/bin/bash
# 機上離線棋藝盒一鍵啟動腳本
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

PID_FILE="$DIR/.server.pid"

find_running_server() {
    for p in $(pgrep -f 'node.*server\.js' 2>/dev/null || true); do
        [ "$p" = "$$" ] && continue
        PROCESS_DIR=$(readlink "/proc/$p/cwd" 2>/dev/null || true)
        if [ "$PROCESS_DIR" = "$DIR" ]; then
            echo "$p"
        fi
    done
}

echo "🔍 檢查是否已有遊戲伺服器..."

# 1. PID 檔案仍指向有效處理程序時，不主動中斷進行中的房間。
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "ℹ️ 遊戲伺服器已在運行中 (PID: $OLD_PID)。"
        echo "   若確定沒有進行中的房間，請先執行 ./stop.sh 再重新啟動。"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

# 2. 即使 PID 檔遺失，也從處理程序工作目錄精準辨識本專案。
RUNNING_PIDS=$(find_running_server)
if [ -n "$RUNNING_PIDS" ]; then
    echo "ℹ️ 遊戲伺服器已在運行中 (PID: $RUNNING_PIDS)。"
    echo "   若確定沒有進行中的房間，請先執行 ./stop.sh 再重新啟動。"
    exit 0
fi

echo "🛫 正在啟動機上離線棋藝盒 (Pocket Game Hub)..."

# 啟動 node server.js 並記錄 PID
trap 'rm -f "$PID_FILE"' EXIT INT TERM
node server.js &
NODE_PID=$!
echo "$NODE_PID" > "$PID_FILE"

wait "$NODE_PID"
