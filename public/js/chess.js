// Western Chess (西洋棋 / Chess) Game Engine & AI
class ChessEngine {
    constructor() {
        this.size = 8;
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.turn = 'white'; // 'white' moves first
        this.winner = null;
        this.lastMove = null;
        this.selectedPiece = null;
        this.capturedPieces = { white: [], black: [] };
        this.init();
    }

    init() {
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));

        // Black pieces (Top, row 0-1)
        const blackOrder = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
        const unicodeBlack = { r: '♜', n: '♞', b: '♝', q: '♛', k: '♚', p: '♟' };
        for (let x = 0; x < 8; x++) {
            this.board[0][x] = { type: blackOrder[x], color: 'black', symbol: unicodeBlack[blackOrder[x]] };
            this.board[1][x] = { type: 'p', color: 'black', symbol: unicodeBlack['p'] };
        }

        // White pieces (Bottom, row 6-7)
        const whiteOrder = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
        const unicodeWhite = { r: '♖', n: '♘', b: '♗', q: '♕', k: '♔', p: '♙' };
        for (let x = 0; x < 8; x++) {
            this.board[6][x] = { type: 'p', color: 'white', symbol: unicodeWhite['p'] };
            this.board[7][x] = { type: whiteOrder[x], color: 'white', symbol: unicodeWhite[whiteOrder[x]] };
        }

        this.turn = 'white';
        this.winner = null;
        this.lastMove = null;
        this.selectedPiece = null;
        this.capturedPieces = { white: [], black: [] };
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
        if (state.capturedPieces) this.capturedPieces = state.capturedPieces;
    }

    getPiece(x, y) {
        if (x < 0 || x >= 8 || y < 0 || y >= 8) return null;
        return this.board[y][x];
    }

    getValidMovesForPiece(x, y) {
        const piece = this.getPiece(x, y);
        if (!piece) return [];
        const moves = [];
        const color = piece.color;
        const isWhite = color === 'white';

        const addIfValid = (tx, ty) => {
            if (tx < 0 || tx >= 8 || ty < 0 || ty >= 8) return false;
            const target = this.getPiece(tx, ty);
            if (!target) {
                moves.push({ x: tx, y: ty, captured: null });
                return true;
            } else if (target.color !== color) {
                moves.push({ x: tx, y: ty, captured: target });
                return false;
            }
            return false;
        };

        switch (piece.type) {
            // Pawn (兵)
            case 'p': {
                const dir = isWhite ? -1 : 1;
                const startRow = isWhite ? 6 : 1;

                // 1 step forward
                if (this.getPiece(x, y + dir) === null) {
                    moves.push({ x, y: y + dir, captured: null });
                    // 2 steps forward on first move
                    if (y === startRow && this.getPiece(x, y + dir * 2) === null) {
                        moves.push({ x, y: y + dir * 2, captured: null });
                    }
                }

                // Diagonal captures
                for (const dx of [-1, 1]) {
                    const nx = x + dx;
                    const ny = y + dir;
                    if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
                        const target = this.getPiece(nx, ny);
                        if (target && target.color !== color) {
                            moves.push({ x: nx, y: ny, captured: target });
                        }
                    }
                }
                break;
            }

            // Knight (騎士)
            case 'n': {
                const jumps = [
                    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
                    [1, -2], [1, 2], [2, -1], [2, 1]
                ];
                for (const [dx, dy] of jumps) {
                    addIfValid(x + dx, y + dy);
                }
                break;
            }

            // Bishop (主教)
            case 'b': {
                const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
                for (const [dx, dy] of dirs) {
                    let step = 1;
                    while (true) {
                        const nx = x + dx * step;
                        const ny = y + dy * step;
                        if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) break;
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

            // Rook (城堡)
            case 'r': {
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for (const [dx, dy] of dirs) {
                    let step = 1;
                    while (true) {
                        const nx = x + dx * step;
                        const ny = y + dy * step;
                        if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) break;
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

            // Queen (皇后)
            case 'q': {
                const dirs = [
                    [0, -1], [0, 1], [-1, 0], [1, 0],
                    [-1, -1], [1, -1], [-1, 1], [1, 1]
                ];
                for (const [dx, dy] of dirs) {
                    let step = 1;
                    while (true) {
                        const nx = x + dx * step;
                        const ny = y + dy * step;
                        if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) break;
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

            // King (國王)
            case 'k': {
                const dirs = [
                    [0, -1], [0, 1], [-1, 0], [1, 0],
                    [-1, -1], [1, -1], [-1, 1], [1, 1]
                ];
                for (const [dx, dy] of dirs) {
                    addIfValid(x + dx, y + dy);
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

        // Handle Pawn Promotion (auto Queen)
        if (piece.type === 'p' && (ty === 0 || ty === 7)) {
            piece.type = 'q';
            piece.symbol = piece.color === 'white' ? '♕' : '♛';
        }

        this.board[ty][tx] = piece;
        this.board[fy][fx] = null;
        this.lastMove = { from: { x: fx, y: fy }, to: { x: tx, y: ty }, piece, captured: target };
        this.selectedPiece = null;

        if (!this.winner) {
            this.turn = this.turn === 'white' ? 'black' : 'white';
        }

        return true;
    }

    // Heuristic AI for Western Chess
    getAIMove(aiColor = 'black') {
        const pieceValues = { k: 10000, q: 900, r: 500, b: 330, n: 320, p: 100 };
        const moves = [];

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.getPiece(x, y);
                if (piece && piece.color === aiColor) {
                    const validMoves = this.getValidMovesForPiece(x, y);
                    for (const m of validMoves) {
                        let score = 0;
                        if (m.captured) {
                            score += pieceValues[m.captured.type] * 10;
                            if (m.captured.type === 'k') score += 100000;
                        }
                        // Center control bonus
                        const centerDist = Math.abs(3.5 - m.x) + Math.abs(3.5 - m.y);
                        score += (7 - centerDist) * 3;

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

window.ChessEngine = ChessEngine;
