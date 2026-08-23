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
        this.castlingRights = null;
        this.enPassantTarget = null;
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
        this.castlingRights = {
            white: { kingSide: true, queenSide: true },
            black: { kingSide: true, queenSide: true }
        };
        this.enPassantTarget = null;
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
        if (state.castlingRights) this.castlingRights = state.castlingRights;
        this.enPassantTarget = state.enPassantTarget || null;
    }

    getPiece(x, y) {
        if (x < 0 || x >= 8 || y < 0 || y >= 8) return null;
        return this.board[y][x];
    }

    getPseudoMovesForPiece(x, y, includeSpecial = true) {
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
                // Kings are never captured in chess; checkmate ends the game.
                if (target.type !== 'k' || !includeSpecial) moves.push({ x: tx, y: ty, captured: target });
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
                        if (target && target.color !== color && target.type !== 'k') {
                            moves.push({ x: nx, y: ny, captured: target });
                        }
                    }
                }

                // En passant: move to the passed square and remove the pawn
                // that just advanced two squares beside this pawn.
                if (includeSpecial && this.enPassantTarget && this.enPassantTarget.capturableBy === color) {
                    const target = this.enPassantTarget;
                    if (Math.abs(target.x - x) === 1 && target.y === y + dir && !this.getPiece(target.x, target.y)) {
                        const capturedPawn = this.getPiece(target.x, y);
                        if (capturedPawn?.type === 'p' && capturedPawn.color !== color) {
                            moves.push({ x: target.x, y: target.y, captured: capturedPawn, enPassant: true });
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
                            if (target.color !== color && (target.type !== 'k' || !includeSpecial)) {
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
                            if (target.color !== color && (target.type !== 'k' || !includeSpecial)) {
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
                            if (target.color !== color && (target.type !== 'k' || !includeSpecial)) {
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
                if (includeSpecial && !this.isInCheck(color)) {
                    const homeY = color === 'white' ? 7 : 0;
                    const rights = this.castlingRights?.[color];
                    if (x === 4 && y === homeY && rights?.kingSide &&
                        !this.getPiece(5, homeY) && !this.getPiece(6, homeY) &&
                        this.getPiece(7, homeY)?.type === 'r' && this.getPiece(7, homeY)?.color === color &&
                        !this.isSquareAttacked(5, homeY, color === 'white' ? 'black' : 'white') &&
                        !this.isSquareAttacked(6, homeY, color === 'white' ? 'black' : 'white')) {
                        moves.push({ x: 6, y: homeY, captured: null, castle: 'kingSide' });
                    }
                    if (x === 4 && y === homeY && rights?.queenSide &&
                        !this.getPiece(1, homeY) && !this.getPiece(2, homeY) && !this.getPiece(3, homeY) &&
                        this.getPiece(0, homeY)?.type === 'r' && this.getPiece(0, homeY)?.color === color &&
                        !this.isSquareAttacked(3, homeY, color === 'white' ? 'black' : 'white') &&
                        !this.isSquareAttacked(2, homeY, color === 'white' ? 'black' : 'white')) {
                        moves.push({ x: 2, y: homeY, captured: null, castle: 'queenSide' });
                    }
                }
                break;
            }
        }

        return moves;
    }

    isSquareAttacked(targetX, targetY, byColor) {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.getPiece(x, y);
                if (!piece || piece.color !== byColor) continue;
                if (piece.type === 'p') {
                    const dir = byColor === 'white' ? -1 : 1;
                    if (y + dir === targetY && Math.abs(x - targetX) === 1) return true;
                    continue;
                }
                if (piece.type === 'k') {
                    if (Math.max(Math.abs(x - targetX), Math.abs(y - targetY)) === 1) return true;
                    continue;
                }
                if (this.getPseudoMovesForPiece(x, y, false).some(move => move.x === targetX && move.y === targetY)) return true;
            }
        }
        return false;
    }

    isInCheck(color) {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.getPiece(x, y);
                if (piece?.type === 'k' && piece.color === color) {
                    return this.isSquareAttacked(x, y, color === 'white' ? 'black' : 'white');
                }
            }
        }
        return true;
    }

    wouldLeaveKingInCheck(fx, fy, move) {
        const piece = this.getPiece(fx, fy);
        const target = this.getPiece(move.x, move.y);
        const color = piece.color;
        let enPassantPawn = null;
        let rook = null;
        let rookFrom = null;
        let rookTo = null;

        this.board[move.y][move.x] = piece;
        this.board[fy][fx] = null;
        if (move.enPassant) {
            enPassantPawn = this.getPiece(move.x, fy);
            this.board[fy][move.x] = null;
        }
        if (move.castle) {
            const rookX = move.castle === 'kingSide' ? 7 : 0;
            const newRookX = move.castle === 'kingSide' ? 5 : 3;
            rook = this.getPiece(rookX, fy);
            rookFrom = rookX;
            rookTo = newRookX;
            this.board[fy][newRookX] = rook;
            this.board[fy][rookX] = null;
        }
        const unsafe = this.isInCheck(color);
        this.board[fy][fx] = piece;
        this.board[move.y][move.x] = target;
        if (move.enPassant) this.board[fy][move.x] = enPassantPawn;
        if (rook) {
            this.board[fy][rookFrom] = rook;
            this.board[fy][rookTo] = null;
        }
        return unsafe;
    }

    getValidMovesForPiece(x, y) {
        const piece = this.getPiece(x, y);
        if (!piece) return [];
        return this.getPseudoMovesForPiece(x, y).filter(move => !this.wouldLeaveKingInCheck(x, y, move));
    }

    hasAnyLegalMoves(color) {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.getPiece(x, y);
                if (piece?.color === color && this.getValidMovesForPiece(x, y).length) return true;
            }
        }
        return false;
    }

    makeMove(fx, fy, tx, ty) {
        if (this.winner) return false;
        const piece = this.getPiece(fx, fy);
        if (!piece || piece.color !== this.turn) return false;

        const validMoves = this.getValidMovesForPiece(fx, fy);
        const valid = validMoves.find(m => m.x === tx && m.y === ty);
        if (!valid) return false;

        let target = this.getPiece(tx, ty);
        if (valid.enPassant) {
            target = this.getPiece(tx, fy);
            this.board[fy][tx] = null;
        }
        if (target) this.capturedPieces[this.turn].push(target);

        const disableRookRight = (color, x, y) => {
            const homeY = color === 'white' ? 7 : 0;
            if (y !== homeY || !this.castlingRights?.[color]) return;
            if (x === 0) this.castlingRights[color].queenSide = false;
            if (x === 7) this.castlingRights[color].kingSide = false;
        };
        if (piece.type === 'k') {
            this.castlingRights[piece.color].kingSide = false;
            this.castlingRights[piece.color].queenSide = false;
        }
        if (piece.type === 'r') disableRookRight(piece.color, fx, fy);
        if (target?.type === 'r') disableRookRight(target.color, tx, ty);

        // Handle Pawn Promotion (auto Queen)
        if (piece.type === 'p' && (ty === 0 || ty === 7)) {
            piece.type = 'q';
            piece.symbol = piece.color === 'white' ? '♕' : '♛';
        }

        this.board[ty][tx] = piece;
        this.board[fy][fx] = null;
        if (valid.castle) {
            const rookFrom = valid.castle === 'kingSide' ? 7 : 0;
            const rookTo = valid.castle === 'kingSide' ? 5 : 3;
            this.board[fy][rookTo] = this.board[fy][rookFrom];
            this.board[fy][rookFrom] = null;
        }
        this.enPassantTarget = null;
        if (piece.type === 'p' && Math.abs(ty - fy) === 2) {
            this.enPassantTarget = {
                x: fx,
                y: (fy + ty) / 2,
                capturableBy: piece.color === 'white' ? 'black' : 'white'
            };
        }
        this.lastMove = { from: { x: fx, y: fy }, to: { x: tx, y: ty }, piece, captured: target, castle: valid.castle || null, enPassant: Boolean(valid.enPassant) };
        this.selectedPiece = null;

        const nextColor = this.turn === 'white' ? 'black' : 'white';
        if (!this.hasAnyLegalMoves(nextColor)) this.winner = this.isInCheck(nextColor) ? this.turn : 'draw';
        else this.turn = nextColor;

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
