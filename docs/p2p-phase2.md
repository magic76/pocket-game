# P2P phase 2 (local integration notes)

Base: `p2p/phase1` (09b455a) + ChatGPT phase-2 overlay (`pocket-p2p-phase2.zip`). LAN (`server.js`, default transport) unchanged.

## Run locally
- `npm test` (Node 20 OK).
- Worker (serves `public/` + `/signal/<CODE>` + `/turn-credentials`): needs Node 22 → `npm run p2p:dev` (wrangler 4.86.0), open `http://127.0.0.1:8787/?transport=p2p`.
- `?transport=p2p` forces P2P, `?transport=ws` forces LAN; P2P is the default only on hosts listed in `p2p-config.js` (`*.workers.dev`).

## Integration changes on top of the overlay
- Kept phase-1 fixes: text/uppercase 8-char room input, ⚠️/❌ toasts, `.wrangler/` ignored, test path, localhost → `ws://127.0.0.1:8787` fallback in `p2p-config.js`; original CommonJS `package.json` kept (only `p2p:dev` / `p2p:deploy` scripts added).
- `public/vendor/qrcode.min.js`: browser IIFE bundle of npm `qrcode@1.5.4` (exposes `QRCode.toDataURL`), so invite QR works offline without a third-party API.
- `p2p-transport.js`: one pending RTCPeerConnection per peer id (offer + ICE candidates raced two PCs → orphan PC → spurious "P2P 連線逾時" toast and host-leave not detected); guest with an open DataChannel does not re-register after a signaling reconnect (re-register triggered a new offer that broke the live channel); ICE `failed` counts as disconnected even if the channel still says open.
- `app.js`: guest URL keeps `?room=CODE` after join (reload resumes the seat even if the code was typed), removed on leave / room ended; host `pagehide` sends `leave_room` so guests get "房主已離開，房間已結束" immediately.
- `worker/index.js`: `/turn-credentials` accepted for same-origin GET without `Origin` header (`Sec-Fetch-Site: same-origin`) — browsers omit Origin there, so it always 403'd.

## Tests
Playwright scripts outside the repo: `/workspace/p2p-test/pw/p2p-phase2.mjs`, `p2p-hostclose.mjs`, `lan.mjs`.
