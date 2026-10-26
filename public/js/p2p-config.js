// Signaling Worker endpoint for ?transport=p2p.
// Local dev (`npx wrangler dev` on :8787) is used automatically when the page is served from localhost.
// Production: set to the deployed Worker, e.g. 'wss://pocket-game-signal.YOUR-SUBDOMAIN.workers.dev'
window.POCKET_SIGNAL_URL = window.POCKET_SIGNAL_URL || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'ws://127.0.0.1:8787'
    : 'wss://REPLACE_WITH_YOUR_WORKER.workers.dev');
