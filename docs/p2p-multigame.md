# GitHub Pages / PeerJS — first additional multiplayer games

Base: `p2p/round4`. Scope: P2P host authority and existing web client, with no change to LAN `server.js`, game rules or original game internals.

## Supported on P2P
- 五子棋 `gomoku`: 15×15, x/y.
- 黑白棋 `reversi`: 8×8, x/y, forced-pass, score counts.
- 重力四子棋 `connect4`: 7×6, column, four-in-a-row/draw.
- 終極井字棋 `uttt`: 3×3×3×3, target sub-board and free-move rules.

Host browser owns the `PocketGameAuthority` rule engine and publishes accepted state. Guest can send only move intent. Turn-to-room-role mappings: black/white, red/yellow, X/O respectively. Bad or out-of-turn moves are rejected, and the guest receives authoritative state. The `PocketGomokuAuthority` alias and saved schema-1 Gomoku rooms stay compatible.

Other six games remain intentionally blocked for P2P room creation until they receive their own rule adapters. LAN and local/AI flows are unaffected.

## Tests
Run `npm test` (includes `test/p2p-multigame.test.cjs`) and `node --check public/js/p2p-authority.js`, `node --check public/js/p2p-transport.js`, `node --check public/js/app.js`.

## Two-phone acceptance (Pages URL, HTTPS)
1. Create each of the four game types; scan/open invitation on a second phone (different cellular/Wi-Fi connections). Verify correct game title, 8-character room ID and both players.
2. For each game, make two alternate moves; reject illegal placements, occupied cells, wrong-turn moves and spectators' inputs; confirm identical board/turn on both phones.
3. Reversi: check a flip and scores, and a later automatic pass if encountered. Connect4: win four aligned pieces. Ultimate Tic-Tac-Toe: next-move required sub-board and free move after a finished sub-board.
4. Reload host and guest independently; verify seat recovery, board and turn stay intact. Disconnect mobile network and reconnect. Check 75-second offline deadline if the host disappears.
5. Request restart from one phone; confirm second phone must vote to reset. Test game-over and return to lobby.
6. Confirm LAN/Termux still plays all ten games; verify P2P politely blocks chess/checkers/Blokus/bingo/築城物語 and does not silently create a Gomoku room.

Deployment note: the GitHub Pages workflow is on `p2p/round4` and publishes `public/` to the same site URL; merging this PR to that branch alone does not prove that the Pages environment accepted the deployment. PeerJS public signaling is third-party, and STUN-only connections may fail without TURN. Host is authoritative but not tamper-proof.
