const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

let PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PLAYER_ROLES = ['black', 'white', 'blue', 'green'];
const RECONNECT_GRACE_MS = 5 * 60 * 1000;
const RESTART_VOTE_WINDOW_MS = 30 * 1000;
const GAME_TYPES = new Set(['gomoku', 'reversi', 'xiangqi', 'chess', 'checkers', 'connect4', 'uttt', 'blokus', 'carcassonne']);

// The eight classic boards use the same rule engines in browser and Node.
// The browser only requests an action; this process keeps the canonical board.
function loadBrowserEngine(file, name) {
    const context = { window: {}, console };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'js', file), 'utf8'), context, { filename: file });
    if (!context.window[name]) throw new Error(`Unable to load ${name}`);
    return context.window[name];
}

const Engine = {
    gomoku: loadBrowserEngine('gomoku.js', 'GomokuEngine'),
    reversi: loadBrowserEngine('reversi.js', 'ReversiEngine'),
    xiangqi: loadBrowserEngine('xiangqi.js', 'XiangqiEngine'),
    chess: loadBrowserEngine('chess.js', 'ChessEngine'),
    checkers: loadBrowserEngine('checkers.js', 'ChineseCheckersEngine'),
    connect4: loadBrowserEngine('connect4.js', 'Connect4Engine'),
    uttt: loadBrowserEngine('uttt.js', 'UltimateTicTacToeEngine'),
    blokus: loadBrowserEngine('blokus.js', 'BlokusEngine')
};

const CARC_PLAYER_ORDER = ['red', 'blue', 'green', 'yellow'];
const CARC_ROLE_TO_PLAYER = { black: 'red', white: 'blue', blue: 'green', green: 'yellow' };
const CARC_EDGES = {
    A: ['F', 'F', 'R', 'F'], B: ['F', 'F', 'F', 'F'], C: ['C', 'C', 'C', 'C'],
    D: ['C', 'R', 'R', 'F'], E: ['C', 'F', 'F', 'F'], F: ['C', 'F', 'C', 'F'],
    G: ['C', 'F', 'C', 'F'], H: ['C', 'C', 'F', 'F'], I: ['C', 'C', 'F', 'F'],
    J: ['C', 'R', 'F', 'R'], K: ['C', 'F', 'R', 'R'], L: ['C', 'R', 'R', 'R'],
    M: ['C', 'C', 'F', 'F'], N: ['C', 'C', 'F', 'F'], O: ['C', 'C', 'R', 'R'],
    P: ['C', 'C', 'F', 'C'], Q: ['C', 'C', 'F', 'C'], R: ['C', 'C', 'R', 'C'],
    S: ['C', 'C', 'R', 'C'], T: ['C', 'C', 'R', 'R'], U: ['R', 'F', 'R', 'F'],
    V: ['F', 'F', 'R', 'R'], W: ['F', 'R', 'R', 'R'], X: ['R', 'R', 'R', 'R']
};
const CARC_TILES = new Set(Object.keys(CARC_EDGES));

function getLocalIPs() {
    const ips = [];
    for (const name of Object.keys(os.networkInterfaces())) {
        for (const iface of os.networkInterfaces()[name]) {
            if (iface.family === 'IPv4' && !iface.internal) ips.push({ name, address: iface.address });
        }
    }
    return ips;
}

