# Pocket Game Hub — Phase 1 P2P overlay

The original `server.js` remains completely unchanged. `public/js/app.js` is a full replacement based on the uploaded app.js, **not** a promise that this overlay matches later commits.

## Install

1. Copy `public/js/p2p-authority.js`, `p2p-transport.js`, `p2p-config.js`, and `app.js` into the repository's `public/js/`. Preserve the original `app.js` first.
2. In `public/index.html`, locate the existing `<script src="js/app.js?v=bingo-lines-3"></script>` and insert the following **before** it, after the existing Gomoku script:

   ```html
   <script src="js/p2p-config.js"></script>
   <script src="js/p2p-authority.js"></script>
   <script src="js/p2p-transport.js"></script>
   ```

3. Deploy Worker from the repository root using `npx wrangler deploy -c wrangler.toml` after adding the overlay's `worker/index.js` and `wrangler.toml`.
4. Replace `REPLACE_WITH_YOUR_WORKER` in `public/js/p2p-config.js` with the actual Worker hostname (on localhost it auto-uses `ws://127.0.0.1:8787` from `wrangler dev`; needs wrangler >= 4.15x / Node 22 for compatibility_date 2026-10-01).
5. Deploy `public/` as the Cloudflare Pages static site. You can also deploy on a dedicated subdomain such as `games.3sssi.com`.
6. Open `/index.html?transport=p2p`. Select Gomoku and create a room. Share `/index.html?transport=p2p&room=ABCDEFGH` (the actual room ID is generated). The other player joins from that link.
7. Run `node test/p2p-authority.test.cjs (also run by npm test)` in the repository. Run existing `npm test` for LAN regressions.

## Modes

- LAN: `/index.html` — original WebSocket / Termux server unchanged, all games.
- Internet: `/index.html?transport=p2p` — Phase 1 Gomoku only. Other games not yet migrated.
- The `P2PSocket` adapter mimics the existing `WebSocket` `send`, `close`, `readyState`, `onmessage` behavior. All board events use existing `room_created`, `room_joined`, `player_joined`, `move_made`, `state_sync`, `restart` and `reaction` protocols.

## Known limitations — NOT production-ready

- No TURN fallback: P2P may fail behind carrier-grade NAT, symmetric NAT, or restrictive corporate networks; supply a managed TURN service with ephemeral credentials before public launch.
- Client needs reliable relay ICE trickling and a connection timeout UI for failed network pairs; this Phase 1 overlay is a prototype.
- If the host closes the tab the room ends; no host migration. Peer reconnection works while host remains and signaling survives, using the existing session resume token.
- Public room IDs are **not secrets**; anyone with an ID can spectate. Four-digit room IDs should not be used for internet deployment.
- `room_created` is sent after host signaling registration. No central room list.
- Spectator display receives public game state; restart voting is supported but without timeout. The host browser can cheat by modifying JS; authoritative host only prevents **guest** forging board state.
- The existing QR modal shows the invite URL but not a working QR bitmap in P2P mode. Add a client QR generator for release.
- `Carcassonne.html` has its own websocket client and is intentionally excluded from Phase 1.
- Current P2P app overlay is based on the provided attachment and should be diff-reviewed against the repository head before merging.
