// Chinese Chess (中國象棋 / Xiangqi) Game Engine & AI
class XiangqiEngine {
    constructor() {
        this.cols = 9;
        this.rows = 10;
        this.board = Array(10).fill(null).map(() => Array(9).fill(null));
        this.turn = 'red'; // 'red' moves first (Red is at bottom rows 7-9, Black at top rows 0-2)
        this.winner = null;
        this.lastMove = null;
        this.selectedPiece = null;
        this.capturedPieces = { red: [], black: [] };
        this.init();
    }

    init() {
        this.board = Array(10).fill(null).map(() => Array(9).fill(null));
        
        // Initial setup for Black (Top, rows 0-4)
        this.board[0][0] = { type: 'r', color: 'black', text: '車' };
        this.board[0][1] = { type: 'n', color: 'black', text: '馬' };
        this.board[0][2] = { type: 'b', color: 'black', text: '象' };
        this.board[0][3] = { type: 'a', color: 'black', text: '士' };
        this.board[0][4] = { type: 'k', color: 'black', text: '將' };
        this.board[0][5] = { type: 'a', color: 'black', text: '士' };
        this.board[0][6] = { type: 'b', color: 'black', text: '象' };
        this.board[0][7] = { type: 'n', color: 'black', text: '馬' };
        this.board[0][8] = { type: 'r', color: 'black', text: '車' };
        this.board[2][1] = { type: 'c', color: 'black', text: '炮' };
        this.board[2][7] = { type: 'c', color: 'black', text: '炮' };
        this.board[3][0] = { type: 'p', color: 'black', text: '卒' };
        this.board[3][2] = { type: 'p', color: 'black', text: '卒' };
        this.board[3][4] = { type: 'p', color: 'black', text: '卒' };
        this.board[3][6] = { type: 'p', color: 'black', text: '卒' };
        this.board[3][8] = { type: 'p', color: 'black', text: '卒' };

        // Initial setup for Red (Bottom, rows 5-9)
        this.board[9][0] = { type: 'r', color: 'red', text: '俥' };
        this.board[9][1] = { type: 'n', color: 'red', text: '傌' };
        this.board[9][2] = { type: 'b', color: 'red', text: '相' };
        this.board[9][3] = { type: 'a', color: 'red', text: '仕' };
        this.board[9][4] = { type: 'k', color: 'red', text: '帥' };
        this.board[9][5] = { type: 'a', color: 'red', text: '仕' };
        this.board[9][6] = { type: 'b', color: 'red', text: '相' };
        this.board[9][7] = { type: 'n', color: 'red', text: '傌' };
        this.board[9][8] = { type: 'r', color: 'red', text: '俥' };
        this.board[7][1] = { type: 'c', color: 'red', text: '砲' };
        this.board[7][7] = { type: 'c', color: 'red', text: '砲' };
        this.board[6][0] = { type: 'p', color: 'red', text: '兵' };
        this.board[6][2] = { type: 'p', color: 'red', text: '兵' };
        this.board[6][4] = { type: 'p', color: 'red', text: '兵' };
        this.board[6][6] = { type: 'p', color: 'red', text: '兵' };
        this.board[6][8] = { type: 'p', color: 'red', text: '兵' };

        this.turn = 'red';
        this.winner = null;
        this.lastMove = null;
        this.selectedPiece = null;
        this.capturedPieces = { red: [], black: [] };
    }

    reset() {
        this.init();
    }

    loadState(state) {
        if (!state) return;
        if (state.board) this.board = state.board;
        if (state.turn) {
            // Map server black/white to xiangqi black/red
            this.turn = state.turn === 'white' ? 'black' : state.turn === 'black' ? 'red' : state.turn;
        }
        if (state.winner !== undefined) {
            this.winner = state.winner === 'white' ? 'black' : state.winner === 'black' ? 'red' : state.winner;
        }
        if (state.lastMove) this.lastMove = state.lastMove;
        if (state.capturedPieces) this.capturedPieces = state.capturedPieces;
    }

