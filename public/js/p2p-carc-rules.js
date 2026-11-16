/* Carcassonne terrain/turn validator shared from the LAN server implementation.
   Keep in sync with the corresponding server.js helpers. No browser trust of guest snapshots. */
(function(root) {
'use strict';
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
    if (parsed.error || !Array.isArray(next.deck) || !next.scores || !next.meeplesRemaining) return parsed.error || '築城物語狀態不完整';
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


root.PocketCarcRules = Object.freeze({
  validate:validateCarcState,
  canonicalize:canonicalizeCarcState
});
})(window);
