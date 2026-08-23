'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');

const ROOT = path.resolve(__dirname, '..');

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function startTestServer() {
    return new Promise((resolve, reject) => {
        const server = spawn(process.execPath, ['server.js'], {
            cwd: ROOT,
            env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        const timeout = setTimeout(() => reject(new Error(`Test server start timed out: ${output}`)), 5000);
        const onData = chunk => {
            output += chunk.toString();
            const match = output.match(/連接埠:\s*(\d+)/);
            if (match) {
                clearTimeout(timeout);
                resolve({ server, port: Number(match[1]) });
            }
        };
        server.stdout.on('data', onData);
        server.stderr.on('data', chunk => { output += chunk.toString(); });
        server.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        server.once('exit', code => {
            if (!output.match(/連接埠:\s*(\d+)/)) {
                clearTimeout(timeout);
                reject(new Error(`Test server exited early (${code}): ${output}`));
            }
        });
    });
}

function connect(port) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const queue = [];
        const waiters = [];
        const dispatch = message => {
            queue.push(message);
            for (let index = 0; index < waiters.length; index++) {
                const waiter = waiters[index];
                if (!waiter.predicate(message)) continue;
                waiters.splice(index, 1);
                clearTimeout(waiter.timer);
                waiter.resolve(message);
                break;
            }
        };
        ws.on('open', () => resolve({
            ws,
            send: data => ws.send(JSON.stringify(data)),
            waitFor(predicate, timeout = 3000) {
                const queued = queue.find(predicate);
                if (queued) return Promise.resolve(queued);
                return new Promise((resolveWait, rejectWait) => {
                    const timer = setTimeout(() => {
                        const index = waiters.findIndex(waiter => waiter.resolve === resolveWait);
                        if (index >= 0) waiters.splice(index, 1);
                        rejectWait(new Error(`Timed out waiting for WebSocket message; queued: ${queue.map(message => message.type).join(',')}`));
                    }, timeout);
                    waiters.push({ predicate, resolve: resolveWait, timer });
                });
            }
        }));
        ws.on('message', raw => dispatch(JSON.parse(raw.toString())));
        ws.once('error', reject);
    });
}

function closeSocket(client) {
    if (client?.ws && client.ws.readyState === WebSocket.OPEN) client.ws.close();
}

function initialCarcassonneState() {
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('');
    const deck = keys.flatMap(key => [key, key, key]);
    deck.splice(deck.indexOf('J'), 1); // fixed start tile
    deck.splice(deck.indexOf('E'), 1); // first preview tile
    return {
        grid: [['0,0', { typeKey: 'J', rotation: 0, meeple: null }]],
        deck,
        currentTile: { typeKey: 'E', rotation: 2 },
        activePlayer: 'red',
        scores: { red: 0, blue: 0, green: 0, yellow: 0 },
        meeplesRemaining: { red: 7, blue: 7, green: 7, yellow: 7 },
        remainingDeckCount: deck.length,
        turnPhase: 'PLACE_TILE',
        justPlacedCoords: null,
        playerCount: 2,
        playerNames: { red: '房主', blue: '訪客' },
        gameResult: null
    };
}

