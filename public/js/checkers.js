// Chinese Checkers (六角星形跳棋 / 波子棋) Engine & Graph Solver
class ChineseCheckersEngine {
    constructor(playerCount = 2) {
        this.playerCount = playerCount; // 2 or 3
        this.holes = [];      // 121 holes: { id, r, c, x, y, neighbors: [id|null * 6], cornerId: 0..5 | null }
        this.board = [];      // index 0..120 -> null | 'red' | 'green' | 'blue'
        this.players = [];    // array of active player colors
        this.turnIndex = 0;   // index in this.players
        this.winner = null;
        this.lastMove = null;
        this.selectedHole = null;

        this.buildBoardGraph();
        this.init(playerCount);
    }

    // Build the 121-hole hexagonal star graph and coordinates
    buildBoardGraph() {
        this.holes = [];
        const rowCounts = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
        
        let idCounter = 0;
        const width = 600;
        const height = 660;
        const centerX = width / 2;
        const centerY = height / 2;
        const stepX = 36;
        const stepY = stepX * 0.8660254; // sqrt(3)/2 = 31.1769

        for (let r = 0; r < 17; r++) {
            const count = rowCounts[r];
            const startX = centerX - ((count - 1) * stepX) / 2;
            const y = centerY + (r - 8) * stepY;

            for (let c = 0; c < count; c++) {
                const x = startX + c * stepX;
                this.holes.push({
                    id: idCounter++,
                    r,
                    c,
                    x,
                    y,
                    neighbors: [null, null, null, null, null, null], // 6 dirs: 0:TR, 1:R, 2:BR, 3:BL, 4:L, 5:TL
                    cornerId: null
                });
            }
        }

        // Link neighboring holes with exact hexagonal discrete angles:
        // TR: -60°, R: 0°, BR: +60°, BL: +120°, L: 180°, TL: -120°
        for (let i = 0; i < this.holes.length; i++) {
            const h1 = this.holes[i];
            for (let j = 0; j < this.holes.length; j++) {
                if (i === j) continue;
                const h2 = this.holes[j];
                const dx = h2.x - h1.x;
                const dy = h2.y - h1.y;
                const dist = Math.hypot(dx, dy);

                if (Math.abs(dist - stepX) < 4.0) {
                    const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180 to 180
                    if (angle >= -75 && angle <= -45) h1.neighbors[0] = j;        // TR (-60°)
                    else if (angle >= -15 && angle <= 15) h1.neighbors[1] = j;   // R (0°)
                    else if (angle >= 45 && angle <= 75) h1.neighbors[2] = j;    // BR (+60°)
                    else if (angle >= 105 && angle <= 135) h1.neighbors[3] = j;  // BL (+120°)
                    else if (angle >= 165 || angle <= -165) h1.neighbors[4] = j;// L (180°)
                    else if (angle >= -135 && angle <= -105) h1.neighbors[5] = j;// TL (-120°)
                }
            }
        }

        // Classify 6 triangular corner zones (10 holes each)
        this.corners = {
            0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], // Top (10 holes)
            3: [111, 112, 113, 114, 115, 116, 117, 118, 119, 120], // Bottom (10 holes)
            1: [], 2: [], 4: [], 5: []
        };

