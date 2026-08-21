// Gomoku (五子棋) Game Engine & AI
class GomokuEngine {
    constructor(size = 15) {
        this.size = size;
        this.board = Array(size).fill(null).map(() => Array(size).fill(null));
        this.turn = 'black'; // 'black' moves first
        this.winner = null;
        this.winningLine = null;
        this.lastMove = null;
        this.moveHistory = [];
    }

    reset() {
        this.board = Array(this.size).fill(null).map(() => Array(this.size).fill(null));
        this.turn = 'black';
        this.winner = null;
        this.winningLine = null;
        this.lastMove = null;
        this.moveHistory = [];
    }

    loadState(state) {
        if (!state) return;
        if (state.board) this.board = state.board;
        if (state.turn) this.turn = state.turn;
        if (state.winner !== undefined) this.winner = state.winner;
        if (state.lastMove) this.lastMove = state.lastMove;
        if (this.winner && this.lastMove) {
            const winCheck = this.checkWinAt(this.lastMove.x, this.lastMove.y);
            if (winCheck) this.winningLine = winCheck.line;
        }
    }

    isValidMove(x, y) {
        if (this.winner) return false;
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
        return this.board[y][x] === null;
    }

    makeMove(x, y) {
        if (!this.isValidMove(x, y)) return false;

        const color = this.turn;
        this.board[y][x] = color;
        this.lastMove = { x, y, color };
        this.moveHistory.push({ x, y, color });

        const winResult = this.checkWinAt(x, y);
        if (winResult) {
            this.winner = color;
            this.winningLine = winResult.line;
        } else if (this.isBoardFull()) {
            this.winner = 'draw';
        } else {
            this.turn = this.turn === 'black' ? 'white' : 'black';
        }

        return true;
    }

    isBoardFull() {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] === null) return false;
            }
        }
        return true;
    }

    checkWinAt(x, y) {
        const color = this.board[y][x];
        if (!color) return null;

        const directions = [
            [1, 0],  // Horizontal
            [0, 1],  // Vertical
            [1, 1],  // Diagonal \
            [1, -1]  // Diagonal /
        ];

        for (const [dx, dy] of directions) {
            const line = [{ x, y }];

            // Forward
            for (let step = 1; step < 5; step++) {
                const nx = x + dx * step;
                const ny = y + dy * step;
                if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size && this.board[ny][nx] === color) {
                    line.push({ x: nx, y: ny });
                } else {
                    break;
                }
            }

            // Backward
            for (let step = 1; step < 5; step++) {
                const nx = x - dx * step;
                const ny = y - dy * step;
                if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size && this.board[ny][nx] === color) {
                    line.unshift({ x: nx, y: ny });
                } else {
                    break;
                }
            }

            if (line.length >= 5) {
                return { winner: color, line };
            }
        }

        return null;
    }

    // Heuristic AI for single player offline practice
    getAIMove(aiColor) {
        const oppColor = aiColor === 'black' ? 'white' : 'black';
        const center = Math.floor(this.size / 2);

        // First move center if available
        if (this.board[center][center] === null && this.moveHistory.length === 0) {
            return { x: center, y: center };
        }

        let bestScore = -Infinity;
        let bestMoves = [];

        // Score all available candidate positions (adjacent to existing pieces)
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] !== null) continue;

                // Only consider positions with nearby stones to optimize speed
                if (!this.hasNeighbor(x, y, 2)) continue;

                const attackScore = this.evaluatePos(x, y, aiColor);
                const defenseScore = this.evaluatePos(x, y, oppColor);
                
                // Prioritize instant wins and defense over standard attacks
                const totalScore = attackScore * 1.1 + defenseScore;

                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    bestMoves = [{ x, y }];
                } else if (totalScore === bestScore) {
                    bestMoves.push({ x, y });
                }
            }
        }

        if (bestMoves.length === 0) {
            return { x: center, y: center };
        }

        // Randomly pick one of the best scoring moves for slight variety
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    hasNeighbor(x, y, dist = 1) {
        for (let dy = -dist; dy <= dist; dy++) {
            for (let dx = -dist; dx <= dist; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) {
                    if (this.board[ny][nx] !== null) return true;
                }
            }
        }
        return false;
    }

    evaluatePos(x, y, color) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        let score = 0;

        for (const [dx, dy] of directions) {
            let count = 1;
            let openEnds = 0;

            // Check forward
            let step = 1;
            while (step < 5) {
                const nx = x + dx * step;
                const ny = y + dy * step;
                if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) break;
                if (this.board[ny][nx] === color) {
                    count++;
                } else if (this.board[ny][nx] === null) {
                    openEnds++;
                    break;
                } else {
                    break;
                }
                step++;
            }

            // Check backward
            step = 1;
            while (step < 5) {
                const nx = x - dx * step;
                const ny = y - dy * step;
                if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) break;
                if (this.board[ny][nx] === color) {
                    count++;
                } else if (this.board[ny][nx] === null) {
                    openEnds++;
                    break;
                } else {
                    break;
                }
                step++;
            }

            if (count >= 5) score += 100000;
            else if (count === 4 && openEnds === 2) score += 10000;
            else if (count === 4 && openEnds === 1) score += 1000;
            else if (count === 3 && openEnds === 2) score += 1000;
            else if (count === 3 && openEnds === 1) score += 100;
            else if (count === 2 && openEnds === 2) score += 100;
            else if (count === 2 && openEnds === 1) score += 10;
        }

        return score;
    }
}

window.GomokuEngine = GomokuEngine;
