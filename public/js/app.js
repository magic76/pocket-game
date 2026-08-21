// Main Application Controller & Network Client (8-in-1 Game Hub)
class PocketApp {
    constructor() {
        this.selectedGame = 'gomoku'; // 'gomoku' | 'reversi' | 'xiangqi' | 'chess' | 'checkers' | 'connect4' | 'uttt' | 'blokus'
        this.currentMode = 'online';  // 'online' | 'hotseat' | 'ai'
        this.playerName = localStorage.getItem('pocket_player_name') || '特勤隊員';
        this.hotseatFlip = true;
        this.checkersPlayerCount = 2; // 2 or 3 players
        this.blokusPlayerCount = 2;   // 2 or 4 players

        // Online State
        this.ws = null;
        this.roomId = null;
        this.myRole = null;
        this.roomState = null;

        // Game Engines (8-in-1)
        this.engines = {
            gomoku: new GomokuEngine(15),
            reversi: new ReversiEngine(8),
            xiangqi: new XiangqiEngine(),
            chess: new ChessEngine(),
            checkers: new ChineseCheckersEngine(2),
            connect4: new Connect4Engine(7, 6),
            uttt: new UltimateTicTacToeEngine(),
            blokus: new BlokusEngine(2)
        };

        // Selection states
        this.selectedSquare = null;
        this.currentValidDestinations = [];
        this.selectedHoleId = null;
        this.checkersValidDestinations = [];
        
        // Blokus Piece state
        this.selectedBlokusPieceId = 0;
        this.currentBlokusShape = null;

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
            cardConnect4: document.getElementById('card-connect4'),
            cardUttt: document.getElementById('card-uttt'),
            cardBlokus: document.getElementById('card-blokus'),
            checkersCountBox: document.getElementById('checkers-count-box'),
            blokusCountBox: document.getElementById('blokus-count-box'),
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
        const cards = [
            'cardGomoku', 'cardReversi', 'cardXiangqi', 'cardChess',
            'cardCheckers', 'cardConnect4', 'cardUttt', 'cardBlokus'
        ];
        
        cards.forEach(c => {
            if (this.dom[c]) {
                const isSelected = c.toLowerCase().includes(game.toLowerCase());
                this.dom[c].classList.toggle('selected', isSelected);
            }
        });

        if (this.dom.checkersCountBox) {
            this.dom.checkersCountBox.classList.toggle('hidden', game !== 'checkers');
        }
        if (this.dom.blokusCountBox) {
            this.dom.blokusCountBox.classList.toggle('hidden', game !== 'blokus');
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

    setBlokusCount(count) {
        this.blokusPlayerCount = count;
        document.querySelectorAll('.blokus-pill').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.count, 10) === count);
        });
        this.engines.blokus = new BlokusEngine(count);
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

        this.ws.onerror = () => {
            this.showToast('❌ 連線錯誤');
        };
    }

    createOnlineRoom() {
        this.connectWS(() => {
            const pCount = this.selectedGame === 'checkers' ? this.checkersPlayerCount : 
                          (this.selectedGame === 'blokus' ? this.blokusPlayerCount : 2);
            this.ws.send(JSON.stringify({
                type: 'create_room',
                gameType: this.selectedGame,
                playerCount: pCount,
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
            this.myRole = data.role;
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

            if (this.selectedGame === 'reversi') window.sounds.playFlip();
            else if (this.selectedGame === 'connect4') window.sounds.playDrop();
            else if (this.selectedGame === 'blokus') window.sounds.playSnap();
            else window.sounds.playPlaceStone();

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
            subBoards: engine.subBoards || null,
            mainBoard: engine.mainBoard || null,
            activeBoard: engine.activeBoard !== undefined ? engine.activeBoard : null,
            playerPieces: engine.playerPieces || null,
            nextTurn: engine.turn,
            winner: engine.winner,
            scores: this.selectedGame === 'reversi' ? engine.getCounts() : (this.selectedGame === 'blokus' ? engine.scores : null),
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
        this.showToast('🎮 小桌板同機模式');
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

    handleLocalCellClick(x, y, extra) {
        const engine = this.activeEngine;
        if (engine.winner) return;

        // If AI mode and it's AI turn, block user input
        const isAiTurn = this.currentMode === 'ai' && (
            (this.selectedGame === 'gomoku' && engine.turn === 'white') ||
            (this.selectedGame === 'reversi' && engine.turn === 'white') ||
            (this.selectedGame === 'xiangqi' && engine.turn === 'black') ||
            (this.selectedGame === 'chess' && engine.turn === 'black') ||
            (this.selectedGame === 'checkers' && engine.turn !== 'red') ||
            (this.selectedGame === 'connect4' && engine.turn === 'yellow') ||
            (this.selectedGame === 'uttt' && engine.turn === 'O') ||
            (this.selectedGame === 'blokus' && engine.turn !== 'blue')
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
        } else if (this.selectedGame === 'connect4') {
            const col = x;
            const valid = engine.makeMove(col);
            if (valid) {
                window.sounds.playDrop();
                this.renderLocalBoard();
                if (engine.winner) return this.handleLocalGameOver(engine.winner);
                this.triggerAITurnIfNeeded();
            }
        } else if (this.selectedGame === 'uttt') {
            const { mainR, mainC, subR, subC } = extra;
            const valid = engine.makeMove(mainR, mainC, subR, subC);
            if (valid) {
                window.sounds.playPlaceStone();
                this.renderLocalBoard();
                if (engine.winner) return this.handleLocalGameOver(engine.winner);
                this.triggerAITurnIfNeeded();
            }
        } else if (this.selectedGame === 'blokus') {
            const { originY, originX } = extra;
            const piece = engine.playerPieces[engine.turn].find(p => p.id === this.selectedBlokusPieceId);
            if (!piece || piece.used) return;

            const shape = this.currentBlokusShape || piece.coords;
            const valid = engine.placePiece(this.selectedBlokusPieceId, shape, originY, originX);
            if (valid) {
                window.sounds.playSnap();
                this.selectNextUnusedBlokusPiece();
                this.renderLocalBoard();
                if (engine.winner) return this.handleLocalGameOver(engine.winner);
                this.triggerAITurnIfNeeded();
            }
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
        if (this.currentMode === 'ai' && engine.turn !== 'red') return;

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

        if (this.selectedGame === 'connect4') {
            if (engine.turn === 'yellow' && !engine.winner) {
                setTimeout(() => {
                    const bestCol = engine.getAIMove('yellow');
                    if (bestCol !== null) {
                        engine.makeMove(bestCol);
                        window.sounds.playDrop();
                        this.renderLocalBoard();
                        if (engine.winner) this.handleLocalGameOver(engine.winner);
                    }
                }, 350);
            }
            return;
        }

        if (this.selectedGame === 'uttt') {
            if (engine.turn === 'O' && !engine.winner) {
                setTimeout(() => {
                    const aiMove = engine.getAIMove('O');
                    if (aiMove) {
                        engine.makeMove(aiMove.mainR, aiMove.mainC, aiMove.subR, aiMove.subC);
                        window.sounds.playPlaceStone();
                        this.renderLocalBoard();
                        if (engine.winner) this.handleLocalGameOver(engine.winner);
                    }
                }, 400);
            }
            return;
        }

        if (this.selectedGame === 'blokus') {
            if (engine.turn !== 'blue' && !engine.winner) {
                setTimeout(() => {
                    const aiMove = engine.getAIMove(engine.turn);
                    if (aiMove) {
                        engine.placePiece(aiMove.pieceId, aiMove.shape, aiMove.y, aiMove.x);
                        window.sounds.playSnap();
                    } else {
                        engine.passTurn();
                        this.showToast(`🤖 AI (${engine.turn}) 無子可下，選擇 PASS`);
                    }
                    this.renderLocalBoard();
                    if (engine.winner) {
                        this.handleLocalGameOver(engine.winner);
                    } else {
                        this.triggerAITurnIfNeeded();
                    }
                }, 400);
            }
            return;
        }

        if (this.selectedGame === 'checkers') {
            if (engine.turn !== 'red' && !engine.winner) {
                setTimeout(() => {
                    const aiMove = engine.getAIMove(engine.turn);
                    if (aiMove) {
                        engine.makeMove(aiMove.from, aiMove.to);
                        window.sounds.playPlaceStone();
                        this.renderLocalBoard();
                        if (engine.winner) return this.handleLocalGameOver(engine.winner);
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
                    if (engine.winner) this.handleLocalGameOver(engine.winner);
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
            checkers: `六角星跳棋 (${this.checkersPlayerCount}人局)`,
            connect4: '重力四子棋 (Connect 4)',
            uttt: '終極井字棋 (Ultimate Tic-Tac-Toe)',
            blokus: `德國圍棋 (${this.blokusPlayerCount}人局)`
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
        } else if (this.selectedGame === 'connect4') {
            this.dom.boardContainer.className = 'board-container connect4-board-ratio';
        } else {
            this.dom.boardContainer.className = 'board-container square-board';
        }

        this.dom.scoresBar.classList.toggle('hidden', this.selectedGame !== 'reversi' && this.selectedGame !== 'blokus');
        
        if (this.dom.midPlayerBar) {
            this.dom.midPlayerBar.classList.toggle('hidden', !(this.selectedGame === 'checkers' && this.checkersPlayerCount === 3));
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
        this.drawBoard(engine, (x, y, extra) => this.handleOnlineCellClick(x, y, extra));
        this.updatePlayerStatus();
    }

    renderLocalBoard() {
        const engine = this.activeEngine;
        if (this.selectedGame === 'checkers') {
            this.drawCheckersBoard(engine, (holeId) => this.handleCheckersHoleClick(holeId));
        } else {
            this.drawBoard(engine, (x, y, extra) => this.handleLocalCellClick(x, y, extra));
        }
        this.updatePlayerStatus();
    }

    handleOnlineCellClick(x, y, extra) {
        if (this.myRole === 'spectator') return;
        const engine = this.activeEngine;
        
        if (this.selectedGame === 'gomoku' || this.selectedGame === 'reversi') {
            const valid = engine.makeMove(x, y);
            if (!valid) return;
            this.sendOnlineMovePayload({ x, y });
        } else if (this.selectedGame === 'connect4') {
            const valid = engine.makeMove(x);
            if (valid) this.sendOnlineMovePayload({ col: x });
        } else if (this.selectedGame === 'uttt') {
            const { mainR, mainC, subR, subC } = extra;
            const valid = engine.makeMove(mainR, mainC, subR, subC);
            if (valid) this.sendOnlineMovePayload({ mainR, mainC, subR, subC });
        } else if (this.selectedGame === 'blokus') {
            const { originY, originX } = extra;
            const piece = engine.playerPieces[engine.turn].find(p => p.id === this.selectedBlokusPieceId);
            if (!piece || piece.used) return;
            const shape = this.currentBlokusShape || piece.coords;
            const valid = engine.placePiece(this.selectedBlokusPieceId, shape, originY, originX);
            if (valid) {
                this.selectNextUnusedBlokusPiece();
                this.sendOnlineMovePayload({ pieceId: this.selectedBlokusPieceId, shape, originY, originX });
            }
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
        } else if (this.selectedGame === 'connect4') {
            this.dom.boardEl.className = 'connect4-board';
            this.drawConnect4Board(engine, onCellClick);
        } else if (this.selectedGame === 'uttt') {
            this.dom.boardEl.className = 'uttt-board';
            this.drawUTTTBoard(engine, onCellClick);
        } else if (this.selectedGame === 'blokus') {
            this.drawBlokusBoard(engine, onCellClick);
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

        const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgLayer.setAttribute('class', 'checkers-svg-layer');
        svgLayer.setAttribute('viewBox', '0 0 600 660');

        const cornerPolygons = {
            0: '300,55 220,195 380,195',
            1: '540,195 380,195 460,335',
            2: '540,465 460,325 380,465',
            3: '300,605 380,465 220,465',
            4: '60,465 220,465 140,325',
            5: '60,195 140,335 220,195'
        };

        let baseTints = '';
        if (!is3P) {
            baseTints = `
                <polygon points="${cornerPolygons[0]}" fill="rgba(16,172,132,0.22)" stroke="#10ac84" stroke-width="2" />
                <text x="300" y="145" fill="#10ac84" font-size="13" font-weight="900" text-anchor="middle">🟢 綠方目標</text>
                <polygon points="${cornerPolygons[3]}" fill="rgba(238,82,83,0.22)" stroke="#ee5253" stroke-width="2" />
                <text x="300" y="525" fill="#ee5253" font-size="13" font-weight="900" text-anchor="middle">🔴 紅方目標</text>
                <polygon points="${cornerPolygons[1]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
                <polygon points="${cornerPolygons[2]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
                <polygon points="${cornerPolygons[4]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
                <polygon points="${cornerPolygons[5]}" fill="rgba(124,74,30,0.06)" stroke="rgba(124,74,30,0.25)" stroke-dasharray="3,3" />
            `;
        } else {
            baseTints = `
                <polygon points="${cornerPolygons[3]}" fill="rgba(238,82,83,0.22)" stroke="#ee5253" stroke-width="2" />
                <text x="300" y="525" fill="#ee5253" font-size="13" font-weight="900" text-anchor="middle">🔴 紅方目標</text>
                <polygon points="${cornerPolygons[5]}" fill="rgba(16,172,132,0.22)" stroke="#10ac84" stroke-width="2" />
                <text x="140" y="270" fill="#10ac84" font-size="12" font-weight="900" text-anchor="middle">🟢 綠方目標</text>
                <polygon points="${cornerPolygons[1]}" fill="rgba(46,134,222,0.22)" stroke="#2e86de" stroke-width="2" />
                <text x="460" y="270" fill="#2e86de" font-size="12" font-weight="900" text-anchor="middle">🔵 藍方目標</text>
                <polygon points="${cornerPolygons[0]}" fill="rgba(238,82,83,0.08)" stroke="rgba(238,82,83,0.5)" stroke-dasharray="4,4" />
                <polygon points="${cornerPolygons[2]}" fill="rgba(16,172,132,0.08)" stroke="rgba(16,172,132,0.5)" stroke-dasharray="4,4" />
                <polygon points="${cornerPolygons[4]}" fill="rgba(46,134,222,0.08)" stroke="rgba(46,134,222,0.5)" stroke-dasharray="4,4" />
            `;
        }

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

        let pitsHtml = '';
        for (const h of engine.holes) {
            let strokeColor = '#8b5a2b';
            let fillColor = '#58310f';

            if (!is3P) {
                if (h.cornerId === 3) strokeColor = 'rgba(238,82,83,0.85)';
                else if (h.cornerId === 0) strokeColor = 'rgba(16,172,132,0.85)';
            } else {
                if (h.cornerId === 3) strokeColor = 'rgba(238,82,83,0.85)';
                else if (h.cornerId === 5) strokeColor = 'rgba(16,172,132,0.85)';
                else if (h.cornerId === 1) strokeColor = 'rgba(46,134,222,0.85)';
            }

            pitsHtml += `<circle cx="${h.x}" cy="${h.y}" r="5" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.2" />`;
        }

        svgLayer.innerHTML = `${baseTints}${linesHtml}${pitsHtml}`;
        this.dom.boardEl.appendChild(svgLayer);

        const destMap = new Map(this.checkersValidDestinations.map(d => [d.targetId, d]));

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

    drawConnect4Board(engine, onColClick) {
        this.dom.boardEl.innerHTML = '';
        const cols = engine.cols;
        const rows = engine.rows;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = document.createElement('div');
                cell.className = 'connect4-cell';

                const discColor = engine.board[r][c];
                if (discColor) {
                    const disc = document.createElement('div');
                    disc.className = `connect4-disc ${discColor}`;
                    if (engine.winningCells && engine.winningCells.some(w => w.r === r && w.c === c)) {
                        disc.classList.add('winning');
                    }
                    cell.appendChild(disc);
                }

                cell.addEventListener('click', () => onColClick(c, r));
                this.dom.boardEl.appendChild(cell);
            }
        }
    }

    drawUTTTBoard(engine, onCellClick) {
        this.dom.boardEl.innerHTML = '';

        for (let mr = 0; mr < 3; mr++) {
            for (let mc = 0; mc < 3; mc++) {
                const subBoardEl = document.createElement('div');
                const isTarget = engine.activeBoard !== null && engine.activeBoard.mainR === mr && engine.activeBoard.mainC === mc;
                const isFreeTarget = engine.activeBoard === null && engine.mainBoard[mr][mc] === null;
                subBoardEl.className = `uttt-sub-board ${(isTarget || isFreeTarget) && !engine.winner ? 'active-target' : ''}`;

                // 3x3 small cells
                for (let sr = 0; sr < 3; sr++) {
                    for (let sc = 0; sc < 3; sc++) {
                        const cell = document.createElement('div');
                        const mark = engine.subBoards[mr][mc][sr][sc];
                        cell.className = `uttt-sub-cell ${mark || ''}`;
                        cell.textContent = mark || '';

                        cell.addEventListener('click', () => {
                            onCellClick(sc, sr, { mainR: mr, mainC: mc, subR: sr, subC: sc });
                        });
                        subBoardEl.appendChild(cell);
                    }
                }

                // If sub-board is won or drawn, render big watermark
                const subWon = engine.mainBoard[mr][mc];
                if (subWon) {
                    const overlay = document.createElement('div');
                    overlay.className = `uttt-won-overlay ${subWon}`;
                    overlay.textContent = subWon === 'draw' ? '—' : subWon;
                    subBoardEl.appendChild(overlay);
                }

                this.dom.boardEl.appendChild(subBoardEl);
            }
        }
    }

    drawBlokusBoard(engine, onCellClick) {
        this.dom.boardEl.innerHTML = '';
        this.dom.boardEl.className = 'blokus-container';

        // 1. Controls Row (Rotate, Flip, Pass)
        const ctrlRow = document.createElement('div');
        ctrlRow.className = 'blokus-controls-row';
        ctrlRow.innerHTML = `
            <div style="display: flex; gap: 6px;">
                <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="window.app.rotateBlokusPiece()">🔄 旋轉 90°</button>
                <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="window.app.flipBlokusPiece()">⇄ 翻轉</button>
            </div>
            <button class="btn-primary" style="padding: 6px 14px; font-size: 0.8rem; background: #dc2626;" onclick="window.app.passBlokusTurn()">⏭️ PASS (無子可下)</button>
        `;
        this.dom.boardEl.appendChild(ctrlRow);

        // 2. Main Grid
        const gridEl = document.createElement('div');
        gridEl.className = 'blokus-board';
        gridEl.style.gridTemplateColumns = `repeat(${engine.size}, 1fr)`;
        gridEl.style.gridTemplateRows = `repeat(${engine.size}, 1fr)`;

        const startPoints = engine.startPoints[engine.turn] || [];
        const isFirst = engine.isFirstMove(engine.turn);

        for (let y = 0; y < engine.size; y++) {
            for (let x = 0; x < engine.size; x++) {
                const cell = document.createElement('div');
                const color = engine.board[y][x];
                const isStart = isFirst && startPoints.some(pt => pt.x === x && pt.y === y);

                cell.className = `blokus-cell ${color || ''} ${isStart ? 'start-point' : ''}`;

                cell.addEventListener('click', () => {
                    onCellClick(x, y, { originY: y, originX: x });
                });

                gridEl.appendChild(cell);
            }
        }
        this.dom.boardEl.appendChild(gridEl);

        // 3. Piece Drawer / Tray
        const trayEl = document.createElement('div');
        trayEl.className = 'blokus-tray';

        const myPieces = engine.playerPieces[engine.turn] || [];
        myPieces.forEach(p => {
            const pieceBox = document.createElement('div');
            pieceBox.className = `blokus-mini-piece ${p.id === this.selectedBlokusPieceId ? 'selected' : ''} ${p.used ? 'used' : ''}`;

            const shape = (p.id === this.selectedBlokusPieceId && this.currentBlokusShape) ? this.currentBlokusShape : p.coords;
            pieceBox.appendChild(this.renderMiniPolyominoSVG(shape, engine.turn));

            pieceBox.addEventListener('click', () => {
                this.selectedBlokusPieceId = p.id;
                this.currentBlokusShape = BlokusEngine.normalize(p.coords);
                window.sounds.playPing();
                this.renderCurrentBoard();
            });

            trayEl.appendChild(pieceBox);
        });
        this.dom.boardEl.appendChild(trayEl);

        // Update scores
        if (engine.scores) {
            this.dom.blackScore.textContent = engine.scores.blue !== undefined ? engine.scores.blue : 0;
            this.dom.whiteScore.textContent = engine.scores.orange !== undefined ? engine.scores.orange : 0;
        }
    }

    renderMiniPolyominoSVG(coords, color) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const colorMap = { blue: '#0284c7', orange: '#ea580c', yellow: '#ca8a04', green: '#16a34a', red: '#dc2626' };
        const fill = colorMap[color] || '#38bdf8';

        let maxX = 0, maxY = 0;
        coords.forEach(([y, x]) => {
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        });

        const cellSize = 8;
        svg.setAttribute('width', (maxX + 1) * cellSize + 2);
        svg.setAttribute('height', (maxY + 1) * cellSize + 2);

        let rects = '';
        coords.forEach(([y, x]) => {
            rects += `<rect x="${x * cellSize + 1}" y="${y * cellSize + 1}" width="${cellSize - 1}" height="${cellSize - 1}" rx="1" fill="${fill}" stroke="#fff" stroke-width="0.5" />`;
        });
        svg.innerHTML = rects;
        return svg;
    }

    rotateBlokusPiece() {
        if (!this.currentBlokusShape) {
            const p = this.activeEngine.playerPieces[this.activeEngine.turn]?.find(p => p.id === this.selectedBlokusPieceId);
            if (p) this.currentBlokusShape = BlokusEngine.normalize(p.coords);
        }
        if (this.currentBlokusShape) {
            this.currentBlokusShape = BlokusEngine.rotate(this.currentBlokusShape);
            window.sounds.playPing();
            this.renderCurrentBoard();
        }
    }

    flipBlokusPiece() {
        if (!this.currentBlokusShape) {
            const p = this.activeEngine.playerPieces[this.activeEngine.turn]?.find(p => p.id === this.selectedBlokusPieceId);
            if (p) this.currentBlokusShape = BlokusEngine.normalize(p.coords);
        }
        if (this.currentBlokusShape) {
            this.currentBlokusShape = BlokusEngine.flip(this.currentBlokusShape);
            window.sounds.playPing();
            this.renderCurrentBoard();
        }
    }

    passBlokusTurn() {
        if (this.selectedGame !== 'blokus') return;
        const engine = this.activeEngine;
        engine.passTurn();
        this.selectNextUnusedBlokusPiece();
        this.renderLocalBoard();
        this.showToast(`⏩ ${engine.turn} 選擇 PASS`);
        if (engine.winner) {
            this.handleLocalGameOver(engine.winner);
        } else {
            this.triggerAITurnIfNeeded();
        }
    }

    selectNextUnusedBlokusPiece() {
        const engine = this.activeEngine;
        const unused = engine.playerPieces[engine.turn]?.filter(p => !p.used);
        if (unused && unused.length > 0) {
            this.selectedBlokusPieceId = unused[0].id;
            this.currentBlokusShape = BlokusEngine.normalize(unused[0].coords);
        }
    }

    updatePlayerStatus() {
        const engine = this.activeEngine;
        const currentTurn = engine.turn;

        if (this.selectedGame === 'connect4') {
            this.dom.topPlayerName.textContent = '🟡 玩家二 (黃子)';
            this.dom.bottomPlayerName.textContent = '🔴 玩家一 (紅子)';
            this.updateTurnPills(currentTurn === 'yellow', currentTurn === 'red');
            return;
        }

        if (this.selectedGame === 'uttt') {
            this.dom.topPlayerName.textContent = '⭕ 玩家二 (O 藍橘)';
            this.dom.bottomPlayerName.textContent = '❌ 玩家一 (X 霓虹藍)';
            this.updateTurnPills(currentTurn === 'O', currentTurn === 'X');
            return;
        }

        if (this.selectedGame === 'blokus') {
            this.dom.topPlayerName.textContent = '🟠 玩家二 (橙方)';
            this.dom.bottomPlayerName.textContent = '🔵 玩家一 (藍方)';
            this.updateTurnPills(currentTurn === 'orange', currentTurn === 'blue');
            return;
        }

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
        else if (winner === 'yellow') winnerName = '黃方';
        else if (winner === 'orange') winnerName = '橙方';
        else if (winner === 'X') winnerName = '玩家一 (X)';
        else if (winner === 'O') winnerName = '玩家二 (O)';
        else if (winner === 'draw') winnerName = '平局和局';

        const title = winner === 'draw' ? '🤝 雙方握手言和！' : `🏆 ${winnerName} 獲勝！`;
        const desc = `${winnerName} 表現精彩奪得勝利！`;
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
