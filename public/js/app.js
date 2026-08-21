// Main Application Controller & Network Client (5-in-1 Game Hub)
class PocketApp {
    constructor() {
        this.selectedGame = 'gomoku'; // 'gomoku' | 'reversi' | 'xiangqi' | 'chess' | 'checkers'
        this.currentMode = 'online';  // 'online' | 'hotseat' | 'ai'
        this.playerName = localStorage.getItem('pocket_player_name') || '特勤隊員';
        this.hotseatFlip = true;
        this.checkersPlayerCount = 2; // 2 or 3 players

        // Online State
        this.ws = null;
        this.roomId = null;
        this.myRole = null; // 'black' | 'white' | 'spectator' (or 'red', 'green', 'blue')
        this.roomState = null;

        // Game Engines
        this.engines = {
            gomoku: new GomokuEngine(15),
            reversi: new ReversiEngine(8),
            xiangqi: new XiangqiEngine(),
            chess: new ChessEngine(),
            checkers: new ChineseCheckersEngine(2)
        };

        // Selection states
        this.selectedSquare = null;
        this.currentValidDestinations = [];
        this.selectedHoleId = null;
        this.checkersValidDestinations = [];

        // Network Info
        this.serverInfo = null;

        this.initDOM();
        this.fetchServerInfo();
    }

    initDOM() {
        this.dom = {
            viewLobby: document.getElementById('view-lobby'),
            viewGame: document.getElementById('view-game'),
            playerNameInput: document.getElementById('player-name-input'),
            roomIdInput: document.getElementById('room-id-input'),
            gameTitleText: document.getElementById('game-title-text'),
            roomBadgeText: document.getElementById('room-badge-text'),
            boardContainer: document.getElementById('board-container'),
            boardEl: document.getElementById('board'),
            
            // Turn & Player Headers
            topPlayerBar: document.getElementById('top-player-bar'),
            topPlayerName: document.getElementById('top-player-name'),
            topPlayerTurn: document.getElementById('top-player-turn'),
            midPlayerBar: document.getElementById('mid-player-bar'),
            midPlayerName: document.getElementById('mid-player-name'),
            midPlayerTurn: document.getElementById('mid-player-turn'),
            bottomPlayerName: document.getElementById('bottom-player-name'),
            bottomPlayerTurn: document.getElementById('bottom-player-turn'),
            scoresBar: document.getElementById('scores-bar'),
            blackScore: document.getElementById('black-score'),
            whiteScore: document.getElementById('white-score'),

            // Modals
            qrModal: document.getElementById('qr-modal'),
            qrImage: document.getElementById('qr-image'),
            qrRoomCode: document.getElementById('qr-room-code'),
            qrUrlText: document.getElementById('qr-url-text'),
            winModal: document.getElementById('win-modal'),
            winTitle: document.getElementById('win-title'),
            winDesc: document.getElementById('win-desc'),
            toast: document.getElementById('toast'),

            // Lobby Game Cards
            cardGomoku: document.getElementById('card-gomoku'),
            cardReversi: document.getElementById('card-reversi'),
            cardXiangqi: document.getElementById('card-xiangqi'),
            cardChess: document.getElementById('card-chess'),
            cardCheckers: document.getElementById('card-checkers'),
            checkersCountBox: document.getElementById('checkers-count-box'),
            onlinePanel: document.getElementById('online-panel'),
            hotseatPanel: document.getElementById('hotseat-panel'),
            aiPanel: document.getElementById('ai-panel')
        };

        if (this.dom.playerNameInput) {
            this.dom.playerNameInput.value = this.playerName;
            this.dom.playerNameInput.addEventListener('input', (e) => {
                this.playerName = e.target.value.trim() || '特勤隊員';
                localStorage.setItem('pocket_player_name', this.playerName);
            });
        }
    }

    async fetchServerInfo() {
        try {
            const res = await fetch('/api/info');
            this.serverInfo = await res.json();
        } catch (e) {
            console.warn('Could not fetch server info:', e);
        }
    }

    get activeEngine() {
        return this.engines[this.selectedGame];
    }

    selectGame(game) {
        this.selectedGame = game;
        this.dom.cardGomoku.classList.toggle('selected', game === 'gomoku');
        this.dom.cardReversi.classList.toggle('selected', game === 'reversi');
        this.dom.cardXiangqi.classList.toggle('selected', game === 'xiangqi');
        this.dom.cardChess.classList.toggle('selected', game === 'chess');
        this.dom.cardCheckers.classList.toggle('selected', game === 'checkers');

        if (this.dom.checkersCountBox) {
            this.dom.checkersCountBox.classList.toggle('hidden', game !== 'checkers');
        }

        window.sounds.playPing();
    }