async function run() {
    const { server, port } = await startTestServer();
    let host;
    let guest;
    let rejoined;
    let carcHost;
    try {
        host = await connect(port);
        host.send({ type: 'create_room', gameType: 'gomoku', playerCount: 2, name: 'Host' });
        const created = await host.waitFor(message => message.type === 'room_created');

        guest = await connect(port);
        guest.send({ type: 'join_room', roomId: created.roomId, name: 'Guest' });
        await guest.waitFor(message => message.type === 'room_joined');
        await host.waitFor(message => message.type === 'player_joined');

        host.send({ type: 'move', x: 0, y: 0 });
        const firstMove = await host.waitFor(message => message.type === 'move_made');
        assert.strictEqual(firstMove.roomState.board[0][0], 'black');
        assert.strictEqual(firstMove.roomState.turn, 'white');

        host.send({ type: 'move', x: 1, y: 0, board: [['forged']] });
        const outOfTurn = await host.waitFor(message => message.type === 'error');
        assert.match(outOfTurn.message, /不是你的回合/);
        const restored = await host.waitFor(message => message.type === 'state_sync');
        assert.strictEqual(restored.roomState.board[0][1], null, 'The server must ignore forged board snapshots');

        host.send({ type: 'restart' });
        await host.waitFor(message => message.type === 'restart_requested');
        guest.send({ type: 'restart' });
        const restarted = await host.waitFor(message => message.type === 'game_restarted');
        assert.strictEqual(restarted.roomState.board[0][0], null, 'Restart needs every player vote and then resets canonical state');

        closeSocket(host);
        await guest.waitFor(message => message.type === 'player_left' && message.reconnecting === true);
        rejoined = await connect(port);
        rejoined.send({ type: 'join_room', roomId: created.roomId, name: 'ignored', resumeToken: created.resumeToken });
        const resumed = await rejoined.waitFor(message => message.type === 'room_joined');
        assert.strictEqual(resumed.role, 'black');
        assert.strictEqual(resumed.roomState.status, 'playing');

        carcHost = await connect(port);
        carcHost.send({ type: 'create_room', gameType: 'carcassonne', playerCount: 2, name: 'Carc Host' });
        const carcRoom = await carcHost.waitFor(message => message.type === 'room_created');
        const initial = initialCarcassonneState();
        carcHost.send({ type: 'carcassonne_init', actorPlayer: 'red', baseVersion: 0, state: initial });
        const initialized = await carcHost.waitFor(message => message.type === 'carcassonne_state');
        assert.strictEqual(initialized.roomState.carcassonneVersion, 1);

        const rotated = JSON.parse(JSON.stringify(initial));
        rotated.currentTile.rotation = 3;
        carcHost.send({ type: 'carcassonne_sync', actorPlayer: 'red', baseVersion: 1, state: rotated });
        const rotationAccepted = await carcHost.waitFor(message => message.type === 'carcassonne_state' && message.roomState.carcassonneVersion === 2);
        assert.strictEqual(rotationAccepted.roomState.carcassonneState.currentTile.rotation, 3, 'A legal tile rotation must be accepted');

        const placed = JSON.parse(JSON.stringify(rotated));
        placed.grid.push(['0,1', { typeKey: 'E', rotation: 3, meeple: null }]);
        placed.turnPhase = 'DEPLOY_MEEPLE';
        placed.justPlacedCoords = { gx: 0, gy: 1 };
        carcHost.send({ type: 'carcassonne_sync', actorPlayer: 'red', baseVersion: 2, state: placed });
        const tilePlaced = await carcHost.waitFor(message => message.type === 'carcassonne_state' && message.roomState.carcassonneVersion === 3);
        assert.strictEqual(tilePlaced.roomState.carcassonneState.grid.length, 2, 'A placed tile must not be rejected as a duplicate preview card');

        const forgedCarcassonne = JSON.parse(JSON.stringify(placed));
        forgedCarcassonne.grid[0][1].rotation = 1;
        carcHost.send({ type: 'carcassonne_sync', actorPlayer: 'red', baseVersion: 3, state: forgedCarcassonne });
        const rejected = await carcHost.waitFor(message => message.type === 'error');
        assert.match(rejected.message, /(邊緣不相符|不能修改已放置的地圖卡)/);

        const afterSkip = JSON.parse(JSON.stringify(placed));
        const nextCard = afterSkip.deck.pop();
        afterSkip.currentTile = { typeKey: nextCard, rotation: 0 };
        afterSkip.activePlayer = 'blue';
        afterSkip.turnPhase = 'PLACE_TILE';
        afterSkip.justPlacedCoords = null;
        afterSkip.remainingDeckCount = afterSkip.deck.length;
        carcHost.send({ type: 'carcassonne_sync', actorPlayer: 'red', baseVersion: 3, state: afterSkip });
        const turnFinished = await carcHost.waitFor(message => message.type === 'carcassonne_state' && message.roomState.carcassonneVersion === 4);
        assert.strictEqual(turnFinished.roomState.carcassonneState.activePlayer, 'blue', 'Skipping a meeple must advance exactly one player');

        console.log('multiplayer authority, restart votes, reconnect, and Carcassonne validation: OK');
    } finally {
        [host, guest, rejoined, carcHost].forEach(closeSocket);
        server.kill('SIGTERM');
        await Promise.race([new Promise(resolve => server.once('exit', resolve)), wait(1000)]);
    }
}

run().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
