// Blokus (德國圍棋 / 格格不入 / 俄羅斯幾何方塊棋) Engine & AI Solver
class BlokusEngine {
    constructor(playerCount = 2) {
        this.playerCount = playerCount; // 2 (14x14 Blokus Duo) or 4 (20x20 Classic)
        this.size = playerCount === 2 ? 14 : 20;
        this.board = []; // size x size -> null | 'blue' | 'yellow' | 'red' | 'green'
        this.players = [];
        this.startPoints = {}; // color -> [{x, y}]
        this.turnIndex = 0;
        this.playerPieces = {}; // color -> Array of 21 pieces: { id, coords: [[x,y]...], size, used: bool }
        this.passedPlayers = new Set();
        this.winner = null;
        this.lastMove = null;
        this.scores = {};

        this.init(playerCount);
    }

    static get PIECE_SHAPES() {
        return [
            // 1-square (1)
            [[0,0]],
            // 2-square (1)
            [[0,0],[0,1]],
            // 3-squares (2)
            [[0,0],[0,1],[0,2]],
            [[0,0],[1,0],[0,1]],
            // 4-squares (5)
            [[0,0],[0,1],[0,2],[0,3]],
            [[0,0],[1,0],[2,0],[2,1]],
            [[0,0],[0,1],[1,0],[1,1]],
            [[0,0],[0,1],[0,2],[1,1]],
            [[0,0],[0,1],[1,1],[1,2]],
            // 5-squares (12)
            [[0,0],[0,1],[0,2],[0,3],[0,4]],
            [[0,0],[1,0],[2,0],[3,0],[3,1]],
            [[0,0],[1,0],[2,0],[3,0],[1,1]],
            [[0,0],[1,0],[2,0],[2,1],[3,1]],
            [[0,0],[0,1],[1,0],[1,1],[2,0]],
            [[0,0],[0,2],[1,0],[1,1],[1,2]],
            [[0,0],[0,1],[0,2],[1,1],[2,1]],
            [[0,0],[1,0],[2,0],[2,1],[2,2]],
            [[0,0],[1,0],[1,1],[2,1],[2,2]],
            [[0,1],[1,0],[1,1],[1,2],[2,1]],
            [[0,0],[0,1],[1,1],[2,1],[2,2]],
            [[0,1],[1,0],[1,1],[1,2],[2,2]]
        ];
    }

    init(playerCount = 2) {
        this.playerCount = playerCount;
        this.size = playerCount === 2 ? 14 : 20;
        this.board = Array.from({ length: this.size }, () => Array(this.size).fill(null));
        this.passedPlayers = new Set();
        this.winner = null;
        this.lastMove = null;

        if (this.playerCount === 2) {
            // Blokus Duo (14x14)
            this.players = ['blue', 'orange'];
            this.startPoints = {
                blue: [{ x: 4, y: 4 }],
                orange: [{ x: 9, y: 9 }]
            };
        } else {
            // Blokus Classic (20x20, 4 Players)
            this.players = ['blue', 'yellow', 'red', 'green'];
            this.startPoints = {
                blue: [{ x: 0, y: 0 }],
                yellow: [{ x: 19, y: 0 }],
                red: [{ x: 19, y: 19 }],
                green: [{ x: 0, y: 19 }]
            };
        }

        this.playerPieces = {};
        for (const color of this.players) {
            this.playerPieces[color] = BlokusEngine.PIECE_SHAPES.map((shape, id) => ({
                id,
                coords: shape.map(([y, x]) => [y, x]),
                size: shape.length,
                used: false
            }));
        }

        this.turnIndex = 0;
        this.updateScores();
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
        if (state.size) this.size = state.size;
        if (state.board) this.board = state.board;
        if (state.turn) {
            const idx = this.players.indexOf(state.turn);
            if (idx !== -1) this.turnIndex = idx;
        }
        if (state.playerPieces) this.playerPieces = state.playerPieces;
        if (state.winner !== undefined) this.winner = state.winner;
        if (state.lastMove) this.lastMove = state.lastMove;
        if (state.scores) this.scores = state.scores;
    }