    setCheckersCount(count) {
        this.checkersPlayerCount = count;
        document.querySelectorAll('.checkers-pill').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.count, 10) === count);
        });
        this.engines.checkers = new ChineseCheckersEngine(count);
        window.sounds.playPing();
    }

    selectMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-pill').forEach(el => {
            el.classList.toggle('active', el.dataset.mode === mode);
        });

        this.dom.onlinePanel.classList.toggle('hidden', mode !== 'online');
        this.dom.hotseatPanel.classList.toggle('hidden', mode !== 'hotseat');
        this.dom.aiPanel.classList.toggle('hidden', mode !== 'ai');
        window.sounds.playPing();
    }

    showToast(message, duration = 2500) {
        this.dom.toast.textContent = message;
        this.dom.toast.classList.add('show');
        setTimeout(() => {
            this.dom.toast.classList.remove('show');
        }, duration);
    }

    // ==========================================
    // 🌐 ONLINE WEBSOCKET HANDLING
    // ==========================================
    connectWS(onOpen) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            if (onOpen) onOpen();
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            if (onOpen) onOpen();
        };

        this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            this.handleServerMessage(data);
        };

        this.ws.onclose = () => {
            this.showToast('⚠️ 與伺服器連線中斷');
        };

        this.ws.onerror = (err) => {
            this.showToast('❌ 連線錯誤');
        };
    }

    createOnlineRoom() {
        this.connectWS(() => {
            this.ws.send(JSON.stringify({
                type: 'create_room',
                gameType: this.selectedGame,
                playerCount: this.checkersPlayerCount,
                name: this.playerName
            }));
        });
    }

    joinOnlineRoom() {
        const code = this.dom.roomIdInput.value.trim();
        if (!code) {
            this.showToast('請輸入 4 位數房間號碼');
            return;
        }

        this.connectWS(() => {
            this.ws.send(JSON.stringify({
                type: 'join_room',
                roomId: code,
                name: this.playerName
            }));
        });
    }

    handleServerMessage(data) {
        const { type } = data;

        if (type === 'room_created') {
            this.roomId = data.roomId;
            this.myRole = data.role; // 'black' (P1)
            this.roomState = data.roomState;
            this.selectedGame = data.roomState.gameType;
            this.activeEngine.reset();
            this.enterGameView();
            this.showQRModal();
            this.showToast(`房間已建立！房號: ${this.roomId}`);
        }

        else if (type === 'room_joined') {
            this.roomId = data.roomId;
            this.myRole = data.role;
            this.roomState = data.roomState;
            this.selectedGame = data.roomState.gameType;
            this.activeEngine.reset();
            this.enterGameView();
            this.renderOnlineBoard();
            this.showToast(`成功加入房間 ${this.roomId}`);
            window.sounds.playPing();
        }

        else if (type === 'player_joined') {
            this.roomState = data.roomState;
            this.showToast(`👋 ${data.name} 加入了房間`);
            this.updatePlayerStatus();
            window.sounds.playPing();
        }

        else if (type === 'move_made') {
            this.roomState = data.roomState;
            this.activeEngine.loadState(this.roomState);

            if (this.selectedGame === 'reversi') {
                window.sounds.playFlip();
            } else {
                window.sounds.playPlaceStone();
            }

            this.selectedSquare = null;
            this.currentValidDestinations = [];
            this.selectedHoleId = null;
            this.checkersValidDestinations = [];
            this.renderOnlineBoard();

            if (this.roomState.winner) {
                this.handleOnlineGameOver(this.roomState.winner);
            }
        }

        else if (type === 'game_restarted') {
            this.roomState = data.roomState;
            this.activeEngine.reset();
            this.selectedSquare = null;
            this.currentValidDestinations = [];
            this.selectedHoleId = null;
            this.checkersValidDestinations = [];
            this.renderOnlineBoard();
            this.hideModals();
            this.showToast(`🔄 ${data.by} 重新開局！`);
            window.sounds.playPing();
        }

        else if (type === 'reaction') {
            this.spawnFloatingReaction(data.emoji, data.from);
            window.sounds.playPing();
        }

        else if (type === 'player_left') {
            this.roomState = data.roomState;
            this.showToast(`🚪 ${data.name} 離開了房間`);
            this.updatePlayerStatus();
        }

        else if (type === 'error') {
            this.showToast(`❌ ${data.message}`);
        }
    }

    sendOnlineMovePayload(payloadExtra) {
        if (!this.ws || this.myRole === 'spectator') return;

        const engine = this.activeEngine;
        const payload = {
            type: 'move',
            board: engine.board,
            nextTurn: engine.turn,
            winner: engine.winner,
            scores: this.selectedGame === 'reversi' ? engine.getCounts() : null,
            ...payloadExtra
        };

        this.ws.send(JSON.stringify(payload));
    }

    requestOnlineRestart() {
        if (this.ws && this.roomId) {
            this.ws.send(JSON.stringify({ type: 'restart' }));
        }
    }

    sendReaction(emoji) {
        if (this.currentMode === 'online' && this.ws && this.roomId) {
            this.ws.send(JSON.stringify({ type: 'reaction', emoji }));
        } else {
            this.spawnFloatingReaction(emoji, this.playerName);
        }
        window.sounds.playPing();
    }

    // ==========================================
    // 🪑 LOCAL & AI MODES
    // ==========================================
    startHotseatGame() {
        this.currentMode = 'hotseat';
        this.myRole = 'local';
        this.activeEngine.reset();
        this.selectedSquare = null;
        this.currentValidDestinations = [];
        this.selectedHoleId = null;
        this.checkersValidDestinations = [];
        this.enterGameView();
        this.renderLocalBoard();
        this.showToast('🎮 雙人/三人小桌板同機模式');
    }

    startAIGame() {
        this.currentMode = 'ai';
        this.myRole = 'p1';
        this.activeEngine.reset();
        this.selectedSquare = null;
        this.currentValidDestinations = [];
        this.selectedHoleId = null;
        this.checkersValidDestinations = [];
        this.enterGameView();
        this.renderLocalBoard();
        this.showToast('🤖 離線 AI 練習模式');
    }

    handleLocalCellClick(x, y) {
        const engine = this.activeEngine;
        if (engine.winner) return;

        // If AI mode and it's AI turn, block user input
        const isAiTurn = this.currentMode === 'ai' && (
            (this.selectedGame === 'gomoku' && engine.turn === 'white') ||
            (this.selectedGame === 'reversi' && engine.turn === 'white') ||
            (this.selectedGame === 'xiangqi' && engine.turn === 'black') ||
            (this.selectedGame === 'chess' && engine.turn === 'black') ||
            (this.selectedGame === 'checkers' && engine.turn !== 'red')
        );
        if (isAiTurn) return;

        if (this.selectedGame === 'gomoku' || this.selectedGame === 'reversi') {
            const valid = engine.makeMove(x, y);
            if (!valid) return;

            if (this.selectedGame === 'gomoku') window.sounds.playPlaceStone();
            else window.sounds.playFlip();

            this.renderLocalBoard();
            if (engine.winner) return this.handleLocalGameOver(engine.winner);

            this.triggerAITurnIfNeeded();
        } else {
            // Piece Selection Mechanics for Xiangqi & Chess
            this.handlePieceSelectionMove(x, y, (fx, fy, tx, ty) => {
                const valid = engine.makeMove(fx, fy, tx, ty);
                if (valid) {
                    window.sounds.playPlaceStone();
                    this.renderLocalBoard();
                    if (engine.winner) return this.handleLocalGameOver(engine.winner);
                    this.triggerAITurnIfNeeded();
                }
            });
        }
    }

    handleCheckersHoleClick(holeId) {
        const engine = this.engines.checkers;
        if (engine.winner) return;

        // AI turn check
        if (this.currentMode === 'ai' && engine.turn !== 'red') return;

        // If already selected a marble, check if clicking a valid destination
        if (this.selectedHoleId !== null) {
            const move = this.checkersValidDestinations.find(d => d.targetId === holeId);
            if (move) {
                const fromId = this.selectedHoleId;
                const toId = holeId;
                this.selectedHoleId = null;
                this.checkersValidDestinations = [];

                if (this.currentMode === 'online') {
                    const valid = engine.makeMove(fromId, toId);
                    if (valid) {
                        window.sounds.playPlaceStone();
                        this.sendOnlineMovePayload({ from: fromId, to: toId });
                    }
                } else {
                    const valid = engine.makeMove(fromId, toId);
                    if (valid) {
                        window.sounds.playPlaceStone();
                        this.renderLocalBoard();
                        if (engine.winner) return this.handleLocalGameOver(engine.winner);
                        this.triggerAITurnIfNeeded();
                    }
                }
                return;
            }
        }

        // Select marble of current turn's color
        if (engine.board[holeId] === engine.turn) {
            this.selectedHoleId = holeId;
            this.checkersValidDestinations = engine.getValidMoves(holeId);
            window.sounds.playPing();
            this.renderCurrentBoard();
        } else {
            this.selectedHoleId = null;
            this.checkersValidDestinations = [];
            this.renderCurrentBoard();
        }
    }

    handlePieceSelectionMove(x, y, onMoveExecute) {
        const engine = this.activeEngine;
        const clickedPiece = engine.getPiece(x, y);

        if (this.selectedSquare) {
            const dest = this.currentValidDestinations.find(d => d.x === x && d.y === y);
            if (dest) {
                const fx = this.selectedSquare.x;
                const fy = this.selectedSquare.y;
                this.selectedSquare = null;
                this.currentValidDestinations = [];
                onMoveExecute(fx, fy, x, y);
                return;
            }
        }

        if (clickedPiece && clickedPiece.color === engine.turn) {
            this.selectedSquare = { x, y };
            this.currentValidDestinations = engine.getValidMovesForPiece(x, y);
            window.sounds.playPing();
            this.renderCurrentBoard();
        } else {
            this.selectedSquare = null;
            this.currentValidDestinations = [];
            this.renderCurrentBoard();
        }
    }

    triggerAITurnIfNeeded() {
        if (this.currentMode !== 'ai') return;
        const engine = this.activeEngine;

        if (this.selectedGame === 'checkers') {
            if (engine.turn !== 'red' && !engine.winner) {
                setTimeout(() => {
                    const aiMove = engine.getAIMove(engine.turn);
                    if (aiMove) {
                        engine.makeMove(aiMove.from, aiMove.to);
                        window.sounds.playPlaceStone();
                        this.renderLocalBoard();
                        if (engine.winner) {
                            return this.handleLocalGameOver(engine.winner);
                        }
                        // If 3-player AI, might need another AI move
                        this.triggerAITurnIfNeeded();
                    }
                }, 400);
            }
            return;
        }

        const aiColor = (this.selectedGame === 'xiangqi' || this.selectedGame === 'chess') ? 'black' : 'white';

        if (engine.turn === aiColor && !engine.winner) {
            setTimeout(() => {
                const aiMove = engine.getAIMove(aiColor);
                if (aiMove) {
                    if (this.selectedGame === 'gomoku' || this.selectedGame === 'reversi') {
                        engine.makeMove(aiMove.x, aiMove.y);
                        if (this.selectedGame === 'gomoku') window.sounds.playPlaceStone();
                        else window.sounds.playFlip();
                    } else {
                        engine.makeMove(aiMove.from.x, aiMove.from.y, aiMove.to.x, aiMove.to.y);
                        window.sounds.playPlaceStone();
                    }
                    this.renderLocalBoard();
                    if (engine.winner) {
                        this.handleLocalGameOver(engine.winner);
                    }
                }
            }, 350);
        }
    }

    restartLocalGame() {
        this.activeEngine.reset();
        this.selectedSquare = null;
        this.currentValidDestinations = [];
        this.selectedHoleId = null;
        this.checkersValidDestinations = [];
        this.renderLocalBoard();
        this.hideModals();
        this.showToast('🔄 棋局已重置');
        window.sounds.playPing();
    }

    // ==========================================
    // 🎨 UI RENDERING & BOARD DRAWING
    // ==========================================
    enterGameView() {
        this.dom.viewLobby.classList.add('hidden');
        this.dom.viewGame.classList.remove('hidden');

        const titles = {
            gomoku: '五子棋 (Gomoku)',
            reversi: '黑白棋 (Reversi)',
            xiangqi: '中國象棋 (Xiangqi)',
            chess: '西洋棋 (Chess)',
            checkers: `六角星跳棋 (${this.checkersPlayerCount}人局)`
        };
        this.dom.gameTitleText.textContent = titles[this.selectedGame];

        if (this.currentMode === 'online') {
            this.dom.roomBadgeText.textContent = `房號: ${this.roomId}`;
        } else {
            this.dom.roomBadgeText.textContent = this.currentMode === 'hotseat' ? '同機對戰' : 'AI 對戰';
        }

        // Aspect ratio handling
        if (this.selectedGame === 'xiangqi') {
            this.dom.boardContainer.className = 'board-container xiangqi-board-ratio';
        } else if (this.selectedGame === 'checkers') {
            this.dom.boardContainer.className = 'board-container checkers-board-ratio';
        } else {
            this.dom.boardContainer.className = 'board-container square-board';
        }

        this.dom.scoresBar.classList.toggle('hidden', this.selectedGame !== 'reversi');
        
        // Mid player bar for 3-player Checkers
        if (this.dom.midPlayerBar) {
            this.dom.midPlayerBar.classList.toggle('hidden', !(this.selectedGame === 'checkers' && this.checkersPlayerCount === 3));
        }

        if (this.currentMode === 'hotseat' && this.hotseatFlip && this.selectedGame !== 'checkers') {
            this.dom.topPlayerBar.classList.add('hotseat-top');
        } else {
            this.dom.topPlayerBar.classList.remove('hotseat-top');
        }

        this.renderCurrentBoard();
    }

    leaveGame() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.roomId = null;
        this.myRole = null;
        this.selectedSquare = null;
        this.currentValidDestinations = [];
        this.selectedHoleId = null;
        this.checkersValidDestinations = [];
        this.hideModals();
        this.dom.viewGame.classList.add('hidden');
        this.dom.viewLobby.classList.remove('hidden');
    }

    renderCurrentBoard() {
        if (this.currentMode === 'online') {
            this.renderOnlineBoard();
        } else {
            this.renderLocalBoard();
        }
    }

    renderOnlineBoard() {
        const engine = this.activeEngine;
        if (this.roomState) {
            engine.loadState(this.roomState);
        }
        this.drawBoard(engine, (x, y) => this.handleOnlineCellClick(x, y));
        this.updatePlayerStatus();
    }

    renderLocalBoard() {
        const engine = this.activeEngine;
        if (this.selectedGame === 'checkers') {
            this.drawCheckersBoard(engine, (holeId) => this.handleCheckersHoleClick(holeId));
        } else {
            this.drawBoard(engine, (x, y) => this.handleLocalCellClick(x, y));
        }
        this.updatePlayerStatus();
    }

    handleOnlineCellClick(x, y) {
        if (this.myRole === 'spectator') return;
        const engine = this.activeEngine;
        
        if (this.selectedGame === 'gomoku' || this.selectedGame === 'reversi') {
            const valid = engine.makeMove(x, y);
            if (!valid) return;
            this.sendOnlineMovePayload({ x, y });
        } else if (this.selectedGame === 'checkers') {
            // Checkers handled via handleCheckersHoleClick
        } else {
            this.handlePieceSelectionMove(x, y, (fx, fy, tx, ty) => {
                const valid = engine.makeMove(fx, fy, tx, ty);
                if (valid) {
                    this.sendOnlineMovePayload({ from: { x: fx, y: fy }, to: { x: tx, y: ty } });
                }
            });
        }
    }

    drawBoard(engine, onCellClick) {
        this.dom.boardEl.innerHTML = '';

        if (this.selectedGame === 'gomoku') {
            this.dom.boardEl.className = 'gomoku-board';
            this.drawGomokuBoard(engine, onCellClick);
        } else if (this.selectedGame === 'reversi') {
            this.dom.boardEl.className = 'reversi-board';
            this.drawReversiBoard(engine, onCellClick);
        } else if (this.selectedGame === 'xiangqi') {
            this.dom.boardEl.className = 'xiangqi-board';
            this.drawXiangqiBoard(engine, onCellClick);
        } else if (this.selectedGame === 'chess') {
            this.dom.boardEl.className = 'chess-board';
            this.drawChessBoard(engine, onCellClick);
        } else if (this.selectedGame === 'checkers') {
            this.dom.boardEl.className = 'checkers-board';
            this.drawCheckersBoard(engine, (holeId) => this.handleCheckersHoleClick(holeId));
        }
    }

    drawGomokuBoard(engine, onCellClick) {
        const size = engine.size;
        const starPoints = ['3,3', '3,11', '7,7', '11,3', '11,11'];

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const cell = document.createElement('div');
                cell.className = 'gomoku-cell';

                if (starPoints.includes(`${x},${y}`)) {
                    const star = document.createElement('div');
                    star.className = 'gomoku-star';
                    cell.appendChild(star);
                }

                const stoneColor = engine.board[y][x];
                if (stoneColor) {
                    const stone = document.createElement('div');
                    stone.className = `stone ${stoneColor}`;

                    if (engine.lastMove && engine.lastMove.x === x && engine.lastMove.y === y) {
                        const ring = document.createElement('div');
                        ring.className = 'last-move-ring';
                        stone.appendChild(ring);
                    }

                    if (engine.winningLine && engine.winningLine.some(p => p.x === x && p.y === y)) {
                        stone.classList.add('winning');
                    }

                    cell.appendChild(stone);
                }

                cell.addEventListener('click', () => onCellClick(x, y));
                this.dom.boardEl.appendChild(cell);
            }
        }
    }

    drawReversiBoard(engine, onCellClick) {
        const size = engine.size;
        const validMoves = engine.getValidMoves(engine.turn);
        const validMap = new Set(validMoves.map(m => `${m.x},${m.y}`));

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const cell = document.createElement('div');
                cell.className = 'reversi-cell';

                const stoneColor = engine.board[y][x];
                if (stoneColor) {
                    const stone = document.createElement('div');
                    stone.className = `stone ${stoneColor}`;

                    if (engine.justFlipped && engine.justFlipped.some(p => p.x === x && p.y === y)) {
                        stone.classList.add('flipping');
                    }

                    if (engine.lastMove && engine.lastMove.x === x && engine.lastMove.y === y) {
                        const ring = document.createElement('div');
                        ring.className = 'last-move-ring';
                        stone.appendChild(ring);
                    }

                    cell.appendChild(stone);
                } else if (validMap.has(`${x},${y}`) && !engine.winner) {
                    const hint = document.createElement('div');
                    hint.className = 'reversi-hint';
                    cell.appendChild(hint);
                }

                cell.addEventListener('click', () => onCellClick(x, y));
                this.dom.boardEl.appendChild(cell);
            }
        }

        const counts = engine.getCounts();
        this.dom.blackScore.textContent = counts.black;
        this.dom.whiteScore.textContent = counts.white;
    }

    drawXiangqiBoard(engine, onCellClick) {
        // Full SVG Grid Layer
        const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgLayer.setAttribute('class', 'xiangqi-svg-layer');
        svgLayer.setAttribute('viewBox', '0 0 900 1000');
        svgLayer.innerHTML = `
            <rect x="25" y="25" width="850" height="950" fill="none" stroke="#7c4a1e" stroke-width="3" />
            <rect x="35" y="35" width="830" height="930" fill="none" stroke="#7c4a1e" stroke-width="1.5" />

            <line x1="50" y1="50" x2="850" y2="50" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="50" y1="150" x2="850" y2="150" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="50" y1="250" x2="850" y2="250" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="50" y1="350" x2="850" y2="350" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="50" y1="450" x2="850" y2="450" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="50" y1="550" x2="850" y2="550" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="50" y1="650" x2="850" y2="650" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="50" y1="750" x2="850" y2="750" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="50" y1="850" x2="850" y2="850" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="50" y1="950" x2="850" y2="950" stroke="#7c4a1e" stroke-width="1.8" />

            <line x1="50" y1="50" x2="50" y2="950" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="850" y1="50" x2="850" y2="950" stroke="#7c4a1e" stroke-width="1.8" />

            <line x1="150" y1="50" x2="150" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="150" y1="550" x2="150" y2="950" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="250" y1="50" x2="250" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="250" y1="550" x2="250" y2="950" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="350" y1="50" x2="350" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="350" y1="550" x2="350" y2="950" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="450" y1="50" x2="450" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="450" y1="550" x2="450" y2="950" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="550" y1="50" x2="550" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="550" y1="550" x2="550" y2="950" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="650" y1="50" x2="650" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="650" y1="550" x2="650" y2="950" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="750" y1="50" x2="750" y2="450" stroke="#7c4a1e" stroke-width="1.5" />
            <line x1="750" y1="550" x2="750" y2="950" stroke="#7c4a1e" stroke-width="1.5" />

            <line x1="350" y1="50" x2="550" y2="250" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="550" y1="50" x2="350" y2="250" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="350" y1="750" x2="550" y2="950" stroke="#7c4a1e" stroke-width="1.8" />
            <line x1="550" y1="750" x2="350" y2="950" stroke="#7c4a1e" stroke-width="1.8" />
        `;
        this.dom.boardEl.appendChild(svgLayer);

        const riverText = document.createElement('div');
        riverText.className = 'xiangqi-river-text';
        riverText.innerHTML = '<span>楚 河</span><span>漢 界</span>';
        this.dom.boardEl.appendChild(riverText);

        const destMap = new Map(this.currentValidDestinations.map(d => [`${d.x},${d.y}`, d]));

        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 9; x++) {
                const cell = document.createElement('div');
                cell.className = 'xiangqi-cell';
                if (y === 4 || y === 5) cell.classList.add('river-cell');

                const piece = engine.getPiece(x, y);
                const isSelected = this.selectedSquare && this.selectedSquare.x === x && this.selectedSquare.y === y;
                const destInfo = destMap.get(`${x},${y}`);

                if (piece) {
                    const pEl = document.createElement('div');
                    pEl.className = `xiangqi-piece ${piece.color} ${isSelected ? 'selected' : ''}`;
                    pEl.textContent = piece.text;
                    cell.appendChild(pEl);

                    if (destInfo && destInfo.captured) {
                        const capRing = document.createElement('div');
                        capRing.className = 'capture-target-ring';
                        cell.appendChild(capRing);
                    }
                } else if (destInfo) {
                    const dot = document.createElement('div');
                    dot.className = 'move-dest-dot';
                    cell.appendChild(dot);
                }

                cell.addEventListener('click', () => onCellClick(x, y));
                this.dom.boardEl.appendChild(cell);
            }
        }
    }

    drawChessBoard(engine, onCellClick) {
        const destMap = new Map(this.currentValidDestinations.map(d => [`${d.x},${d.y}`, d]));
        const fileNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const cell = document.createElement('div');
                const isLight = (x + y) % 2 === 0;
                cell.className = `chess-cell ${isLight ? 'light-square' : 'dark-square'}`;

                if (x === 0) {
                    const rankLabel = document.createElement('span');
                    rankLabel.className = 'chess-coord rank';
                    rankLabel.textContent = 8 - y;
                    cell.appendChild(rankLabel);
                }
                if (y === 7) {
                    const fileLabel = document.createElement('span');
                    fileLabel.className = 'chess-coord file';
                    fileLabel.textContent = fileNames[x];
                    cell.appendChild(fileLabel);
                }

                const piece = engine.getPiece(x, y);
                const isSelected = this.selectedSquare && this.selectedSquare.x === x && this.selectedSquare.y === y;
                const destInfo = destMap.get(`${x},${y}`);

                if (piece) {
                    const pEl = document.createElement('div');
                    pEl.className = `chess-piece ${piece.color} ${isSelected ? 'selected' : ''}`;
                    pEl.textContent = piece.symbol;
                    cell.appendChild(pEl);

                    if (destInfo && destInfo.captured) {
                        const capRing = document.createElement('div');
                        capRing.className = 'capture-target-ring';
                        cell.appendChild(capRing);
                    }
                } else if (destInfo) {
                    const dot = document.createElement('div');
                    dot.className = 'move-dest-dot';
                    cell.appendChild(dot);
                }

                cell.addEventListener('click', () => onCellClick(x, y));
                this.dom.boardEl.appendChild(cell);
            }
        }
    }

    drawCheckersBoard(engine, onHoleClick) {
        this.dom.boardEl.innerHTML = '';
        this.dom.boardEl.className = 'checkers-board';

        const is3P = this.checkersPlayerCount === 3;

        // 1. Draw SVG with Base Colored Polygons, Target Labels, Connecting Lines, and Pit Holes
        const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgLayer.setAttribute('class', 'checkers-svg-layer');
        svgLayer.setAttribute('viewBox', '0 0 600 660');

        // Corner Polygons for the 6 star points
        const cornerPolygons = {
            0: '300,55 220,195 380,195',     // Top
            1: '540,195 380,195 460,335',    // Top-Right
            2: '540,465 460,325 380,465',    // Bottom-Right
            3: '300,605 380,465 220,465',    // Bottom
            4: '60,465 220,465 140,325',     // Bottom-Left
            5: '60,195 140,335 220,195'      // Top-Left
        };

        // Determine corner tints based on 2P or 3P
        let baseTints = '';
        if (!is3P) {
            // 2 Players: Red target is Bottom (3), Green target is Top (0)
            baseTints = `
                <!-- Green Target Base (Top 0) -->
                <polygon points="${cornerPolygons[0]}" fill="rgba(16,172,132,0.22)" stroke="#10ac84" stroke-width="2" />
                <text x="300" y="145" fill="#10ac84" font-size="13" font-weight="900" text-anchor="middle" font-family="sans-serif">🟢 綠方目標</text>

                <!-- Red Target Base (Bottom 3) -->
                <polygon points="${cornerPolygons[3]}" fill="rgba(238,82,83,0.22)" stroke="#ee5253" stroke-width="2" />
                <text x="300" y="525" fill="#ee5253" font-size="13" font-weight="900" text-anchor="middle" font-family="sans-serif">🔴 紅方目標</text>

                <!-- Neutral Corners -->
                <polygon points="${cornerPolygons[1]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
                <polygon points="${cornerPolygons[2]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
                <polygon points="${cornerPolygons[4]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
                <polygon points="${cornerPolygons[5]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
            `;
        } else {
            // 3 Players: Red target is Bottom (3), Green target is Top-Left (5), Blue target is Top-Right (1)
            baseTints = `
                <!-- Red Target Base (Bottom 3) -->
                <polygon points="${cornerPolygons[3]}" fill="rgba(238,82,83,0.22)" stroke="#ee5253" stroke-width="2" />
                <text x="300" y="525" fill="#ee5253" font-size="13" font-weight="900" text-anchor="middle" font-family="sans-serif">🔴 紅方目標</text>

                <!-- Green Target Base (Top-Left 5) -->
                <polygon points="${cornerPolygons[5]}" fill="rgba(16,172,132,0.22)" stroke="#10ac84" stroke-width="2" />
                <text x="140" y="270" fill="#10ac84" font-size="12" font-weight="900" text-anchor="middle" font-family="sans-serif">🟢 綠方目標</text>

                <!-- Blue Target Base (Top-Right 1) -->
                <polygon points="${cornerPolygons[1]}" fill="rgba(46,134,222,0.22)" stroke="#2e86de" stroke-width="2" />
                <text x="460" y="270" fill="#2e86de" font-size="12" font-weight="900" text-anchor="middle" font-family="sans-serif">🔵 藍方目標</text>

                <!-- Starting corners subtle markers -->
                <polygon points="${cornerPolygons[0]}" fill="rgba(238,82,83,0.08)" stroke="rgba(238,82,83,0.5)" stroke-dasharray="4,4" />
                <polygon points="${cornerPolygons[2]}" fill="rgba(16,172,132,0.08)" stroke="rgba(16,172,132,0.5)" stroke-dasharray="4,4" />
                <polygon points="${cornerPolygons[4]}" fill="rgba(46,134,222,0.08)" stroke="rgba(46,134,222,0.5)" stroke-dasharray="4,4" />
            `;
        }

        // Connecting grid lines
        let linesHtml = '';
        for (const h of engine.holes) {
            for (let dir = 0; dir < 3; dir++) {
                const nid = h.neighbors[dir];
                if (nid !== null && nid > h.id) {
                    const nh = engine.holes[nid];
                    linesHtml += `<line x1="${h.x}" y1="${h.y}" x2="${nh.x}" y2="${nh.y}" stroke="rgba(124,74,30,0.4)" stroke-width="1.3" />`;
                }
            }
        }

        // Pit holes with target corner glow colors
        let pitsHtml = '';
        for (const h of engine.holes) {
            let strokeColor = '#8b5a2b';
            let fillColor = '#58310f';

            if (!is3P) {
                if (h.cornerId === 3) strokeColor = 'rgba(238,82,83,0.85)';    // Red target pits
                else if (h.cornerId === 0) strokeColor = 'rgba(16,172,132,0.85)'; // Green target pits
            } else {
                if (h.cornerId === 3) strokeColor = 'rgba(238,82,83,0.85)';    // Red target pits
                else if (h.cornerId === 5) strokeColor = 'rgba(16,172,132,0.85)'; // Green target pits
                else if (h.cornerId === 1) strokeColor = 'rgba(46,134,222,0.85)'; // Blue target pits
            }

            pitsHtml += `<circle cx="${h.x}" cy="${h.y}" r="5" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.2" />`;
        }

        svgLayer.innerHTML = `${baseTints}${linesHtml}${pitsHtml}`;
        this.dom.boardEl.appendChild(svgLayer);

        // 2. Destination map for valid move hints
        const destMap = new Map(this.checkersValidDestinations.map(d => [d.targetId, d]));

        // 3. Draw Interactive Marbles & Touch Hit-Targets
        for (const h of engine.holes) {
            const holeEl = document.createElement('div');
            holeEl.className = 'checkers-hole';
            holeEl.style.left = `${(h.x / 600) * 100}%`;
            holeEl.style.top = `${(h.y / 660) * 100}%`;

            const marbleColor = engine.board[h.id];
            const isSelected = this.selectedHoleId === h.id;
            const destInfo = destMap.get(h.id);

            if (marbleColor) {
                const marbleEl = document.createElement('div');
                marbleEl.className = `marble ${marbleColor} ${isSelected ? 'selected' : ''}`;
                holeEl.appendChild(marbleEl);
            } else if (destInfo) {
                const hint = document.createElement('div');
                hint.className = 'checkers-dest-hint';
                holeEl.appendChild(hint);
            }

            holeEl.addEventListener('click', () => onHoleClick(h.id));
            this.dom.boardEl.appendChild(holeEl);
        }
    }

    updatePlayerStatus() {
        const engine = this.activeEngine;
        const currentTurn = engine.turn;

        if (this.selectedGame === 'checkers') {
            const count = this.checkersPlayerCount;
            if (count === 3) {
                this.dom.topPlayerName.textContent = '🔴 玩家一 (紅方)';
                this.dom.midPlayerName.textContent = '🟢 玩家二 (綠方)';
                this.dom.bottomPlayerName.textContent = '🔵 玩家三 (藍方)';

                this.dom.topPlayerTurn.textContent = currentTurn === 'red' ? '▶ 行棋中' : '等待中';
                this.dom.topPlayerTurn.className = `turn-pill ${currentTurn === 'red' ? 'active-turn' : 'wait-turn'}`;

                this.dom.midPlayerTurn.textContent = currentTurn === 'green' ? '▶ 行棋中' : '等待中';
                this.dom.midPlayerTurn.className = `turn-pill ${currentTurn === 'green' ? 'active-turn' : 'wait-turn'}`;

                this.dom.bottomPlayerTurn.textContent = currentTurn === 'blue' ? '▶ 行棋中' : '等待中';
                this.dom.bottomPlayerTurn.className = `turn-pill ${currentTurn === 'blue' ? 'active-turn' : 'wait-turn'}`;
                return;
            } else {
                this.dom.topPlayerName.textContent = '🟢 玩家二 (綠方)';
                this.dom.bottomPlayerName.textContent = '🔴 玩家一 (紅方)';
                this.updateTurnPills(currentTurn === 'green', currentTurn === 'red');
                return;
            }
        }

        if (this.currentMode === 'online') {
            const p1 = this.roomState?.players?.black?.name || '等待玩家 1';
            const p2 = this.roomState?.players?.white?.name || '等待玩家 2';

            if (this.selectedGame === 'xiangqi') {
                this.dom.topPlayerName.textContent = `⚫ ${p2} (黑方)`;
                this.dom.bottomPlayerName.textContent = `🔴 ${p1} (紅方)`;
                this.updateTurnPills(currentTurn === 'black', currentTurn === 'red');
            } else if (this.selectedGame === 'chess') {
                this.dom.topPlayerName.textContent = `♟️ ${p2} (黑方)`;
                this.dom.bottomPlayerName.textContent = `♙ ${p1} (白方)`;
                this.updateTurnPills(currentTurn === 'black', currentTurn === 'white');
            } else {
                this.dom.topPlayerName.textContent = `⚪ ${p2} (白方)`;
                this.dom.bottomPlayerName.textContent = `⚫ ${p1} (黑方)`;
                this.updateTurnPills(currentTurn === 'white', currentTurn === 'black');
            }
        } else if (this.currentMode === 'hotseat') {
            if (this.selectedGame === 'xiangqi') {
                this.dom.topPlayerName.textContent = '⚫ 玩家二 (黑方)';
                this.dom.bottomPlayerName.textContent = '🔴 玩家一 (紅方)';
                this.updateTurnPills(currentTurn === 'black', currentTurn === 'red');
            } else if (this.selectedGame === 'chess') {
                this.dom.topPlayerName.textContent = '♟️ 玩家二 (黑方)';
                this.dom.bottomPlayerName.textContent = '♙ 玩家一 (白方)';
                this.updateTurnPills(currentTurn === 'black', currentTurn === 'white');
            } else {
                this.dom.topPlayerName.textContent = '⚪ 玩家二 (白方)';
                this.dom.bottomPlayerName.textContent = '⚫ 玩家一 (黑方)';
                this.updateTurnPills(currentTurn === 'white', currentTurn === 'black');
            }
        } else if (this.currentMode === 'ai') {
            if (this.selectedGame === 'xiangqi') {
                this.dom.topPlayerName.textContent = '🤖 離線 AI (黑方)';
                this.dom.bottomPlayerName.textContent = `🔴 ${this.playerName} (紅方)`;
                this.updateTurnPills(currentTurn === 'black', currentTurn === 'red');
            } else if (this.selectedGame === 'chess') {
                this.dom.topPlayerName.textContent = '🤖 離線 AI (黑方)';
                this.dom.bottomPlayerName.textContent = `♙ ${this.playerName} (白方)`;
                this.updateTurnPills(currentTurn === 'black', currentTurn === 'white');
            } else {
                this.dom.topPlayerName.textContent = '🤖 離線 AI (白方)';
                this.dom.bottomPlayerName.textContent = `⚫ ${this.playerName} (黑方)`;
                this.updateTurnPills(currentTurn === 'white', currentTurn === 'black');
            }
        }
    }

    updateTurnPills(topIsActive, bottomIsActive) {
        this.dom.topPlayerTurn.textContent = topIsActive ? '▶ 行棋中' : '等待中';
        this.dom.topPlayerTurn.className = `turn-pill ${topIsActive ? 'active-turn' : 'wait-turn'}`;

        this.dom.bottomPlayerTurn.textContent = bottomIsActive ? '▶ 行棋中' : '等待中';
        this.dom.bottomPlayerTurn.className = `turn-pill ${bottomIsActive ? 'active-turn' : 'wait-turn'}`;
    }

    handleOnlineGameOver(winner) {
        window.sounds.playWin();
        let title = '🏆 遊戲結束！';
        let desc = `恭喜 ${winner} 獲得勝利！`;
        this.showWinModal(title, desc);
    }

    handleLocalGameOver(winner) {
        window.sounds.playWin();
        let winnerName = winner;
        if (winner === 'red') winnerName = '紅方';
        else if (winner === 'green') winnerName = '綠方';
        else if (winner === 'blue') winnerName = '藍方';
        else if (winner === 'black') winnerName = '黑方';
        else if (winner === 'white') winnerName = '白方';

        const title = `🏆 ${winnerName} 獲勝！`;
        const desc = this.currentMode === 'ai' 
            ? (winner === 'red' || winner === 'white' ? '恭喜您率先將所有彈珠跳入目標基地！' : 'AI 本局獲勝，再接再厲！')
            : `${winnerName} 表現精彩，率先填滿目標陣營！`;

        this.showWinModal(title, desc);
    }

    showWinModal(title, desc) {
        this.dom.winTitle.textContent = title;
        this.dom.winDesc.textContent = desc;
        this.dom.winModal.classList.remove('hidden');
    }

    showQRModal() {
        if (this.serverInfo) {
            if (this.serverInfo.qrDataUrl) {
                this.dom.qrImage.src = this.serverInfo.qrDataUrl;
            }
            this.dom.qrUrlText.textContent = this.serverInfo.primaryUrl;
        }
        this.dom.qrRoomCode.textContent = this.roomId || '----';
        this.dom.qrModal.classList.remove('hidden');
    }

    hideModals() {
        this.dom.qrModal.classList.add('hidden');
        this.dom.winModal.classList.add('hidden');
    }

    spawnFloatingReaction(emoji, fromName) {
        const el = document.createElement('div');
        el.className = 'floating-reaction';
        el.textContent = emoji;
        el.style.left = `${20 + Math.random() * 60}%`;
        document.body.appendChild(el);

        setTimeout(() => {
            el.remove();
        }, 2500);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new PocketApp();
});
