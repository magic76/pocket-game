# P2P round 4 — GitHub Pages + PeerJS public signaling

- Static site: `public/` published by `.github/workflows/pages.yml` (GitHub Actions Pages) to
  `https://magic76.github.io/pocket-game/`. All asset URLs are relative, so the `/pocket-game/` subpath works.
- Signaling: free public PeerJS server `0.peerjs.com` (key `peerjs`), configured in `public/js/p2p-config.js`
  (`POCKET_PEER_CONFIG`). ICE: STUN only by default; optional TURN entries in `POCKET_TURN_SERVERS`
  (do not commit private/permanent credentials — the repo and site are public).
- PeerJS 1.5.5 is vendored at `public/vendor/peerjs.min.js` (MIT, `public/vendor/peerjs-LICENSE.txt`); no CDN,
  no fetch step in the workflow. `scripts/vendor-peerjs.sh` re-vendors it (needs npm network).
- Host peer id: `pocketgame-v1-<CODE>`; guests: `pocketgame-v1-guest-<random>`. Host browser is the authority
  (`p2p-authority.js`). Host snapshot `pocket_p2p_host_<CODE>` and guest view cache `pocket_p2p_view_<CODE>` are
  purged after 24 h; a localStorage soft-lock warns when a second tab tries to restore the same host room.
- Default transport: P2P on `*.github.io` and `*.workers.dev`; elsewhere LAN (`server.js`). `?transport=p2p` / `?transport=ws` force.
- Guest waits up to 75 s for a known host (saved seat or connected earlier); a fresh guest with an unknown code
  gives up after 25 s with “找不到房間，或房主目前不在線”.
- The Cloudflare Worker (`worker/`, `wrangler.toml`) is kept as optional self-hosted signaling but is unused by default.

## Enabling Pages (owner)
1. Push the branch (`main`, or the preview branch `p2p/round4`, both are workflow triggers).
2. Enable Pages with the Actions source once: `gh api -X POST repos/magic76/pocket-game/pages -f build_type=workflow`
   (or Settings → Pages → Source: GitHub Actions).
3. Deploying from a non-default branch: the `github-pages` environment only allows the default branch by
   default. Allow the preview branch with
   `gh api -X POST repos/magic76/pocket-game/environments/github-pages/deployment-branch-policies -f name=p2p/round4 -f type=branch`
   (the environment exists after step 2 / the first run). `workflow_dispatch` only appears once the workflow file is on `main`.
