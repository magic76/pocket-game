const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

let PORT = parseInt(process.env.PORT || '8080', 10);

// Helper: Get local network IP addresses
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push({ name, address: iface.address });
            }
        }
    }
    return ips;
}

// MIME types for static file serving
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
};

// In-Memory Game Rooms
const rooms = new Map();

function generateRoomId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;

    // API: Get server network info and QR code
    if (pathname === '/api/info') {
        const ips = getLocalIPs();
        const primaryIp = ips.find(i => i.address.startsWith('192.168.43.') || i.address.startsWith('192.168.'))?.address || ips[0]?.address || '127.0.0.1';
        const primaryUrl = `http://${primaryIp}:${PORT}`;
        
        let qrDataUrl = '';
        try {
            qrDataUrl = await QRCode.toDataURL(primaryUrl, { margin: 1, width: 260 });
        } catch (e) {
            console.error('QR code gen error:', e);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            port: PORT,
            ips,
            primaryIp,
            primaryUrl,
            qrDataUrl
        }));
        return;
    }

    // Static Files
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(__dirname, 'public', pathname);

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// WebSocket Server
const wss = new WebSocketServer({ server });

function broadcastToRoom(room, message, excludeWs = null) {
    const payload = JSON.stringify(message);
    const clients = [
        room.players.black?.ws,
        room.players.white?.ws,
        room.players.blue?.ws,
        room.players.green?.ws,
        ...room.spectators.map(s => s.ws)
    ].filter(Boolean);

    for (const client of clients) {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

function getRoomPublicState(room) {
    return {
        roomId: room.id,
        gameType: room.gameType,
        playerCount: room.playerCount || 2,
        board: room.board,
        subBoards: room.subBoards || null,
        mainBoard: room.mainBoard || null,
        activeBoard: room.activeBoard !== undefined ? room.activeBoard : null,
        playerPieces: room.playerPieces || null,
        turn: room.turn,
        winner: room.winner,
        status: room.status,
        players: {
            black: room.players.black ? { name: room.players.black.name, ready: room.players.black.ready } : null,
            white: room.players.white ? { name: room.players.white.name, ready: room.players.white.ready } : null,
            blue: room.players.blue ? { name: room.players.blue.name, ready: room.players.blue.ready } : null,
            green: room.players.green ? { name: room.players.green.name, ready: room.players.green.ready } : null
        },
        spectatorCount: room.spectators.length,
        lastMove: room.lastMove || null,
        capturedCount: room.capturedCount || { black: 0, white: 0 },
        scores: room.scores || null
    };
}

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let currentRole = null; // 'black' | 'white' | 'spectator'
    let playerName = '匿名特勤';

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            const { type } = data;

            if (type === 'create_room') {
                const { gameType, playerCount, name } = data;
                playerName = name || '房主';
                const roomId = generateRoomId();

                let initialTurn = 'black';
                if (gameType === 'xiangqi' || gameType === 'checkers' || gameType === 'connect4') initialTurn = 'red';
                else if (gameType === 'chess') initialTurn = 'white';
                else if (gameType === 'uttt') initialTurn = 'X';
                else if (gameType === 'blokus') initialTurn = 'blue';

                const newRoom = {
                    id: roomId,
                    gameType: gameType || 'gomoku',
                    playerCount: playerCount || 2,
                    board: null,
                    subBoards: null,
                    mainBoard: null,
                    activeBoard: null,
                    playerPieces: null,
                    turn: initialTurn,
                    winner: null,
                    status: 'waiting',
                    players: {
                        black: { ws, name: playerName, ready: true },
                        white: null,
                        blue: null,
                        green: null
                    },
                    spectators: [],
                    moveHistory: [],
                    lastMove: null,
                    lastActivity: Date.now()
                };

                rooms.set(roomId, newRoom);
                currentRoomId = roomId;
                currentRole = 'black';

                ws.send(JSON.stringify({
                    type: 'room_created',
                    roomId,
                    role: 'black',
                    roomState: getRoomPublicState(newRoom)
                }));
                console.log(`[Room ${roomId}] Created (${gameType}, ${newRoom.playerCount}P) by ${playerName}`);
            }

            else if (type === 'join_room') {
                const { roomId, name } = data;
                playerName = name || '訪客';
                const room = rooms.get(roomId);

                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: `找不到房間號碼: ${roomId}` }));
                    return;
                }

                currentRoomId = roomId;
                room.lastActivity = Date.now();

                if (!room.players.black) {
                    room.players.black = { ws, name: playerName, ready: true };
                    currentRole = 'black';
                } else if (!room.players.white) {
                    room.players.white = { ws, name: playerName, ready: true };
                    currentRole = 'white';
                    if (room.playerCount === 2 && room.status === 'waiting') {
                        room.status = 'playing';
                    }
                } else if (room.playerCount >= 3 && !room.players.blue) {
                    room.players.blue = { ws, name: playerName, ready: true };
                    currentRole = 'blue';
                    if (room.playerCount === 3 && room.status === 'waiting') {
                        room.status = 'playing';
                    }
                } else if (room.playerCount === 4 && !room.players.green) {
                    room.players.green = { ws, name: playerName, ready: true };
                    currentRole = 'green';
                    if (room.status === 'waiting') {
                        room.status = 'playing';
                    }
                } else {
                    room.spectators.push({ ws, name: playerName });
                    currentRole = 'spectator';
                }

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    roomId,
                    role: currentRole,
                    roomState: getRoomPublicState(room)
                }));

                broadcastToRoom(room, {
                    type: 'player_joined',
                    name: playerName,
                    role: currentRole,
                    roomState: getRoomPublicState(room)
                }, ws);

                console.log(`[Room ${roomId}] ${playerName} joined as ${currentRole}`);
            }

            else if (type === 'move') {
                if (!currentRoomId) return;
                const room = rooms.get(currentRoomId);
                if (!room) return;

                const { x, y, col, from, to, board, subBoards, mainBoard, activeBoard, playerPieces, nextTurn, winner, scores, capturedCount } = data;

                if (board !== undefined) room.board = board;
                if (subBoards !== undefined) room.subBoards = subBoards;
                if (mainBoard !== undefined) room.mainBoard = mainBoard;
                if (activeBoard !== undefined) room.activeBoard = activeBoard;
                if (playerPieces !== undefined) room.playerPieces = playerPieces;
                room.turn = nextTurn;
                room.winner = winner || null;
                room.lastMove = { x, y, col, from, to, by: currentRole };
                room.scores = scores || room.scores;
                room.capturedCount = capturedCount || room.capturedCount;
                room.lastActivity = Date.now();

                if (winner) {
                    room.status = 'ended';
                }

                broadcastToRoom(room, {
                    type: 'move_made',
                    move: { x, y, from, to, by: currentRole },
                    roomState: getRoomPublicState(room)
                });
            }

            else if (type === 'restart') {
                if (!currentRoomId) return;
                const room = rooms.get(currentRoomId);
                if (!room) return;

                const initialTurn = (room.gameType === 'xiangqi') ? 'red' : (room.gameType === 'chess' ? 'white' : 'black');
                room.board = null;
                room.turn = initialTurn;
                room.winner = null;
                room.lastMove = null;
                room.status = (room.players.black && room.players.white) ? 'playing' : 'waiting';
                room.moveHistory = [];
                room.lastActivity = Date.now();

                broadcastToRoom(room, {
                    type: 'game_restarted',
                    by: playerName,
                    roomState: getRoomPublicState(room)
                });
            }

            else if (type === 'reaction') {
                if (!currentRoomId) return;
                const room = rooms.get(currentRoomId);
                if (!room) return;

                broadcastToRoom(room, {
                    type: 'reaction',
                    emoji: data.emoji,
                    text: data.text,
                    from: playerName,
                    role: currentRole
                });
            }

            else if (type === 'sync_request') {
                if (!currentRoomId) return;
                const room = rooms.get(currentRoomId);
                if (room) {
                    ws.send(JSON.stringify({
                        type: 'state_sync',
                        roomState: getRoomPublicState(room)
                    }));
                }
            }

        } catch (e) {
            console.error('WebSocket message parsing error:', e);
        }
    });

    ws.on('close', () => {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        if (currentRole === 'black') {
            room.players.black = null;
        } else if (currentRole === 'white') {
            room.players.white = null;
        } else if (currentRole === 'spectator') {
            room.spectators = room.spectators.filter(s => s.ws !== ws);
        }

        if (!room.players.black && !room.players.white && room.spectators.length === 0) {
            setTimeout(() => {
                const check = rooms.get(currentRoomId);
                if (check && !check.players.black && !check.players.white && check.spectators.length === 0) {
                    rooms.delete(currentRoomId);
                }
            }, 300000);
        } else {
            broadcastToRoom(room, {
                type: 'player_left',
                name: playerName,
                role: currentRole,
                roomState: getRoomPublicState(room)
            });
        }
    });
});