    getPiece(x, y) {
        if (x < 0 || x >= 9 || y < 0 || y >= 10) return null;
        return this.board[y][x];
    }

    getValidMovesForPiece(x, y) {
        const piece = this.getPiece(x, y);
        if (!piece) return [];
        const moves = [];
        const color = piece.color;
        const isRed = color === 'red';

        const addIfValid = (tx, ty) => {
            if (tx < 0 || tx >= 9 || ty < 0 || ty >= 10) return false;
            const target = this.getPiece(tx, ty);
            if (!target) {
                moves.push({ x: tx, y: ty, captured: null });
                return true;
            } else if (target.color !== color) {
                moves.push({ x: tx, y: ty, captured: target });
                return false; // hit enemy
            }
            return false; // hit friend
        };

        switch (piece.type) {
            // 帥 / 將 (General / King)
            case 'k': {
                const minRow = isRed ? 7 : 0;
                const maxRow = isRed ? 9 : 2;
                const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                for (const [dx, dy] of dirs) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 3 && nx <= 5 && ny >= minRow && ny <= maxRow) {
                        addIfValid(nx, ny);
                    }
                }
                // Check Flying General (將帥照面)
                const forward = isRed ? -1 : 1;
                let cy = y + forward;
                while (cy >= 0 && cy < 10) {
                    const p = this.getPiece(x, cy);
                    if (p) {
                        if (p.type === 'k' && p.color !== color) {
                            moves.push({ x, y: cy, captured: p });
                        }
                        break;
                    }
                    cy += forward;
                }
                break;
            }

