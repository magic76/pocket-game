# Pocket Game Hub — Full 10-Game P2P

## Architecture
- Static deployment: GitHub Pages serves `public/` and all bundled JS. No Node/WebSocket server is required for P2P mode; local Termux LAN mode still uses unmodified `server.js`.
- Transport: `public/js/p2p-transport.js` uses PeerJS with public signaling and STUN; the host is the **authoritative browser**. No hosted game database or trusted backend is introduced. PeerJS signaling + browser localStorage can be interrupted or cleared.
- Rules: `p2p-game-rules.js` registers eight existing board engines and validates serialized move intent, including 2/3/4-player turn mapping, castling / en passant, geometry for Blokus and forced passes in Reversi.
- Special games: Bingo maintains per-player randomized/custom cards, automatic marks and line-count/winner logic in host authority; broadcasts filter cards/marks/lines to the viewer role. 築城物語's separate map page uses P2P restore and `p2p-carc-rules.js`, a browser port of the server's terrain/meeple/turn validation functions.
- Common host authority: `p2p-authority.js` handles room creation, join/rejoin, spectators, invalid action rollback through canonical snapshots, restart voting, history, terminal states and persistence. The host's state is saved in localStorage and restored on navigation/reload. Previous schema-1/2 Gomoku and 4-game saves remain readable.
- A guest sees only its own Bingo card over the protocol, **but the host browser knows all cards**. The host can modify JavaScript and cheat; acceptable only for casual games.

## Supported configurations
| Game | Players | Action |
|------|---------|--------|
| 五子棋 | 2 | x, y |
| 黑白棋 | 2 | x, y; auto pass |
| 中國象棋 | 2 | from, to |
| 西洋棋 | 2 | from, to; special moves |
| 六角星跳棋 | 2/3 | fromId, toId |
| 重力四子棋 | 2 | col |
| 終極井字棋 | 2 | mainR, mainC, subR, subC |
| 德國圍棋 | 2/4 | pieceId, shape, origin; pass |
| 賓果 | 2–4 | bingo_setup, bingo_call, bingo_mark |
| 築城物語 | 2–4 | carcassonne_init, carcassonne_sync |

## Automated checks
Run:
```sh
npm ci
npm test
node --check public/js/p2p-authority.js
node --check public/js/p2p-game-rules.js
node --check public/js/p2p-carc-rules.js
node --check public/js/p2p-transport.js
node --check public/js/app.js
```

The extended `test/p2p-full-games.test.cjs` uses the **real browser engines** to check legal/illegal moves, host-only authority, spectators, 3- and 4-player roles, snapshot restore, 4-player restart ballots, Bingo card privacy, Carcassonne terrain/version/tamper guards and game selection via the P2P transport.

## Real-device acceptance (not covered by Node tests)
1. Enable GitHub Pages Source = GitHub Actions, allow the preview branch in `github-pages` deployment policies. Important: publishing from the preview branch shares the same `magic76.github.io/pocket-game/` URL; it is **not** isolated staging.
2. On two physical phones with different cellular/Wi-Fi networks, create and join each of the 10 games. Verify 4-digit numeric room code (1000–9999), QR code, correct game selected and role. Previously generated 8-character room links remain accepted during the local 24-hour host snapshot lifetime.
3. Play valid and invalid moves, rotate/transform pieces and confirm state/turn synchronization. Test 3-player Chinese checkers, 4-player Blokus, Bingo and map, not just 2-player.
4. For Bingo, confirm each client sees only their own card; setup random/custom cards, call/mark, complete five lines and confirm a single winner.
5. For 築城物語, confirm navigation to standalone page preserves host seat; legal tile rotation, placement, meeple scoring, map state version and wrong-turn rejection.
6. Reload host/guest, simulate interrupted mobile network, spectators and restart voting. Test fresh vs known guests with unknown room codes.
7. Run original Termux LAN mode on the same checkout and repeat critical 2-4 player workflows; `server.js` itself was not changed.

## Known limitations
- STUN-only direct connections can fail through restrictive NATs; do not promise reliable global P2P without managed TURN.
- Host authority is browser-based, vulnerable to cheating and host-tab termination. Save recovery lasts up to 24 h only in the same browser/storage.
- Public PeerJS signaling availability is an external dependency, and free P2P is best-effort.
- Art asset licensing and named board-game trademarks require independent review; this PR is a transport refactor, not a legal clearance.


Room codes are short and guessable; treat them as convenience identifiers, not secrets or access control. A guest who guesses an active code may join or spectate. PeerJS signaling may report an occupied ID, in which case a new room code is generated automatically (up to 8 attempts).