// Periodic heartbeat
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// Robust Port Listener with Auto-Fallback
function startServer(portToTry) {
    server.removeAllListeners('error');
    
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ 連接埠 ${portToTry} 已被佔用，自動切換至 ${portToTry + 1}...`);
            startServer(portToTry + 1);
        } else {
            console.error('伺服器啟動錯誤:', err);
        }
    });

    server.listen(portToTry, '0.0.0.0', async () => {
        PORT = portToTry;
        const ips = getLocalIPs();
        const primaryIp = ips.find(i => i.address.startsWith('192.168.43.') || i.address.startsWith('192.168.'))?.address || ips[0]?.address || 'localhost';
        const serverUrl = `http://${primaryIp}:${PORT}`;

        console.log('\n======================================================');
        console.log('  ✈️  機上離線棋藝盒 (Pocket Game Hub 8-in-1)');
        console.log('======================================================');
        console.log(`🚀 本地伺服器已啟動於連接埠: ${PORT}`);
        console.log(`📱 本機遊玩網址:  http://localhost:${PORT}`);
        console.log(`📡 熱點分享網址:  ${serverUrl}`);
        if (ips.length > 1) {
            console.log('   所有可用網路介面:');
            ips.forEach(ip => console.log(`     - [${ip.name}]: http://${ip.address}:${PORT}`));
        }
        console.log('------------------------------------------------------');
        console.log('📲 請讓同行朋友連接你的 Wi-Fi 熱點後，掃描下方 QR Code 即玩：');
        console.log('------------------------------------------------------');

        try {
            const qrString = await QRCode.toString(serverUrl, { type: 'terminal', small: true });
            console.log(qrString);
        } catch (e) {
            console.log(`(無法在終端機繪製 QR Code，請直接開啟 ${serverUrl})`);
        }

        console.log('======================================================\n');
    });
}

startServer(PORT);
