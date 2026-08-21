// Connect 4 (重力四子棋) Engine & AI Solver
class Connect4Engine {
    constructor(cols = 7, rows = 6) {
        this.cols = cols;
        this.rows = rows;
        this.board = []; // 6x7 grid (rows x cols), null | 'red' | 'yellow'
        this.turn = 'red'; // 'red' | 'yellow'
        this.winner = null; // null | 'red' | 'yellow' | 'draw'
        this.winningCells = []; // [{r, c}, ...]
        this.lastMove = null; // {r, c, color}
        this.init();
    }

    init() {
        this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
        this.turn = 'red';
        this.winner = null;
        this.winningCells = [];
        this.lastMove = null;
    }

    reset() {
        this.init();
    }

    loadState(state) {
        if (!state) return;
        if (state.board) this.board = state.board;
        if (state.turn) this.turn = state.turn;
        if (state.winner !== undefined) this.winner = state.winner;
        if (state.winningCells) this.winningCells = state.winningCells;
        if (state.lastMove) this.lastMove = state.lastMove;
    }

    // Get lowest available row in column `col`
    getAvailableRow(col) {
        if (col < 0 || col >= this.cols) return -1;
        for (let r = this.rows - 1; r >= 0; r--) {
            if (this.board[r][col] === null) {
                return r;
            }
        }
        return -1; // Column full
    }

    getValidColumns() {
        const valid = [];
        for (let c = 0; c < this.cols; c++) {
            if (this.getAvailableRow(c) !== -1) {
                valid.push(c);
            }
        }
        return valid;
    }

    makeMove(col) {
        if (this.winner) return false;
        const row = this.getAvailableRow(col);
        if (row === -1) return false;

        const color = this.turn;
        this.board[row][col] = color;
        this.lastMove = { r: row, c: col, color };

        const winResult = this.checkWin(row, col, color);
        if (winResult) {
            this.winner = color;
            this.winningCells = winResult;
        } else if (this.isBoardFull()) {
            this.winner = 'draw';
        } else {
            this.turn = this.turn === 'red' ? 'yellow' : 'red';
        }

        return true;
    }

    isBoardFull() {
        return this.board[0].every(cell => cell !== null);
    }

    checkWin(r, c, color) {
        const directions = [
            [[0, 1], [0, -1]],   // Horizontal (—)
            [[1, 0], [-1, 0]],   // Vertical (|)
            [[1, 1], [-1, -1]],  // Diagonal ( \ )
            [[1, -1], [-1, 1]]   // Diagonal ( / )
        ];

        for (const [dir1, dir2] of directions) {
            const line = [{ r, c }];

            // Forward
            let nr = r + dir1[0];
            let nc = c + dir1[1];
            while (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols && this.board[nr][nc] === color) {
                line.push({ r: nr, c: nc });
                nr += dir1[0];
                nc += dir1[1];
            }

            // Backward
            nr = r + dir2[0];
            nc = c + dir2[1];
            while (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols && this.board[nr][nc] === color) {
                line.push({ r: nr, c: nc });
                nr += dir2[0];
                nc += dir2[1];
            }

            if (line.length >= 4) {
                return line;
            }
        }

        return null;
    }

    // Heuristic AI for Connect 4 (Minimax with Alpha-Beta Pruning, depth 4)
    getAIMove(aiColor = this.turn) {
        const opponentColor = aiColor === 'red' ? 'yellow' : 'red';
        const validCols = this.getValidColumns();
        if (validCols.length === 0) return null;

        // 1. Instant Win Check
        for (const c of validCols) {
            const r = this.getAvailableRow(c);
            this.board[r][c] = aiColor;
            const won = this.checkWin(r, c, aiColor);
            this.board[r][c] = null;
            if (won) return c;
        }

        // 2. Instant Block Check (block opponent from winning next turn)
        for (const c of validCols) {
            const r = this.getAvailableRow(c);
            this.board[r][c] = opponentColor;
            const oppWon = this.checkWin(r, c, opponentColor);
            this.board[r][c] = null;
            if (oppWon) return c;
        }

        // 3. Minimax evaluation
        let bestScore = -Infinity;
        let bestCol = validCols[Math.floor(validCols.length / 2)]; // default center
        
        // Prefer center columns ordering: [3, 2, 4, 1, 5, 0, 6]
        const orderPreference = [3, 2, 4, 1, 5, 0, 6].filter(c => validCols.includes(c));

        for (const c of orderPreference) {
            const r = this.getAvailableRow(c);
            this.board[r][c] = aiColor;
            const score = this.minimax(3, -Infinity, Infinity, false, aiColor, opponentColor);
            this.board[r][c] = null;

            if (score > bestScore) {
                bestScore = score;
                bestCol = c;
            }
        }

        return bestCol;
    }