            // 仕 / 士 (Advisor)
            case 'a': {
                const minRow = isRed ? 7 : 0;
                const maxRow = isRed ? 9 : 2;
                const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
                for (const [dx, dy] of diag) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 3 && nx <= 5 && ny >= minRow && ny <= maxRow) {
                        addIfValid(nx, ny);
                    }
                }
                break;
            }

            // 相 / 象 (Elephant)
            case 'b': {
                const diag = [
                    { dx: 2, dy: 2, ex: 1, ey: 1 },
                    { dx: 2, dy: -2, ex: 1, ey: -1 },
                    { dx: -2, dy: 2, ex: -1, ey: 1 },
                    { dx: -2, dy: -2, ex: -1, ey: -1 }
                ];
                for (const { dx, dy, ex, ey } of diag) {
                    const nx = x + dx;
                    const ny = y + dy;
                    // Elephant cannot cross river
                    if (isRed && ny < 5) continue;
                    if (!isRed && ny > 4) continue;
                    if (nx < 0 || nx >= 9 || ny < 0 || ny >= 10) continue;

                    // Check Elephant Eye Block (塞象眼)
                    if (this.getPiece(x + ex, y + ey) === null) {
                        addIfValid(nx, ny);
                    }
                }
                break;
            }

            // 俥 / 車 (Chariot)
            case 'r': {
                const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                for (const [dx, dy] of dirs) {
                    let step = 1;
                    while (true) {
                        const nx = x + dx * step;
                        const ny = y + dy * step;
                        if (nx < 0 || nx >= 9 || ny < 0 || ny >= 10) break;
                        const target = this.getPiece(nx, ny);
                        if (!target) {
                            moves.push({ x: nx, y: ny, captured: null });
                        } else {
                            if (target.color !== color) {
                                moves.push({ x: nx, y: ny, captured: target });
                            }
                            break;
                        }
                        step++;
                    }
                }
                break;
            }

            // 傌 / 馬 (Horse)
            case 'n': {
                const jumps = [
                    { dx: 1, dy: 2, bx: 0, by: 1 },
                    { dx: -1, dy: 2, bx: 0, by: 1 },
                    { dx: 1, dy: -2, bx: 0, by: -1 },
                    { dx: -1, dy: -2, bx: 0, by: -1 },
                    { dx: 2, dy: 1, bx: 1, by: 0 },
                    { dx: 2, dy: -1, bx: 1, by: 0 },
                    { dx: -2, dy: 1, bx: -1, by: 0 },
                    { dx: -2, dy: -1, bx: -1, by: 0 }
                ];
                for (const { dx, dy, bx, by } of jumps) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= 9 || ny < 0 || ny >= 10) continue;
                    // Check Horse Leg Block (蹩馬腿)
                    if (this.getPiece(x + bx, y + by) === null) {
                        addIfValid(nx, ny);
                    }
                }
                break;
            }

            // 砲 / 炮 (Cannon)
            case 'c': {
                const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                for (const [dx, dy] of dirs) {
                    let step = 1;
                    let jumped = false;
                    while (true) {
                        const nx = x + dx * step;
                        const ny = y + dy * step;
                        if (nx < 0 || nx >= 9 || ny < 0 || ny >= 10) break;
                        const target = this.getPiece(nx, ny);
                        if (!jumped) {
                            if (!target) {
                                moves.push({ x: nx, y: ny, captured: null });
                            } else {
                                jumped = true; // Found screen/mount
                            }
                        } else {
                            if (target) {
                                if (target.color !== color) {
                                    moves.push({ x: nx, y: ny, captured: target });
                                }
                                break;
                            }
                        }
                        step++;
                    }
                }
                break;
            }

            // 兵 / 卒 (Pawn / Soldier)
            case 'p': {
                const forwardY = isRed ? y - 1 : y + 1;
                const crossedRiver = isRed ? y <= 4 : y >= 5;

                // Move forward
                if (forwardY >= 0 && forwardY < 10) {
                    addIfValid(x, forwardY);
                }

                // After crossing river, can move left and right
                if (crossedRiver) {
                    if (x - 1 >= 0) addIfValid(x - 1, y);
                    if (x + 1 < 9) addIfValid(x + 1, y);
                }
                break;
            }
        }

        return moves;
    }

    makeMove(fx, fy, tx, ty) {
        if (this.winner) return false;
        const piece = this.getPiece(fx, fy);
        if (!piece || piece.color !== this.turn) return false;

        const validMoves = this.getValidMovesForPiece(fx, fy);
        const valid = validMoves.find(m => m.x === tx && m.y === ty);
        if (!valid) return false;

        const target = this.getPiece(tx, ty);
        if (target) {
            if (target.type === 'k') {
                this.winner = this.turn;
            }
            this.capturedPieces[this.turn].push(target);
        }

        this.board[ty][tx] = piece;
        this.board[fy][fx] = null;
        this.lastMove = { from: { x: fx, y: fy }, to: { x: tx, y: ty }, piece, captured: target };
        this.selectedPiece = null;

        if (!this.winner) {
            this.turn = this.turn === 'red' ? 'black' : 'red';
        }

        return true;
    }

    // Heuristic AI for single player
    getAIMove(aiColor = 'black') {
        const pieceValues = { k: 10000, r: 900, c: 450, n: 400, b: 200, a: 200, p: 100 };
        const moves = [];

        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 9; x++) {
                const piece = this.getPiece(x, y);
                if (piece && piece.color === aiColor) {
                    const validMoves = this.getValidMovesForPiece(x, y);
                    for (const m of validMoves) {
                        let score = 0;
                        if (m.captured) {
                            score += pieceValues[m.captured.type] * 10;
                            // Win instant bonus
                            if (m.captured.type === 'k') score += 100000;
                        }
                        // Advance pawns bonus
                        if (piece.type === 'p') {
                            score += (aiColor === 'black' ? m.y : (9 - m.y)) * 5;
                        }
                        // Center control bonus
                        score += (4 - Math.abs(4 - m.x)) * 2;
                        moves.push({ from: { x, y }, to: { x: m.x, y: m.y }, score });
                    }
                }
            }
        }

        if (moves.length === 0) return null;

        moves.sort((a, b) => b.score - a.score);
        const topMoves = moves.filter(m => m.score === moves[0].score);
        return topMoves[Math.floor(Math.random() * topMoves.length)];
    }
}

window.XiangqiEngine = XiangqiEngine;
