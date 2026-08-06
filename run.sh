#!/usr/bin/env bash
# market-lab launcher — refresh data, build, serve locally, open browser.
#
# Fully local. No deployment, no public URL, no credentials, no broker.
#
#   ./run.sh            serve the existing build (offline, instant)
#   ./run.sh --refresh  re-fetch market data first (needs internet)
#   ./run.sh --port N   serve on a different port

set -euo pipefail
cd "$(dirname "$0")"

PORT=5177
REFRESH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --refresh) REFRESH=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# Locate node, which is often only on PATH inside an interactive shell.
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "$candidate/node" ]]; then export PATH="$candidate:$PATH"; break; fi
  done
fi
command -v node >/dev/null 2>&1 || { echo "node not found. Install Node 20+ and retry." >&2; exit 1; }

PY=./.venv/bin/python
[[ -x "$PY" ]] || { echo "Missing .venv. Run: python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt" >&2; exit 1; }

if [[ "$REFRESH" == "1" ]]; then
  echo "==> Checking data sources"
  "$PY" check_health.py || echo "    (some sources unreachable — continuing with cached data)"
  echo "==> Rebuilding scores"
  "$PY" build_screen.py
fi

cd web
[[ -d node_modules ]] || { echo "==> Installing web dependencies"; npm install --silent; }

if [[ "$REFRESH" == "1" || ! -d dist ]]; then
  echo "==> Building"
  npm run build >/dev/null
fi

echo "==> Serving http://localhost:$PORT  (Ctrl-C to stop)"
npx --yes vite preview --port "$PORT" --outDir dist >/tmp/market-lab-serve.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then
    command -v open >/dev/null 2>&1 && open "http://localhost:$PORT/"
    break
  fi
  sleep 0.25
done

wait $SERVER_PID