    minimax(depth, alpha, beta, isMaximizing, aiColor, oppColor) {
        const validCols = this.getValidColumns();
        if (depth === 0 || validCols.length === 0) {
            return this.evaluateBoard(aiColor, oppColor);
        }

        if (isMaximizing) {
            let maxEval = -Infinity;
            for (const c of validCols) {
                const r = this.getAvailableRow(c);
                this.board[r][c] = aiColor;
                if (this.checkWin(r, c, aiColor)) {
                    this.board[r][c] = null;
                    return 10000 + depth;
                }
                const evaluation = this.minimax(depth - 1, alpha, beta, false, aiColor, oppColor);
                this.board[r][c] = null;
                maxEval = Math.max(maxEval, evaluation);
                alpha = Math.max(alpha, evaluation);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const c of validCols) {
                const r = this.getAvailableRow(c);
                this.board[r][c] = oppColor;
                if (this.checkWin(r, c, oppColor)) {
                    this.board[r][c] = null;
                    return -10000 - depth;
                }
                const evaluation = this.minimax(depth - 1, alpha, beta, true, aiColor, oppColor);
                this.board[r][c] = null;
                minEval = Math.min(minEval, evaluation);
                beta = Math.min(beta, evaluation);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    evaluateBoard(aiColor, oppColor) {
        let score = 0;
        // Center column control
        const centerCol = 3;
        for (let r = 0; r < this.rows; r++) {
            if (this.board[r][centerCol] === aiColor) score += 6;
            else if (this.board[r][centerCol] === oppColor) score -= 6;
        }

        // Evaluate 4-window spans
        const windows = this.getAllWindows();
        for (const window of windows) {
            score += this.evaluateWindow(window, aiColor, oppColor);
        }
        return score;
    }

    evaluateWindow(window, aiColor, oppColor) {
        let aiCount = 0;
        let oppCount = 0;
        let emptyCount = 0;

        for (const cell of window) {
            if (cell === aiColor) aiCount++;
            else if (cell === oppColor) oppCount++;
            else emptyCount++;
        }

        if (aiCount === 4) return 10000;
        if (aiCount === 3 && emptyCount === 1) return 100;
        if (aiCount === 2 && emptyCount === 2) return 10;

        if (oppCount === 3 && emptyCount === 1) return -120;
        if (oppCount === 2 && emptyCount === 2) return -15;

        return 0;
    }

    getAllWindows() {
        const windows = [];
        // Horizontal
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols - 3; c++) {
                windows.push([this.board[r][c], this.board[r][c+1], this.board[r][c+2], this.board[r][c+3]]);
            }
        }
        // Vertical
        for (let c = 0; c < this.cols; c++) {
            for (let r = 0; r < this.rows - 3; r++) {
                windows.push([this.board[r][c], this.board[r+1][c], this.board[r+2][c], this.board[r+3][c]]);
            }
        }
        // Diagonal \
        for (let r = 0; r < this.rows - 3; r++) {
            for (let c = 0; c < this.cols - 3; c++) {
                windows.push([this.board[r][c], this.board[r+1][c+1], this.board[r+2][c+2], this.board[r+3][c+3]]);
            }
        }
        // Diagonal /
        for (let r = 3; r < this.rows; r++) {
            for (let c = 0; c < this.cols - 3; c++) {
                windows.push([this.board[r][c], this.board[r-1][c+1], this.board[r-2][c+2], this.board[r-3][c+3]]);
            }
        }
        return windows;
    }
}

window.Connect4Engine = Connect4Engine;