function primaryAddress() {
    const ips = getLocalIPs();
    return ips.find(item => item.address.startsWith('192.168.43.') || item.address.startsWith('192.168.'))?.address || ips[0]?.address || '127.0.0.1';
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

function normalizedGameType(value) {
    return GAME_TYPES.has(value) ? value : 'gomoku';
}

function normalizedPlayerCount(gameType, value) {
    const count = Number(value);
    if (gameType === 'carcassonne') return Math.max(2, Math.min(4, Number.isInteger(count) ? count : 2));
    if (gameType === 'checkers') return count === 3 ? 3 : 2;
    if (gameType === 'blokus') return count === 4 ? 4 : 2;
    return 2;
}

function roomRoles(playerCount) {
    return PLAYER_ROLES.slice(0, playerCount);
}

function initialTurn(gameType) {
    if (gameType === 'xiangqi' || gameType === 'checkers' || gameType === 'connect4') return 'red';
    if (gameType === 'chess') return 'white';
    if (gameType === 'uttt') return 'X';
    if (gameType === 'blokus') return 'blue';
    if (gameType === 'carcassonne') return 'red';
    return 'black';
}

function roleForTurn(room, turn) {
    const twoPlayer = {
        gomoku: { black: 'black', white: 'white' },
        reversi: { black: 'black', white: 'white' },
        xiangqi: { red: 'black', black: 'white' },
        chess: { white: 'black', black: 'white' },
        connect4: { red: 'black', yellow: 'white' },
        uttt: { X: 'black', O: 'white' }
    };
    if (twoPlayer[room.gameType]) return twoPlayer[room.gameType][turn] || null;
    if (room.gameType === 'checkers') {
        const turns = room.playerCount === 3 ? ['red', 'green', 'blue'] : ['red', 'green'];
        return ['black', 'white', 'blue'][turns.indexOf(turn)] || null;
    }
    if (room.gameType === 'blokus') {
        const turns = room.playerCount === 4 ? ['blue', 'yellow', 'red', 'green'] : ['blue', 'orange'];
        return ['black', 'white', 'blue', 'green'][turns.indexOf(turn)] || null;
    }
    return null;
}

function makeEngine(gameType, playerCount) {
    switch (gameType) {
        case 'gomoku': return new Engine.gomoku(15);
        case 'reversi': return new Engine.reversi(8);
        case 'xiangqi': return new Engine.xiangqi();
        case 'chess': return new Engine.chess();
        case 'checkers': return new Engine.checkers(playerCount);
        case 'connect4': return new Engine.connect4(7, 6);
        case 'uttt': return new Engine.uttt();
        case 'blokus': return new Engine.blokus(playerCount);
        default: return null;
    }
}

function engineState(room) {
    const engine = room.engine;
    if (!engine) return {};
    const state = {
        board: engine.board ?? null,
        subBoards: engine.subBoards ?? null,
        mainBoard: engine.mainBoard ?? null,
        activeBoard: engine.activeBoard ?? null,
        playerPieces: engine.playerPieces ?? null,
        turn: engine.turn,
        winner: engine.winner ?? null,
        lastMove: room.lastMove || engine.lastMove || null,
        capturedPieces: engine.capturedPieces ?? null,
        winningLine: engine.winningLine ?? null,
        castlingRights: engine.castlingRights ?? null,
        enPassantTarget: engine.enPassantTarget ?? null,
        playerCount: engine.playerCount ?? room.playerCount,
        size: engine.size ?? null,
        passedPlayers: engine.passedPlayers ? [...engine.passedPlayers] : null
    };
    if (room.gameType === 'reversi') state.scores = engine.getCounts();
    if (room.gameType === 'blokus') state.scores = engine.scores;
    return state;
}

function createToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function makePlayer(ws, name) {
    return {
        ws,
        name: String(name || '特勤隊員').trim().slice(0, 20) || '特勤隊員',
        ready: true,
        resumeToken: createToken(),
        disconnectedAt: null
    };
}

function isConnected(player) {
    return Boolean(player?.ws && player.ws.readyState === WebSocket.OPEN);
}

function updateStatus(room) {
    if (room.status === 'ended') return room.status;
    const roles = roomRoles(room.playerCount);
    if (!roles.every(role => room.players[role])) room.status = 'waiting';
    else if (roles.every(role => isConnected(room.players[role]))) room.status = 'playing';
    else room.status = 'reconnecting';
    return room.status;
}

function publicPlayer(player) {
    return player ? { name: player.name, ready: player.ready, connected: isConnected(player), reconnecting: !isConnected(player) } : null;
}

function getRoomPublicState(room) {
    const state = room.engine ? engineState(room) : {
        turn: room.turn,
        winner: room.winner,
        scores: room.scores,
        lastMove: room.lastMove
    };
    return {
        roomId: room.id,
        gameType: room.gameType,
        playerCount: room.playerCount,
        ...state,
        status: room.status,
        players: {
            black: publicPlayer(room.players.black),
            white: publicPlayer(room.players.white),
            blue: publicPlayer(room.players.blue),
            green: publicPlayer(room.players.green)
        },
        spectatorCount: room.spectators.length,
        restartVotes: [...room.restartVotes],
        carcassonneState: room.carcassonneState || null,
        carcassonneVersion: room.carcassonneVersion || 0
    };
}

const rooms = new Map();

function generateRoomId() {
    let id;
    do id = Math.floor(1000 + Math.random() * 9000).toString(); while (rooms.has(id));
    return id;
}

function openRooms() {
    return [...rooms.values()]
        .filter(room => room.status === 'waiting' && isConnected(room.players.black))
        .map(room => ({
            roomId: room.id,
            gameType: room.gameType,
            playerCount: room.playerCount,
            joinedCount: roomRoles(room.playerCount).filter(role => room.players[role]).length,
            hostName: room.players.black.name
        }));
}

function broadcast(room, message, exclude = null) {
    const payload = JSON.stringify(message);
    const sockets = [
        room.players.black?.ws, room.players.white?.ws, room.players.blue?.ws, room.players.green?.ws,
        ...room.spectators.map(spectator => spectator.ws)
    ].filter(Boolean);
    for (const socket of sockets) {
        if (socket !== exclude && socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
}

function broadcastState(room, type, extra = {}) {
    broadcast(room, { type, ...extra, roomState: getRoomPublicState(room) });
}

function integer(value, min, max) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function coordinate(value, maxX, maxY) {
    if (!value || typeof value !== 'object') return null;
    const x = integer(value.x, 0, maxX);
    const y = integer(value.y, 0, maxY);
    return x === null || y === null ? null : { x, y };
}

function normalizedShape(shape) {
    if (!Array.isArray(shape) || shape.length < 1 || shape.length > 5) return null;
    const points = [];
    for (const point of shape) {
        if (!Array.isArray(point) || point.length !== 2) return null;
        const y = integer(point[0], -5, 5);
        const x = integer(point[1], -5, 5);
        if (x === null || y === null) return null;
        points.push([y, x]);
    }
    return Engine.blokus.normalize(points);
}

function equalShapes(a, b) {
    return a.length === b.length && a.every((point, index) => point[0] === b[index][0] && point[1] === b[index][1]);
}

function applyMove(room, data) {
    const engine = room.engine;
    let valid = false;

    switch (room.gameType) {
        case 'gomoku':
        case 'reversi': {
            const x = integer(data.x, 0, engine.size - 1);
            const y = integer(data.y, 0, engine.size - 1);
            valid = x !== null && y !== null && engine.makeMove(x, y);
            break;
        }
        case 'connect4': {
            const col = integer(data.col, 0, engine.cols - 1);
            valid = col !== null && engine.makeMove(col);
            break;
        }
        case 'uttt': {
            const mainR = integer(data.mainR, 0, 2);
            const mainC = integer(data.mainC, 0, 2);
            const subR = integer(data.subR, 0, 2);
            const subC = integer(data.subC, 0, 2);
            valid = [mainR, mainC, subR, subC].every(item => item !== null) && engine.makeMove(mainR, mainC, subR, subC);
            break;
        }
        case 'xiangqi':
        case 'chess': {
            const maxX = room.gameType === 'xiangqi' ? 8 : 7;
            const maxY = room.gameType === 'xiangqi' ? 9 : 7;
            const from = coordinate(data.from, maxX, maxY);
            const to = coordinate(data.to, maxX, maxY);
            valid = Boolean(from && to && engine.makeMove(from.x, from.y, to.x, to.y));
            break;
        }
        case 'checkers': {
            const from = integer(data.from, 0, 120);
            const to = integer(data.to, 0, 120);
            valid = from !== null && to !== null && engine.makeMove(from, to);
            break;
        }
        case 'blokus': {
            if (data.action === 'pass') {
                if (engine.getAIMove(engine.turn)) return { ok: false, error: '還有可以放置的方塊，不能跳過' };
                engine.passTurn();
                valid = true;
                break;
            }
            const pieceId = integer(data.pieceId, 0, 20);
            const originY = integer(data.originY, 0, engine.size - 1);
            const originX = integer(data.originX, 0, engine.size - 1);
            const piece = engine.playerPieces[engine.turn]?.find(item => item.id === pieceId);
            const shape = normalizedShape(data.shape);
            const choices = piece && shape ? Engine.blokus.getAllOrientations(piece.coords) : [];
            if (!piece || piece.used || originY === null || originX === null || !shape || !choices.some(choice => equalShapes(choice, shape))) {
                return { ok: false, error: '方塊資料不正確' };
            }
            valid = engine.placePiece(pieceId, shape, originY, originX);
            break;
        }
        default:
            return { ok: false, error: '未知遊戲動作' };
    }
    return valid ? { ok: true } : { ok: false, error: '這一步不符合規則' };
}

function carcEdges(type, rotation) {
    const edges = CARC_EDGES[type];
    return edges?.map((_, side) => edges[(side - rotation + 4) % 4]) || null;
}

function parseCarcGrid(entries, activePlayers = CARC_PLAYER_ORDER) {
    if (!Array.isArray(entries) || entries.length > 72) return { error: '地圖資料不正確' };
    const grid = new Map();
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !/^-?\d+,-?\d+$/.test(entry[0])) return { error: '地圖座標不正確' };
        const [x, y] = entry[0].split(',').map(Number);
        if (Math.abs(x) > 100 || Math.abs(y) > 100) return { error: '地圖座標超出範圍' };
        const tile = entry[1];
        if (!tile || !CARC_TILES.has(tile.typeKey) || !Number.isInteger(tile.rotation) || tile.rotation < 0 || tile.rotation > 3 || grid.has(entry[0])) return { error: '地圖卡片不正確' };
        if (tile.meeple) {
            const meeple = tile.meeple;
            const offsetX = Number(meeple.offsetX);
            const offsetY = Number(meeple.offsetY);
            if (!activePlayers.includes(meeple.color) ||
                !['city', 'road', 'monastery', 'field'].includes(meeple.kind) ||
                !Number.isInteger(meeple.group) || meeple.group < 0 || meeple.group > 3 ||
                !Number.isFinite(offsetX) || !Number.isFinite(offsetY) || offsetX < 0 || offsetX > 100 || offsetY < 0 || offsetY > 100) {
                return { error: '米寶資料不正確' };
            }
        }
        grid.set(entry[0], tile);
    }
    return { grid };
}

function validCarcNeighbours(grid, key, tile) {
    const [x, y] = key.split(',').map(Number);
    const edges = carcEdges(tile.typeKey, tile.rotation);
    const directions = [[0, -1, 0, 2], [1, 0, 1, 3], [0, 1, 2, 0], [-1, 0, 3, 1]];
    let touches = false;
    for (const [dx, dy, side, opposite] of directions) {
        const neighbour = grid.get(`${x + dx},${y + dy}`);
        if (!neighbour) continue;
        touches = true;
        if (edges[side] !== carcEdges(neighbour.typeKey, neighbour.rotation)[opposite]) return false;
    }
    return touches;
}

function countCards(cards) {
    const count = Object.fromEntries([...CARC_TILES].map(key => [key, 0]));
    for (const card of cards) {
        if (!CARC_TILES.has(card)) return null;
        count[card]++;
    }
    return count;
}

function equalArrays(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameCarcTile(a, b) {
    return Boolean(a && b && a.typeKey === b.typeKey && a.rotation === b.rotation);
}

function sameMeeple(a, b) {
    if (!a || !b) return a === b;
    return a.color === b.color && a.kind === b.kind && a.group === b.group &&
        Number(a.offsetX) === Number(b.offsetX) && Number(a.offsetY) === Number(b.offsetY);
}

function sameScores(a, b, players) {
    return players.every(color => Number(a?.[color] || 0) === Number(b?.[color] || 0));
}

function meepleCounts(grid, players) {
    const counts = Object.fromEntries(players.map(color => [color, 0]));
    for (const tile of grid.values()) {
        if (tile.meeple?.color in counts) counts[tile.meeple.color]++;
    }
    return counts;
}

function validCarcBoard(grid) {
    if (!grid.size) return false;
    if (grid.size === 1) return true;
    for (const [key, tile] of grid) {
        if (!validCarcNeighbours(grid, key, tile)) return false;
    }
    return true;
}

function carcDeckCounts(state, grid) {
    // During the optional meeple phase the current tile is intentionally kept
    // in the UI so it can be previewed, but it is already on the map. Do not
    // count that one card twice.
    const cards = [...grid.values()].map(tile => tile.typeKey).concat(state.deck || []);
    if (state.turnPhase === 'PLACE_TILE' && state.currentTile) cards.push(state.currentTile.typeKey);
    return countCards(cards);
}

function hasExactCarcDeck(state, grid) {
    const counts = carcDeckCounts(state, grid);
    return Boolean(counts) && [...CARC_TILES].every(key => counts[key] === 3);
}

function coordKey(value) {
    if (!value || !Number.isInteger(value.gx) || !Number.isInteger(value.gy) || Math.abs(value.gx) > 100 || Math.abs(value.gy) > 100) return null;
    return `${value.gx},${value.gy}`;
}

function nextCarcPlayer(room, color) {
    const players = CARC_PLAYER_ORDER.slice(0, room.playerCount);
    return players[(players.indexOf(color) + 1) % players.length];
}

function canonicalizeCarcState(room, input) {
    const state = JSON.parse(JSON.stringify(input));
    const players = CARC_PLAYER_ORDER.slice(0, room.playerCount);
    const roleForPlayer = { red: 'black', blue: 'white', green: 'blue', yellow: 'green' };
    state.playerNames = { ...(state.playerNames || {}) };
    for (const color of players) {
        const name = room.players[roleForPlayer[color]]?.name;
        if (name) state.playerNames[color] = name;
    }
    state.remainingDeckCount = state.deck.length;
    if (state.turnPhase === 'GAME_OVER') {
        const highScore = Math.max(...players.map(color => Number(state.scores[color] || 0)));
        state.gameResult = {
            winners: players.filter(color => Number(state.scores[color] || 0) === highScore),
            score: highScore
        };
    } else {
        state.gameResult = null;
    }
    return state;
}

// A Carcassonne state change is accepted only from the active player, from the
// current state version, and may add at most one legal tile without changing
// previously placed artwork. It stops stale or forged whole-map overwrites.
function validateCarcState(next, previous, room) {
    if (!next || Number(next.playerCount) !== room.playerCount) return '房間設定不符';
    const players = CARC_PLAYER_ORDER.slice(0, room.playerCount);
    const parsed = parseCarcGrid(next.grid, players);
    if (parsed.error || !Array.isArray(next.deck) || !next.scores || !next.meeplesRemaining) return parsed.error || '卡卡頌狀態不完整';
    if (!['PLACE_TILE', 'DEPLOY_MEEPLE', 'RESOLVING', 'GAME_OVER'].includes(next.turnPhase)) return '回合階段不正確';
    if (!players.includes(next.activePlayer)) return '玩家順序不正確';
    if (next.currentTile && (!CARC_TILES.has(next.currentTile.typeKey) || !Number.isInteger(next.currentTile.rotation) || next.currentTile.rotation < 0 || next.currentTile.rotation > 3)) return '目前卡片不正確';
    if (next.turnPhase === 'PLACE_TILE' && !next.currentTile) return '目前需要一張地圖卡';
    if (next.turnPhase === 'GAME_OVER' && next.currentTile) return '遊戲結束時不能保留地圖卡';
    const placedKey = coordKey(next.justPlacedCoords);
    if (next.turnPhase === 'DEPLOY_MEEPLE' && (!placedKey || !parsed.grid.has(placedKey))) return '米寶放置位置不正確';
    if (next.turnPhase !== 'DEPLOY_MEEPLE' && next.justPlacedCoords !== null && next.justPlacedCoords !== undefined) return '回合位置不正確';
    for (const color of CARC_PLAYER_ORDER) {
        const score = Number(next.scores[color] ?? 0);
        const meeples = Number(next.meeplesRemaining[color] ?? 7);
        if (!Number.isInteger(score) || score < 0 || score > 300 || !Number.isInteger(meeples) || meeples < 0 || meeples > 7) return '分數或米寶資料不正確';
    }
    if (!hasExactCarcDeck(next, parsed.grid)) return '牌組組成不正確';
    if (parsed.grid.size && !validCarcBoard(parsed.grid)) return '地圖邊緣不相符';
    const nextMeepleCounts = meepleCounts(parsed.grid, players);
    for (const color of players) {
        if (Number(next.meeplesRemaining[color]) !== 7 - nextMeepleCounts[color]) return '米寶數量不正確';
    }
    if (!previous) {
        const start = parsed.grid.get('0,0');
        return parsed.grid.size === 1 && start?.typeKey === 'J' && !start?.meeple &&
            next.activePlayer === 'red' && next.turnPhase === 'PLACE_TILE' &&
            sameScores(next.scores, { red: 0, blue: 0, green: 0, yellow: 0 }, players) &&
            players.every(color => Number(next.meeplesRemaining[color]) === 7)
            ? null : '起始地圖不正確';
    }
    const old = parseCarcGrid(previous.grid, players);
    if (old.error || parsed.grid.size < old.grid.size || parsed.grid.size > old.grid.size + 1) return '一次只能放一張地圖卡';
    if (!hasExactCarcDeck(previous, old.grid)) return '目前牌組資料不正確';
    if (previous.turnPhase === 'GAME_OVER') return '遊戲已經結束';

    const additions = [...parsed.grid.keys()].filter(key => !old.grid.has(key));
    const previousPlacedKey = previous.turnPhase === 'DEPLOY_MEEPLE' ? coordKey(previous.justPlacedCoords) : null;
    for (const [key, oldTile] of old.grid) {
        const newTile = parsed.grid.get(key);
        if (!newTile || newTile.typeKey !== oldTile.typeKey || newTile.rotation !== oldTile.rotation) return '不能修改已放置的地圖卡';
        if (oldTile.meeple) {
            if (newTile.meeple && !sameMeeple(oldTile.meeple, newTile.meeple)) return '不能移動已放置的米寶';
        } else if (newTile.meeple && key !== previousPlacedKey) {
            return '米寶只能放在剛放下的地圖卡';
        }
    }
    if (additions.length) {
        const tile = parsed.grid.get(additions[0]);
        if (!previous.currentTile || tile.typeKey !== previous.currentTile.typeKey || tile.rotation !== previous.currentTile.rotation || !validCarcNeighbours(parsed.grid, additions[0], tile)) return '地圖卡不能放在這裡';
    }

    const nextPlayer = nextCarcPlayer(room, previous.activePlayer);
    const sameDeck = equalArrays(next.deck, previous.deck);
    const sameStateScores = sameScores(next.scores, previous.scores, players);
    const sameMeepleSupply = players.every(color => Number(next.meeplesRemaining[color]) === Number(previous.meeplesRemaining[color]));

    if (previous.turnPhase === 'PLACE_TILE' && additions.length === 0) {
        const rotationChanged = next.currentTile && previous.currentTile &&
            next.currentTile.typeKey === previous.currentTile.typeKey &&
            (next.currentTile.rotation - previous.currentTile.rotation + 4) % 4 === 1;
        if (next.turnPhase !== 'PLACE_TILE' || next.activePlayer !== previous.activePlayer ||
            !sameDeck || !rotationChanged || !sameStateScores || !sameMeepleSupply) return '旋轉地圖卡資料不正確';
    } else if (previous.turnPhase === 'PLACE_TILE' && additions.length === 1 && next.turnPhase === 'DEPLOY_MEEPLE') {
        if (next.activePlayer !== previous.activePlayer || !sameDeck || !sameCarcTile(next.currentTile, previous.currentTile) ||
            placedKey !== additions[0] || !sameStateScores || !sameMeepleSupply || parsed.grid.get(additions[0]).meeple) return '放置地圖卡資料不正確';
    } else {
        // Completing a turn (including the no-meeple path) advances exactly one
        // player. The next preview card must come from the prior deck; if no
        // playable card remains, the deck may only be re-ordered and the game ends.
        if (next.activePlayer !== nextPlayer || !['PLACE_TILE', 'GAME_OVER'].includes(next.turnPhase)) return '回合結算不正確';
        if (previous.turnPhase === 'DEPLOY_MEEPLE' && additions.length !== 0) return '米寶階段不能再放地圖卡';
        if (previous.turnPhase === 'DEPLOY_MEEPLE' && !previousPlacedKey) return '米寶放置位置不正確';
        if (previous.turnPhase === 'PLACE_TILE' && additions.length !== 1) return '必須先放置地圖卡';
        if (previous.turnPhase === 'PLACE_TILE' && Number(previous.meeplesRemaining?.[previous.activePlayer]) !== 0) return '請先完成米寶步驟';
        if (additions.length && parsed.grid.get(additions[0]).meeple) return '米寶只能在米寶步驟放置';
        if (next.turnPhase === 'PLACE_TILE') {
            const oldDeckCount = countCards(previous.deck || []);
            const nextDeckCount = countCards(next.deck || []);
            if (!next.currentTile || !oldDeckCount || !nextDeckCount || oldDeckCount[next.currentTile.typeKey] < 1 ||
                [...CARC_TILES].some(key => nextDeckCount[key] !== oldDeckCount[key] - (key === next.currentTile.typeKey ? 1 : 0))) return '下一張地圖卡不正確';
        } else if (!equalArrays([...previous.deck].sort(), [...next.deck].sort())) {
            return '結束時牌堆不正確';
        }
        for (const color of players) if (Number(next.scores[color] || 0) < Number(previous.scores?.[color] || 0)) return '分數不能倒退';
    }
    return null;
}

function resetRoom(room, by) {
    if (room.restartVoteTimer) clearTimeout(room.restartVoteTimer);
    room.restartVotes.clear();
    room.lastMove = null;
    room.winner = null;
    room.scores = null;
    if (room.gameType === 'carcassonne') {
        room.carcassonneState = null;
        room.carcassonneVersion = 0;
        room.turn = initialTurn(room.gameType);
    } else {
        room.engine.reset();
        room.turn = room.engine.turn;
    }
    room.status = 'waiting';
    updateStatus(room);
    room.lastActivity = Date.now();
    broadcastState(room, 'game_restarted', { by });
}

function requestRestart(room, role, name) {
    if (role === 'spectator' || !room.players[role]) return '觀戰者不能重新開始';
    room.restartVotes.add(role);
    const needed = roomRoles(room.playerCount).filter(item => room.players[item]);
    if (needed.every(item => room.restartVotes.has(item))) {
        resetRoom(room, name);
        return null;
    }
    if (room.restartVoteTimer) clearTimeout(room.restartVoteTimer);
    room.restartVoteTimer = setTimeout(() => {
        room.restartVotes.clear();
        broadcastState(room, 'restart_vote_expired');
    }, RESTART_VOTE_WINDOW_MS);
    broadcastState(room, 'restart_requested', { by: name, byRole: role, neededVotes: needed.length });
    return null;
}

function expireSeat(roomId, role, token) {
    const room = rooms.get(roomId);
    const player = room?.players[role];
    if (!room || !player || player.resumeToken !== token || isConnected(player)) return;
    room.players[role] = null;
    room.restartVotes.delete(role);
    updateStatus(room);
    if (!PLAYER_ROLES.some(item => room.players[item]) && room.spectators.length === 0) {
        if (room.restartVoteTimer) clearTimeout(room.restartVoteTimer);
        rooms.delete(roomId);
        return;
    }
    broadcastState(room, 'player_left', { name: player.name, role, expired: true });
}

function releaseSeat(room, role, ws, intentional) {
    if (role === 'spectator') {
        room.spectators = room.spectators.filter(spectator => spectator.ws !== ws);
        return true;
    }
    const player = room.players[role];
    if (!player || player.ws !== ws) return false;
    if (intentional) {
        room.players[role] = null;
        room.restartVotes.delete(role);
    } else {
        player.ws = null;
        player.disconnectedAt = Date.now();
        setTimeout(() => expireSeat(room.id, role, player.resumeToken), RECONNECT_GRACE_MS);
    }
    updateStatus(room);
    return true;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (pathname === '/api/info') {
        const ips = getLocalIPs();
        const primaryIp = primaryAddress();
        const primaryUrl = `http://${primaryIp}:${PORT}`;
        let qrDataUrl = '';
        try { qrDataUrl = await QRCode.toDataURL(primaryUrl, { margin: 1, width: 260 }); } catch (error) { console.error('QR code gen error:', error); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ port: PORT, ips, primaryIp, primaryUrl, qrDataUrl }));
        return;
    }
    if (pathname === '/api/rooms') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ rooms: openRooms() }));
        return;
    }
    if (pathname === '/api/room-invite') {
        const roomId = url.searchParams.get('room');
        const room = roomId ? rooms.get(roomId) : null;
        if (!room || room.status === 'ended') {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '房間不存在或已結束' }));
            return;
        }
        const inviteUrl = `http://${primaryAddress()}:${PORT}/?room=${encodeURIComponent(roomId)}`;
        const qrDataUrl = await QRCode.toDataURL(inviteUrl, { margin: 1, width: 320 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ roomId, inviteUrl, qrDataUrl }));
        return;
    }
    const requested = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
    if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
    }
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(error.code === 'ENOENT' ? '404 Not Found' : `Server Error: ${error.code}`);
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(content);
    });
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
    let currentRoomId = null;
    let currentRole = null;
    let playerName = '匿名特勤';
    let intentionalLeave = false;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', raw => {
        try {
            const data = JSON.parse(raw);
            if (data.type === 'create_room') {
                const gameType = normalizedGameType(data.gameType);
                const playerCount = normalizedPlayerCount(gameType, data.playerCount);
                playerName = String(data.name || '房主').slice(0, 20);
                const host = makePlayer(ws, playerName);
                const room = {
                    id: generateRoomId(),
                    gameType,
                    playerCount,
                    engine: gameType === 'carcassonne' ? null : makeEngine(gameType, playerCount),
                    turn: initialTurn(gameType),
                    winner: null,
                    scores: null,
                    status: 'waiting',
                    players: { black: host, white: null, blue: null, green: null },
                    spectators: [],
                    lastMove: null,
                    moveHistory: [],
                    carcassonneState: null,
                    carcassonneVersion: 0,
                    restartVotes: new Set(),
                    restartVoteTimer: null,
                    lastActivity: Date.now()
                };
                if (room.engine) room.turn = room.engine.turn;
                rooms.set(room.id, room);
                currentRoomId = room.id;
                currentRole = 'black';
                ws.send(JSON.stringify({ type: 'room_created', roomId: room.id, role: currentRole, resumeToken: host.resumeToken, roomState: getRoomPublicState(room) }));
                console.log(`[Room ${room.id}] Created (${gameType}, ${playerCount}P) by ${playerName}`);
                return;
            }

            if (data.type === 'join_room') {
                const room = rooms.get(String(data.roomId || ''));
                playerName = String(data.name || '訪客').slice(0, 20);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: `找不到房間號碼: ${data.roomId}` }));
                    return;
                }
                const token = typeof data.resumeToken === 'string' ? data.resumeToken : '';
                let role = token ? PLAYER_ROLES.find(item => room.players[item]?.resumeToken === token) : null;
                let reconnected = Boolean(role);
                if (role) {
                    const player = room.players[role];
                    if (isConnected(player) && player.ws !== ws) player.ws.terminate();
                    player.ws = ws;
                    player.disconnectedAt = null;
                    playerName = player.name;
                } else {
                    role = roomRoles(room.playerCount).find(item => !room.players[item]) || null;
                    if (role) room.players[role] = makePlayer(ws, playerName);
                    else {
                        room.spectators.push({ ws, name: playerName });
                        role = 'spectator';
                    }
                }
                currentRoomId = room.id;
                currentRole = role;
                room.lastActivity = Date.now();
                updateStatus(room);
                ws.send(JSON.stringify({
                    type: 'room_joined',
                    roomId: room.id,
                    role,
                    resumeToken: role === 'spectator' ? null : room.players[role].resumeToken,
                    roomState: getRoomPublicState(room)
                }));
                broadcastState(room, reconnected ? 'player_reconnected' : 'player_joined', { name: playerName, role, reconnected }, ws);
                return;
            }

            if (!currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            if (data.type === 'leave_room') {
                intentionalLeave = true;
                if (releaseSeat(room, currentRole, ws, true)) broadcastState(room, 'player_left', { name: playerName, role: currentRole, intentional: true });
                currentRoomId = null;
                currentRole = null;
                return;
            }

            if (data.type === 'sync_request') {
                ws.send(JSON.stringify({ type: 'state_sync', roomState: getRoomPublicState(room) }));
                return;
            }

            if (data.type === 'reaction') {
                if (currentRole === 'spectator' || !room.players[currentRole]) return;
                broadcast(room, { type: 'reaction', emoji: String(data.emoji || '').slice(0, 8), from: playerName, role: currentRole });
                return;
            }

            if (data.type === 'restart') {
                const error = requestRestart(room, currentRole, playerName);
                if (error) ws.send(JSON.stringify({ type: 'error', message: error }));
                return;
            }

            if (data.type === 'carcassonne_init' || data.type === 'carcassonne_sync') {
                if (room.gameType !== 'carcassonne' || !data.state) return;
                const player = CARC_ROLE_TO_PLAYER[currentRole];
                if (!player) {
                    ws.send(JSON.stringify({ type: 'error', message: '觀戰者不能改變棋局' }));
                    return;
                }
                if (data.actorPlayer && data.actorPlayer !== player) {
                    ws.send(JSON.stringify({ type: 'error', message: '不能代替其他玩家操作' }));
                    return;
                }
                if (data.type === 'carcassonne_init') {
                    if (currentRole !== 'black' || room.carcassonneState) return;
                } else {
                    if (player !== room.carcassonneState?.activePlayer) {
                        ws.send(JSON.stringify({ type: 'error', message: '現在不是你的回合' }));
                        return;
                    }
                    if (Number(data.baseVersion) !== room.carcassonneVersion) {
                        ws.send(JSON.stringify({ type: 'state_sync', roomState: getRoomPublicState(room) }));
                        return;
                    }
                }
                const error = validateCarcState(data.state, room.carcassonneState, room);
                if (error) {
                    ws.send(JSON.stringify({ type: 'error', message: error }));
                    ws.send(JSON.stringify({ type: 'state_sync', roomState: getRoomPublicState(room) }));
                    return;
                }
                room.carcassonneState = canonicalizeCarcState(room, data.state);
                room.carcassonneVersion++;
                room.turn = room.carcassonneState.activePlayer;
                room.scores = room.carcassonneState.scores;
                room.winner = room.carcassonneState.gameResult?.winners?.[0] || null;
                room.status = room.carcassonneState.turnPhase === 'GAME_OVER' ? 'ended' : room.status;
                if (room.status !== 'ended') updateStatus(room);
                room.lastActivity = Date.now();
                broadcastState(room, 'carcassonne_state');
                return;
            }

            if (data.type === 'move') {
                if (!room.engine) return;
                const expected = roleForTurn(room, room.engine.turn);
                if (currentRole === 'spectator' || room.status !== 'playing' || currentRole !== expected) {
                    ws.send(JSON.stringify({ type: 'error', message: room.status === 'reconnecting' ? '等待其他玩家重新連線' : '現在不是你的回合' }));
                    // A phone may have rendered an optimistic/stale board just
                    // before a turn switch. Always return the canonical state
                    // with a rejected move so it can recover immediately.
                    ws.send(JSON.stringify({ type: 'state_sync', roomState: getRoomPublicState(room) }));
                    return;
                }
                const result = applyMove(room, data);
                if (!result.ok) {
                    ws.send(JSON.stringify({ type: 'error', message: result.error }));
                    ws.send(JSON.stringify({ type: 'state_sync', roomState: getRoomPublicState(room) }));
                    return;
                }
                room.turn = room.engine.turn;
                room.winner = room.engine.winner || null;
                room.lastMove = { ...(room.engine.lastMove || {}), by: currentRole };
                room.moveHistory.push({ by: currentRole, action: data.action || 'move', at: Date.now() });
                if (room.moveHistory.length > 120) room.moveHistory.shift();
                if (room.winner) room.status = 'ended';
                room.lastActivity = Date.now();
                broadcastState(room, 'move_made', { move: room.lastMove });
            }
        } catch (error) {
            console.error('WebSocket message parsing error:', error);
        }
    });

    ws.on('close', () => {
        if (!currentRoomId || intentionalLeave) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;
        if (releaseSeat(room, currentRole, ws, false)) {
            broadcastState(room, 'player_left', { name: playerName, role: currentRole, reconnecting: currentRole !== 'spectator' });
        }
    });
});

