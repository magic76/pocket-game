// Ultimate Tic-Tac-Toe (終極井字棋 / 超級九宮格) Engine & AI Solver
class UltimateTicTacToeEngine {
    constructor() {
        this.subBoards = [];  // [3][3][3][3] -> null | 'X' | 'O'
        this.mainBoard = [];  // [3][3] -> null | 'X' | 'O' | 'draw'
        this.activeBoard = null; // { mainR, mainC } or null (Free Move)
        this.turn = 'X';      // 'X' (P1, Red/Cyan) | 'O' (P2, Blue/Orange)
        this.winner = null;   // null | 'X' | 'O' | 'draw'
        this.winningLine = [];// [{mainR, mainC}, ...]
        this.lastMove = null; // { mainR, mainC, subR, subC, player }
        this.init();
    }

    init() {
        this.subBoards = Array.from({ length: 3 }, () =>
            Array.from({ length: 3 }, () =>
                Array.from({ length: 3 }, () => Array(3).fill(null))
            )
        );
        this.mainBoard = Array.from({ length: 3 }, () => Array(3).fill(null));
        this.activeBoard = null;
        this.turn = 'X';
        this.winner = null;
        this.winningLine = [];
        this.lastMove = null;
    }

    reset() {
        this.init();
    }

    loadState(state) {
        if (!state) return;
        if (state.subBoards) this.subBoards = state.subBoards;
        if (state.mainBoard) this.mainBoard = state.mainBoard;
        if (state.activeBoard !== undefined) this.activeBoard = state.activeBoard;
        if (state.turn) this.turn = state.turn;
        if (state.winner !== undefined) this.winner = state.winner;
        if (state.winningLine) this.winningLine = state.winningLine;
        if (state.lastMove) this.lastMove = state.lastMove;
    }

    isValidMove(mainR, mainC, subR, subC) {
        if (this.winner) return false;
        // Big board already resolved
        if (this.mainBoard[mainR][mainC] !== null) return false;
        // Must play in active board if specified
        if (this.activeBoard !== null) {
            if (this.activeBoard.mainR !== mainR || this.activeBoard.mainC !== mainC) {
                return false;
            }
        }
        // Sub-cell already occupied
        if (this.subBoards[mainR][mainC][subR][subC] !== null) return false;
        return true;
    }

    getValidMoves() {
        if (this.winner) return [];
        const moves = [];

        for (let mr = 0; mr < 3; mr++) {
            for (let mc = 0; mc < 3; mc++) {
                if (this.mainBoard[mr][mc] !== null) continue;
                if (this.activeBoard !== null && (this.activeBoard.mainR !== mr || this.activeBoard.mainC !== mc)) {
                    continue;
                }

                for (let sr = 0; sr < 3; sr++) {
                    for (let sc = 0; sc < 3; sc++) {
                        if (this.subBoards[mr][mc][sr][sc] === null) {
                            moves.push({ mainR: mr, mainC: mc, subR: sr, subC: sc });
                        }
                    }
                }
            }
        }
        return moves;
    }

    makeMove(mainR, mainC, subR, subC) {
        if (!this.isValidMove(mainR, mainC, subR, subC)) return false;

        const player = this.turn;
        this.subBoards[mainR][mainC][subR][subC] = player;
        this.lastMove = { mainR, mainC, subR, subC, player };

        // 1. Check if this sub-board was won or drawn
        const subWin = this.check3x3Win(this.subBoards[mainR][mainC], player);
        if (subWin) {
            this.mainBoard[mainR][mainC] = player;
        } else if (this.isSubBoardFull(this.subBoards[mainR][mainC])) {
            this.mainBoard[mainR][mainC] = 'draw';
        }

        // 2. Check if the overall game was won
        const mainWin = this.check3x3Win(this.mainBoard, player);
        if (mainWin) {
            this.winner = player;
            this.winningLine = mainWin;
        } else if (this.isMainBoardFull()) {
            this.winner = 'draw';
        } else {
            // 3. Determine next active board
            const nextTargetResolved = this.mainBoard[subR][subC] !== null;
            if (nextTargetResolved) {
                this.activeBoard = null; // Free move anywhere on unfinished boards
            } else {
                this.activeBoard = { mainR: subR, mainC: subC };
            }
            this.turn = this.turn === 'X' ? 'O' : 'X';
        }

        return true;
    }

