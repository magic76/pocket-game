// P2P (?transport=p2p) endpoints.
// Default: same origin — the Worker in wrangler.toml serves public/ plus /signal/* and /turn-credentials.
// Local dev: if the page is served from localhost on a port other than wrangler dev's :8787
// (e.g. a plain static server), signaling falls back to ws://127.0.0.1:8787.
// Separate Worker deployment: set POCKET_SIGNAL_URL='wss://<worker>.workers.dev' and
// POCKET_TURN_ENDPOINT='https://<worker>.workers.dev/turn-credentials' (and add the page origin to ALLOWED_ORIGINS).
(function(){
  const local=/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const sameOrigin=(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host;
  const devWorker=local&&location.port!=='8787';
  window.POCKET_SIGNAL_URL=window.POCKET_SIGNAL_URL||(devWorker?'ws://127.0.0.1:8787':sameOrigin);
  window.POCKET_TURN_ENDPOINT=window.POCKET_TURN_ENDPOINT||(devWorker?'http://127.0.0.1:8787/turn-credentials':'/turn-credentials');
  // Hosts where P2P is the default without ?transport=p2p (the Worker-served deployment). Add your domain here.
  const p2pHosts=[/\.workers\.dev$/];
  if(window.POCKET_P2P_DEFAULT===undefined)window.POCKET_P2P_DEFAULT=p2pHosts.some(r=>r.test(location.hostname));
})();
