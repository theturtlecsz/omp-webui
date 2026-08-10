#!/usr/bin/env bash
# Clean-clone launch test: clone the repo into a temp dir, install, build, boot the
# daemon, and verify the web app + health endpoint respond. Requires: bun, git, omp.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d /tmp/omp-webui-clean-clone-XXXXXX)"
PORT="${PORT:-7495}"
trap 'rm -rf "$TMP"' EXIT

echo "== cloning $SRC -> $TMP"
git clone -q "file://$SRC" "$TMP/repo"
cd "$TMP/repo"

echo "== installing"
export PATH="$HOME/.bun/bin:$PATH"
bun install --silent
(cd packages/daemon && bun install --silent)
(cd packages/web && bun install --silent)

echo "== building web"
(cd packages/web && bun run build >/dev/null)

echo "== booting daemon on :$PORT"
bun packages/daemon/src/index.ts --port "$PORT" --web-dist packages/web/dist &
DPID=$!
trap 'kill $DPID 2>/dev/null || true; rm -rf "$TMP"' EXIT

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

echo "== verifying"
curl -sf "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true' && echo "  health: OK"
curl -sf "http://127.0.0.1:$PORT/" | grep -qi "<div id=\"root\"" && echo "  index.html: OK"
JS=$(curl -sf "http://127.0.0.1:$PORT/" | grep -o 'assets/index-[^"]*\.js' | head -1)
curl -sf "http://127.0.0.1:$PORT/$JS" -o /dev/null && echo "  bundle: OK ($JS)"

echo "CLEAN-CLONE LAUNCH: PASS"
