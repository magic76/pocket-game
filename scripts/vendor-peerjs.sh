#!/usr/bin/env bash
set -euo pipefail
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
npm pack peerjs@1.5.5 --pack-destination "$TEMP_DIR"
tar -xzf "$TEMP_DIR/peerjs-1.5.5.tgz" -C "$TEMP_DIR"
cp "$TEMP_DIR/package/dist/peerjs.min.js" public/vendor/peerjs.min.js
printf 'Bundled official PeerJS 1.5.5 into public/vendor/peerjs.min.js\n'
