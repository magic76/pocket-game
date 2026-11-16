# Pocket P2P Round 3

This patch is based exclusively on the provided `pocket-p2p-round3-base.zip` (commit `f2639e3`), preserving the phase2 fixes, local QR generator expectation, CommonJS package.json, LAN paths, and the `making` peer-creation guard.

## Deployment

Requires Node >=22 for Wrangler 4.86. From the full repository checkout, merge these files, retain existing `server.js`, engines, vendor QR library, styles and tests, then run `npm test` and `npm run p2p:dev`. The supplied source ZIP contains only a selection of project files, not the rest of the repo.

Cloudflare TURN:

```
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

The Worker caches returned ICE servers for 5 minutes per isolate and returns STUN-only on missing secrets or vendor errors. The 24h TTL is managed by Cloudflare; TURN credentials are never persisted in the browser. Rate limit is 30 `/signal/*` upgrade attempts per IP per 60 seconds per Cloudflare location (`SIGNAL_RATE_LIMIT`, namespace 1001). Replace namespace ID if shared with other Workers. Check actual costs and rate behavior on your Cloudflare account. `ALLOWED_ORIGINS` remains the supplied placeholder; change it to the actual deployment origins. Keep same-origin `/turn-credentials` and the bundled `public/vendor/qrcode.min.js` in the *full repo*.

## Host recovery

After every accepted move, restart, join, departure and initially on creation, the authority state and host secret are written under `localStorage['pocket_p2p_host_'+roomId]`. A host reopening the bookmarked room URL restores the local authority and re-registers with the same secret. The guest's persisted resume token restores their seat. Closing a tab is deliberately not treated as intentional leave, because browser `pagehide` cannot reliably distinguish close from reload or mobile page eviction; explicit 'Return to Lobby' ends the room. Guest has a bounded ~75-second reconnect window if signaling reports `host_offline`.

**Known limitations:** localStorage is device/browser-specific; private storage clearing loses authority. Tab closure without explicit leave leaves a reserved room until alarm expiry. Sleeping phones cannot promise uninterrupted connectivity. All TURN failure traffic falls back to STUN and some NAT combinations remain unreachable. State is not server-authenticated, so cheating host remains possible. Room engine remains Gomoku-only. The rate-limit binding protects upgrades but does not yet enforce per-room message frequency or robust distributed abuse resistance. Room status upon authority restore may wait for the guest to reconnect. Host snapshot handling has no multi-tab leader lock. Remote network Playwright, LAN and complete `npm test` require the rest of the project and aren't verified using this partial source archive.

## Local integration notes (p2p/round3)
- Merged onto `p2p/phase2` f2639e3; all phase-1/phase-2 fixes kept (single pending PC per peer, no guest re-register while DataChannel open, `?room=` in URL, same-origin `/turn-credentials`, ICE failed = disconnected, vendored QR).
- Host URL now also gets `?room=CODE` on `room_created` — without it the host-restore entry (which keys off `?room=`) never ran after a reload.
- `pagehide` on the host sends `host_paused` (not `leave_room`): guests immediately show "⚠️ 房主離開了頁面，等待返回中（約 75 秒後結束房間）…", the 75 s window starts, and a host reload restores normally. Closing the tab therefore ends the room for guests after ~85–90 s; only 返回大廳 ends it immediately.
- `⚠️` notices from the transport are shown without the `❌` prefix and for 10 s.
- `npm test` now also runs `test/p2p-round3.test.cjs`.
- `wrangler dev` 4.86 enforces the `SIGNAL_RATE_LIMIT` binding locally (40 rapid upgrades → 30 accepted, 10 × 429); normal play in the test suites produced no 429.