    // Transformations
    static normalize(coords) {
        let minY = Infinity, minX = Infinity;
        for (const [y, x] of coords) {
            if (y < minY) minY = y;
            if (x < minX) minX = x;
        }
        return coords.map(([y, x]) => [y - minY, x - minX]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }

    static rotate(coords) {
        // 90° clockwise: (y, x) -> (x, -y)
        const rotated = coords.map(([y, x]) => [x, -y]);
        return BlokusEngine.normalize(rotated);
    }

    static flip(coords) {
        // Horizontal flip: (y, x) -> (y, -x)
        const flipped = coords.map(([y, x]) => [y, -x]);
        return BlokusEngine.normalize(flipped);
    }

    static getAllOrientations(coords) {
        const orientations = [];
        const seen = new Set();

        let cur = BlokusEngine.normalize(coords);
        for (let f = 0; f < 2; f++) {
            for (let r = 0; r < 4; r++) {
                const key = cur.map(([y, x]) => `${y},${x}`).join(';');
                if (!seen.has(key)) {
                    seen.add(key);
                    orientations.push(cur);
                }
                cur = BlokusEngine.rotate(cur);
            }
            cur = BlokusEngine.flip(cur);
        }
        return orientations;
    }

    // Check if player has placed any piece yet
    isFirstMove(color) {
        return this.playerPieces[color].every(p => !p.used);
    }

    // Check if placing a piece at (originY, originX) with shape `coords` is legal for `color`
    isValidPlacement(color, coords, originY, originX) {
        let touchesStart = false;
        let touchesCorner = false;
        const isFirst = this.isFirstMove(color);

        for (const [dy, dx] of coords) {
            const y = originY + dy;
            const x = originX + dx;

            // 1. Boundary check
            if (y < 0 || y >= this.size || x < 0 || x >= this.size) return false;

            // 2. Overlap check
            if (this.board[y][x] !== null) return false;

            // 3. First move: Must touch designated start point
            if (isFirst) {
                if (this.startPoints[color].some(pt => pt.x === x && pt.y === y)) {
                    touchesStart = true;
                }
            } else {
                // 4. Edge check: Must NOT touch any orthogonal edge of same color
                const edges = [[y-1, x], [y+1, x], [y, x-1], [y, x+1]];
                for (const [ey, ex] of edges) {
                    if (ey >= 0 && ey < this.size && ex >= 0 && ex < this.size) {
                        if (this.board[ey][ex] === color) return false; // Edge contact forbidden!
                    }
                }

                // 5. Corner check: Must touch at least one diagonal corner of same color
                const corners = [[y-1, x-1], [y-1, x+1], [y+1, x-1], [y+1, x+1]];
                for (const [cy, cx] of corners) {
                    if (cy >= 0 && cy < this.size && cx >= 0 && cx < this.size) {
                        if (this.board[cy][cx] === color) {
                            touchesCorner = true;
                        }
                    }
                }
            }
        }

        return isFirst ? touchesStart : touchesCorner;
    }

    placePiece(pieceId, coords, originY, originX) {
        if (this.winner) return false;
        const color = this.turn;
        const piece = this.playerPieces[color].find(p => p.id === pieceId);
        if (!piece || piece.used) return false;

        if (!this.isValidPlacement(color, coords, originY, originX)) return false;

        // Place on board
        const placedCells = [];
        for (const [dy, dx] of coords) {
            const y = originY + dy;
            const x = originX + dx;
            this.board[y][x] = color;
            placedCells.push({ y, x });
        }

        piece.used = true;
        this.lastMove = { color, pieceId, cells: placedCells };
        this.passedPlayers.delete(color);

        this.updateScores();
        this.advanceTurn();
        return true;
    }

    passTurn() {
        if (this.winner) return;
        this.passedPlayers.add(this.turn);
        this.advanceTurn();
    }

    advanceTurn() {
        if (this.passedPlayers.size >= this.players.length) {
            // All players passed -> Game Over
            this.determineWinner();
            return;
        }

        let nextIdx = (this.turnIndex + 1) % this.players.length;
        let attempts = 0;
        while (this.passedPlayers.has(this.players[nextIdx]) && attempts < this.players.length) {
            nextIdx = (nextIdx + 1) % this.players.length;
            attempts++;
        }

        if (attempts >= this.players.length) {
            this.determineWinner();
        } else {
            this.turnIndex = nextIdx;
        }
    }

    updateScores() {
        for (const color of this.players) {
            let remainingSquares = 0;
            let allUsed = true;
            for (const p of this.playerPieces[color]) {
                if (!p.used) {
                    remainingSquares += p.size;
                    allUsed = false;
                }
            }
            // Score = negative of remaining squares (0 is perfect, -89 is worst)
            let score = -remainingSquares;
            if (allUsed) score += 15; // Bonus for placing all pieces
            this.scores[color] = score;
        }
    }

    determineWinner() {
        this.updateScores();
        let bestScore = -Infinity;
        let winnerColor = null;

        for (const color of this.players) {
            if (this.scores[color] > bestScore) {
                bestScore = this.scores[color];
                winnerColor = color;
            }
        }
        this.winner = winnerColor;
    }

    // Get all valid placements for a specific piece of `color`
    getValidPlacementsForPiece(color, pieceCoords) {
        const orientations = BlokusEngine.getAllOrientations(pieceCoords);
        const validPlacements = [];

        for (const shape of orientations) {
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (this.isValidPlacement(color, shape, y, x)) {
                        validPlacements.push({ shape, y, x });
                    }
                }
            }
        }
        return validPlacements;
    }

    // AI Solver for Blokus: Tries larger pieces first and expands towards board center
    getAIMove(color = this.turn) {
        const unusedPieces = this.playerPieces[color].filter(p => !p.used);
        // Sort pieces descending by size (5-squares first)
        unusedPieces.sort((a, b) => b.size - a.size);

        const center = (this.size - 1) / 2;

        for (const piece of unusedPieces) {
            const placements = this.getValidPlacementsForPiece(color, piece.coords);
            if (placements.length > 0) {
                // Score placements by piece size and proximity to center
                placements.sort((a, b) => {
                    const distA = Math.hypot(a.y - center, a.x - center);
                    const distB = Math.hypot(b.y - center, b.x - center);
                    return distA - distB;
                });
                const chosen = placements[0];
                return { pieceId: piece.id, shape: chosen.shape, y: chosen.y, x: chosen.x };
            }
        }

        return null; // Must pass
    }
}

window.BlokusEngine = BlokusEngine;