    check3x3Win(grid, player) {
        // Rows
        for (let r = 0; r < 3; r++) {
            if (grid[r][0] === player && grid[r][1] === player && grid[r][2] === player) {
                return [{ r, c: 0 }, { r, c: 1 }, { r, c: 2 }];
            }
        }
        // Cols
        for (let c = 0; c < 3; c++) {
            if (grid[0][c] === player && grid[1][c] === player && grid[2][c] === player) {
                return [{ r: 0, c }, { r: 1, c }, { r: 2, c }];
            }
        }
        // Diagonals
        if (grid[0][0] === player && grid[1][1] === player && grid[2][2] === player) {
            return [{ r: 0, c: 0 }, { r: 1, c: 1 }, { r: 2, c: 2 }];
        }
        if (grid[0][2] === player && grid[1][1] === player && grid[2][0] === player) {
            return [{ r: 0, c: 2 }, { r: 1, c: 1 }, { r: 2, c: 0 }];
        }
        return null;
    }

    isSubBoardFull(grid) {
        return grid.every(row => row.every(cell => cell !== null));
    }

    isMainBoardFull() {
        return this.mainBoard.every(row => row.every(cell => cell !== null));
    }

    // Heuristic AI for Ultimate Tic-Tac-Toe
    getAIMove(aiPlayer = this.turn) {
        const validMoves = this.getValidMoves();
        if (validMoves.length === 0) return null;

        const oppPlayer = aiPlayer === 'X' ? 'O' : 'X';

        // Evaluate candidate moves with heuristic scoring
        const scoredMoves = validMoves.map(m => {
            let score = 0;

            // 1. Check if this move wins the local sub-board
            const subGrid = this.subBoards[m.mainR][m.mainC];
            subGrid[m.subR][m.subC] = aiPlayer;
            const wonSub = this.check3x3Win(subGrid, aiPlayer);
            subGrid[m.subR][m.subC] = null;

            if (wonSub) {
                score += 150;
                // Check if winning this sub-board wins the whole game!
                this.mainBoard[m.mainR][m.mainC] = aiPlayer;
                const wonMain = this.check3x3Win(this.mainBoard, aiPlayer);
                this.mainBoard[m.mainR][m.mainC] = null;
                if (wonMain) score += 5000;
            }

            // 2. Check if this move blocks opponent from winning local sub-board
            subGrid[m.subR][m.subC] = oppPlayer;
            const oppWonSub = this.check3x3Win(subGrid, oppPlayer);
            subGrid[m.subR][m.subC] = null;
            if (oppWonSub) score += 100;

            // 3. Center and corner bonuses for sub-board
            if (m.subR === 1 && m.subC === 1) score += 20; // Center
            else if ((m.subR === 0 || m.subR === 2) && (m.subC === 0 || m.subC === 2)) score += 12; // Corners

            // 4. Center and corner bonuses for main board
            if (m.mainR === 1 && m.mainC === 1) score += 25;
            else if ((m.mainR === 0 || m.mainR === 2) && (m.mainC === 0 || m.mainC === 2)) score += 15;

            // 5. Evaluate where this sends the opponent
            const nextSubWon = this.mainBoard[m.subR][m.subC] !== null;
            if (nextSubWon) {
                // Gives opponent a free move! Slight penalty
                score -= 35;
            } else {
                // Check if opponent could win the board we send them to
                const targetSubGrid = this.subBoards[m.subR][m.subC];
                let oppCanWinTarget = false;
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 3; c++) {
                        if (targetSubGrid[r][c] === null) {
                            targetSubGrid[r][c] = oppPlayer;
                            if (this.check3x3Win(targetSubGrid, oppPlayer)) oppCanWinTarget = true;
                            targetSubGrid[r][c] = null;
                        }
                    }
                }
                if (oppCanWinTarget) score -= 60;
            }

            return { move: m, score: score + Math.random() * 5 };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0].move;
    }
}

window.UltimateTicTacToeEngine = UltimateTicTacToeEngine;
