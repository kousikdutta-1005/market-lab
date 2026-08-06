#!/usr/bin/env bash
# market-lab launcher — build the UI, start the local backend, open the browser.
#
# Fully local. No deployment, no public URL, no credentials, no broker.
# The backend exists so the Refresh button in the UI can actually run the pipeline;
# it serves the built site too, so there is only one thing to start.
#
#   ./run.sh             build if needed, serve, open browser
#   ./run.sh --refresh   pull the latest bhavcopy and rescore before serving
#   ./run.sh --port N    serve on a different port

set -euo pipefail
cd "$(dirname "$0")"

PORT=8787
REFRESH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --refresh) REFRESH=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
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
  echo "==> Refreshing market data (this hits NSE; takes a minute on a cold cache)"
  "$PY" -c 'from marketlab import pipeline; pipeline.run()'
fi

pushd web >/dev/null
[[ -d node_modules ]] || { echo "==> Installing web dependencies"; npm install --silent; }
if [[ "$REFRESH" == "1" || ! -d dist ]]; then
  echo "==> Building UI"
  npm run build >/dev/null
fi
popd >/dev/null

if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Stop that process or pass --port N." >&2
  exit 1
fi

echo "==> Serving http://localhost:$PORT  (Ctrl-C to stop)"
ML_PORT="$PORT" "$PY" server.py >/tmp/market-lab-serve.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then
    command -v open >/dev/null 2>&1 && open "http://localhost:$PORT/"
    break
  fi
  sleep 0.25
done

wait $SERVER_PID
