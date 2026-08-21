// Reversi / Othello (黑白棋) Game Engine & AI
class ReversiEngine {
    constructor(size = 8) {
        this.size = size;
        this.board = Array(size).fill(null).map(() => Array(size).fill(null));
        this.turn = 'black'; // Black moves first
        this.winner = null;
        this.lastMove = null;
        this.justFlipped = [];
        this.passedTurn = false;
        this.init();
    }

    init() {
        this.board = Array(this.size).fill(null).map(() => Array(this.size).fill(null));
        const mid = this.size / 2;
        // Standard initial 4 pieces
        this.board[mid - 1][mid - 1] = 'white';
        this.board[mid][mid] = 'white';
        this.board[mid - 1][mid] = 'black';
        this.board[mid][mid - 1] = 'black';

        this.turn = 'black';
        this.winner = null;
        this.lastMove = null;
        this.justFlipped = [];
        this.passedTurn = false;
    }

    reset() {
        this.init();
    }

    loadState(state) {
        if (!state) return;
        if (state.board) this.board = state.board;
        if (state.turn) this.turn = state.turn;
        if (state.winner !== undefined) this.winner = state.winner;
        if (state.lastMove) this.lastMove = state.lastMove;
    }

    getCounts() {
        let black = 0;
        let white = 0;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] === 'black') black++;
                else if (this.board[y][x] === 'white') white++;
            }
        }
        return { black, white };
    }

    getFlipsForMove(x, y, color) {
        if (this.board[y][x] !== null) return [];

        const oppColor = color === 'black' ? 'white' : 'black';
        const directions = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0],           [1, 0],
            [-1, 1],  [0, 1],  [1, 1]
        ];

        const flips = [];

        for (const [dx, dy] of directions) {
            const dirFlips = [];
            let curX = x + dx;
            let curY = y + dy;

            while (curX >= 0 && curX < this.size && curY >= 0 && curY < this.size && this.board[curY][curX] === oppColor) {
                dirFlips.push({ x: curX, y: curY });
                curX += dx;
                curY += dy;
            }

            if (dirFlips.length > 0 && curX >= 0 && curX < this.size && curY >= 0 && curY < this.size && this.board[curY][curX] === color) {
                flips.push(...dirFlips);
            }
        }

        return flips;
    }

    getValidMoves(color = this.turn) {
        const moves = [];
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const flips = this.getFlipsForMove(x, y, color);
                if (flips.length > 0) {
                    moves.push({ x, y, flips });
                }
            }
        }
        return moves;
    }

    makeMove(x, y) {
        if (this.winner) return false;

        const flips = this.getFlipsForMove(x, y, this.turn);
        if (flips.length === 0) return false;

        const color = this.turn;
        this.board[y][x] = color;

        // Flip pieces
        for (const pos of flips) {
            this.board[pos.y][pos.x] = color;
        }

        this.justFlipped = flips;
        this.lastMove = { x, y, color, count: flips.length };
        this.passedTurn = false;

        // Switch to next player
        const nextColor = color === 'black' ? 'white' : 'black';
        const nextValidMoves = this.getValidMoves(nextColor);

        if (nextValidMoves.length > 0) {
            this.turn = nextColor;
        } else {
            // Next player has no valid moves, check if current player has valid moves (pass)
            const currentValidMoves = this.getValidMoves(color);
            if (currentValidMoves.length > 0) {
                this.passedTurn = true; // Current player continues
            } else {
                // Both players have no valid moves -> Game Over
                this.endGame();
            }
        }

        return true;
    }

    endGame() {
        const counts = this.getCounts();
        if (counts.black > counts.white) {
            this.winner = 'black';
        } else if (counts.white > counts.black) {
            this.winner = 'white';
        } else {
            this.winner = 'draw';
        }
    }

    // Heuristic AI for single player offline practice
    getAIMove(aiColor) {
        const validMoves = this.getValidMoves(aiColor);
        if (validMoves.length === 0) return null;

        // Positional Weight Matrix for 8x8 Reversi
        const weights = [
            [100, -20,  10,   5,   5,  10, -20, 100],
            [-20, -50,  -2,  -2,  -2,  -2, -50, -20],
            [ 10,  -2,  -1,  -1,  -1,  -1,  -2,  10],
            [  5,  -2,  -1,   0,   0,  -1,  -2,   5],
            [  5,  -2,  -1,   0,   0,  -1,  -2,   5],
            [ 10,  -2,  -1,  -1,  -1,  -1,  -2,  10],
            [-20, -50,  -2,  -2,  -2,  -2, -50, -20],
            [100, -20,  10,   5,   5,  10, -20, 100]
        ];

        let bestScore = -Infinity;
        let bestMove = validMoves[0];

        for (const move of validMoves) {
            let score = weights[move.y][move.x];
            // Bonus for piece count flipped
            score += move.flips.length * 2;

            // Extra bonus if claiming a corner
            if ((move.x === 0 || move.x === 7) && (move.y === 0 || move.y === 7)) {
                score += 500;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }

        return { x: bestMove.x, y: bestMove.y };
    }
}

window.ReversiEngine = ReversiEngine;