const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

function startServer(portToTry) {
    server.removeAllListeners('error');
    server.once('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.log(`⚠️ 連接埠 ${portToTry} 已被佔用，自動切換至 ${portToTry + 1}...`);
            startServer(portToTry + 1);
        } else {
            console.error('伺服器啟動錯誤:', error);
        }
    });
    server.listen(portToTry, '0.0.0.0', async () => {
        PORT = server.address().port;
        const ips = getLocalIPs();
        const url = `http://${primaryAddress()}:${PORT}`;
        console.log('\n======================================================');
        console.log('  ✈️  機上離線棋藝盒 (Pocket Game Hub 9-in-1)');
        console.log('======================================================');
        console.log(`🚀 本地伺服器已啟動於連接埠: ${PORT}`);
        console.log(`📱 本機遊玩網址:  http://localhost:${PORT}`);
        console.log(`📡 熱點分享網址:  ${url}`);
        if (ips.length > 1) ips.forEach(ip => console.log(`     - [${ip.name}]: http://${ip.address}:${PORT}`));
        console.log('------------------------------------------------------');
        console.log('📲 請讓同行朋友連接你的 Wi-Fi 熱點後，掃描下方 QR Code 即玩：');
        console.log('------------------------------------------------------');
        try { console.log(await QRCode.toString(url, { type: 'terminal', small: true })); }
        catch (error) { console.log(`(無法在終端機繪製 QR Code，請直接開啟 ${url})`); }
        console.log('======================================================\n');
    });
}

startServer(PORT);