        for (const h of this.holes) {
            if (this.corners[0].includes(h.id)) h.cornerId = 0;
            else if (this.corners[3].includes(h.id)) h.cornerId = 3;
            else {
                // Top-Left (5) vs Top-Right (1)
                if (h.r === 4) {
                    if (h.c <= 3) { this.corners[5].push(h.id); h.cornerId = 5; }
                    else if (h.c >= 9) { this.corners[1].push(h.id); h.cornerId = 1; }
                } else if (h.r === 5) {
                    if (h.c <= 2) { this.corners[5].push(h.id); h.cornerId = 5; }
                    else if (h.c >= 9) { this.corners[1].push(h.id); h.cornerId = 1; }
                } else if (h.r === 6) {
                    if (h.c <= 1) { this.corners[5].push(h.id); h.cornerId = 5; }
                    else if (h.c >= 9) { this.corners[1].push(h.id); h.cornerId = 1; }
                } else if (h.r === 7) {
                    if (h.c === 0) { this.corners[5].push(h.id); h.cornerId = 5; }
                    else if (h.c === 9) { this.corners[1].push(h.id); h.cornerId = 1; }
                }
                // Bottom-Left (4) vs Bottom-Right (2)
                else if (h.r === 9) {
                    if (h.c === 0) { this.corners[4].push(h.id); h.cornerId = 4; }
                    else if (h.c === 9) { this.corners[2].push(h.id); h.cornerId = 2; }
                } else if (h.r === 10) {
                    if (h.c <= 1) { this.corners[4].push(h.id); h.cornerId = 4; }
                    else if (h.c >= 9) { this.corners[2].push(h.id); h.cornerId = 2; }
                } else if (h.r === 11) {
                    if (h.c <= 2) { this.corners[4].push(h.id); h.cornerId = 4; }
                    else if (h.c >= 9) { this.corners[2].push(h.id); h.cornerId = 2; }
                } else if (h.r === 12) {
                    if (h.c <= 3) { this.corners[4].push(h.id); h.cornerId = 4; }
                    else if (h.c >= 9) { this.corners[2].push(h.id); h.cornerId = 2; }
                }
            }
        }
    }

    init(playerCount = 2) {
        this.playerCount = playerCount;
        this.board = Array(121).fill(null);
        this.winner = null;
        this.lastMove = null;
        this.selectedHole = null;

        if (this.playerCount === 2) {
            this.players = ['red', 'green'];
            this.targetCorners = { red: 3, green: 0 };
            this.startCorners = { red: 0, green: 3 };
            for (const id of this.corners[0]) this.board[id] = 'red';
            for (const id of this.corners[3]) this.board[id] = 'green';
        } else {
            this.players = ['red', 'green', 'blue'];
            this.targetCorners = { red: 3, green: 5, blue: 1 };
            this.startCorners = { red: 0, green: 2, blue: 4 };
            for (const id of this.corners[0]) this.board[id] = 'red';
            for (const id of this.corners[2]) this.board[id] = 'green';
            for (const id of this.corners[4]) this.board[id] = 'blue';
        }

        this.turnIndex = 0;
    }

    reset() {
        this.init(this.playerCount);
    }

    get turn() {
        return this.players[this.turnIndex];
    }

    loadState(state) {
        if (!state) return;
        if (state.playerCount) this.playerCount = state.playerCount;
        if (state.board) this.board = state.board;
        if (state.turn) {
            const idx = this.players.indexOf(state.turn);
            if (idx !== -1) this.turnIndex = idx;
        }
        if (state.winner !== undefined) this.winner = state.winner;
        if (state.lastMove) this.lastMove = state.lastMove;
    }

    // Generate all valid destinations for a marble at holeId (single steps + chain jumps)
    getValidMoves(holeId) {
        const color = this.board[holeId];
        if (!color || color !== this.turn || this.winner) return [];

        const validDestinations = new Map();

        // 1. Single Steps (distance 1 into empty neighbor)
        const hole = this.holes[holeId];
        for (let dir = 0; dir < 6; dir++) {
            const neighborId = hole.neighbors[dir];
            if (neighborId !== null && this.board[neighborId] === null) {
                validDestinations.set(neighborId, { type: 'step', path: [holeId, neighborId] });
            }
        }

        // 2. Multi-step Chain Jumps (BFS exploration)
        const visited = new Set([holeId]);
        const queue = [{ id: holeId, path: [holeId] }];

        while (queue.length > 0) {
            const { id, path } = queue.shift();
            const curHole = this.holes[id];

            for (let dir = 0; dir < 6; dir++) {
                const midId = curHole.neighbors[dir];
                if (midId !== null && this.board[midId] !== null) {
                    // There is a marble to jump over
                    const landingId = this.holes[midId].neighbors[dir];
                    if (landingId !== null && this.board[landingId] === null && !visited.has(landingId)) {
                        visited.add(landingId);
                        const newPath = [...path, landingId];
                        validDestinations.set(landingId, { type: 'jump', path: newPath });
                        queue.push({ id: landingId, path: newPath });
                    }
                }
            }
        }

        return Array.from(validDestinations.entries()).map(([targetId, info]) => ({
            targetId: parseInt(targetId, 10),
            type: info.type,
            path: info.path
        }));
    }

    makeMove(fromId, toId) {
        if (this.winner) return false;
        const color = this.board[fromId];
        if (!color || color !== this.turn) return false;

        const validMoves = this.getValidMoves(fromId);
        const move = validMoves.find(m => m.targetId === toId);
        if (!move) return false;

        this.board[toId] = color;
        this.board[fromId] = null;
        this.lastMove = { from: fromId, to: toId, color, path: move.path, type: move.type };
        this.selectedHole = null;

        if (this.checkWin(color)) {
            this.winner = color;
        } else {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
        }

        return true;
    }

    checkWin(color) {
        const targetCornerId = this.targetCorners[color];
        const targetHoles = this.corners[targetCornerId];
        let filledCount = 0;

        for (const hid of targetHoles) {
            if (this.board[hid] === color) {
                filledCount++;
            }
        }

        return filledCount === 10;
    }

    // Heuristic AI
    getAIMove(color = this.turn) {
        const targetCornerId = this.targetCorners[color];
        const targetHoles = this.corners[targetCornerId];
        
        let targetX = 0, targetY = 0;
        targetHoles.forEach(id => {
            targetX += this.holes[id].x;
            targetY += this.holes[id].y;
        });
        targetX /= targetHoles.length;
        targetY /= targetHoles.length;

        const candidateMoves = [];

        for (let hid = 0; hid < 121; hid++) {
            if (this.board[hid] === color) {
                const validMoves = this.getValidMoves(hid);
                const fromHole = this.holes[hid];
                const fromDist = Math.hypot(fromHole.x - targetX, fromHole.y - targetY);

                for (const m of validMoves) {
                    const toHole = this.holes[m.targetId];
                    const toDist = Math.hypot(toHole.x - targetX, toHole.y - targetY);
                    
                    let score = (fromDist - toDist) * 10;

                    // Bonus for moving pieces out of home
                    if (this.corners[this.startCorners[color]].includes(hid)) {
                        score += 25;
                    }
                    // Bonus for entering target corner
                    if (targetHoles.includes(m.targetId)) {
                        score += 50;
                    }
                    // Chain jump bonus
                    if (m.type === 'jump') {
                        score += (m.path.length - 1) * 8;
                    }

                    candidateMoves.push({ from: hid, to: m.targetId, score, path: m.path });
                }
            }
        }

        if (candidateMoves.length === 0) return null;

        candidateMoves.sort((a, b) => b.score - a.score);
        const bestMoves = candidateMoves.filter(m => m.score === candidateMoves[0].score);
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }
}

window.ChineseCheckersEngine = ChineseCheckersEngine;
