'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEngine(file, exportName) {
    const context = { window: {}, console };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', file), 'utf8'), context, { filename: file });
    return context.window[exportName];
}

const ChessEngine = loadEngine('chess.js', 'ChessEngine');
const XiangqiEngine = loadEngine('xiangqi.js', 'XiangqiEngine');
const ChineseCheckersEngine = loadEngine('checkers.js', 'ChineseCheckersEngine');
const BlokusEngine = loadEngine('blokus.js', 'BlokusEngine');

function chessCoreRules() {
    const mate = new ChessEngine();
    [[4, 6, 4, 4], [4, 1, 4, 3], [3, 7, 7, 3], [1, 0, 2, 2], [5, 7, 2, 4], [6, 0, 5, 2], [7, 3, 5, 1]]
        .forEach(move => assert.strictEqual(mate.makeMove(...move), true));
    assert.strictEqual(mate.winner, 'white', 'Scholar\'s mate must finish as checkmate');

    const castle = new ChessEngine();
    castle.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    castle.board[7][4] = { type: 'k', color: 'white', symbol: '♔' };
    castle.board[7][7] = { type: 'r', color: 'white', symbol: '♖' };
    castle.board[0][4] = { type: 'k', color: 'black', symbol: '♚' };
    castle.turn = 'white';
    castle.winner = null;
    castle.castlingRights = { white: { kingSide: true, queenSide: false }, black: { kingSide: false, queenSide: false } };
    assert.strictEqual(castle.makeMove(4, 7, 6, 7), true, 'Kingside castling must be legal when clear');
    assert.strictEqual(castle.board[7][5]?.type, 'r', 'Castling must move the rook too');

    const passant = new ChessEngine();
    [[4, 6, 4, 4], [0, 1, 0, 2], [4, 4, 4, 3], [3, 1, 3, 3], [4, 3, 3, 2]]
        .forEach(move => assert.strictEqual(passant.makeMove(...move), true));
    assert.strictEqual(passant.board[3][3], null, 'En passant must remove the pawn that passed');
}

function xiangqiKingSafety() {
    const game = new XiangqiEngine();
    game.board = Array.from({ length: 10 }, () => Array(9).fill(null));
    game.board[0][4] = { type: 'k', color: 'black', text: '將' };
    game.board[9][4] = { type: 'k', color: 'red', text: '帥' };
    game.board[5][4] = { type: 'r', color: 'red', text: '俥' };
    game.turn = 'red';
    game.winner = null;
    assert.strictEqual(game.makeMove(4, 5, 3, 5), false, 'A move may not expose flying generals');
    assert.strictEqual(game.board[5][4]?.type, 'r');
}

function variablePlayerRooms() {
    const threePlayer = new ChineseCheckersEngine(3);
    const joiningCheckers = new ChineseCheckersEngine(2);
    joiningCheckers.loadState({ playerCount: 3, board: threePlayer.board, turn: 'blue' });
    assert.strictEqual(Array.from(joiningCheckers.players).join(','), 'red,green,blue');
    assert.strictEqual(joiningCheckers.turn, 'blue');

    const fourPlayer = new BlokusEngine(4);
    const joiningBlokus = new BlokusEngine(2);
    joiningBlokus.loadState({
        playerCount: 4,
        board: fourPlayer.board,
        playerPieces: fourPlayer.playerPieces,
        turn: 'green',
        scores: fourPlayer.scores,
        passedPlayers: ['blue']
    });
    assert.strictEqual(Array.from(joiningBlokus.players).join(','), 'blue,yellow,red,green');
    assert.strictEqual(joiningBlokus.turn, 'green');
    assert.strictEqual(joiningBlokus.passedPlayers.has('blue'), true);
}

chessCoreRules();
xiangqiKingSafety();
variablePlayerRooms();
console.log('core rules: OK');
