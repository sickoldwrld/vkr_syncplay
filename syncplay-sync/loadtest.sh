#!/usr/bin/env bash
# Load-test runner for syncplay-sync (main master-slave service).
#
# Brings up the service in BENCH_AUTH mode on a dedicated port so the test
# doesn't interfere with a running production process, then drives load
# from sim/loadtest.ts and shuts the service down.
#
#   ./loadtest.sh                              # default 5 rooms × 10 clients, 60s, ramp
#   ROOMS=20 CLIENTS=10 DURATION_S=300 ./loadtest.sh
#   SCENARIO=spike ./loadtest.sh
#
# If you already have syncplay-sync running with BENCH_AUTH=1 elsewhere, point
# at it with EXTERNAL=1 — the script will skip its own service boot.
#   EXTERNAL=1 URL=ws://localhost:3002 ./loadtest.sh
#
# Override resource sampling target:
#   SERVER_PID=<pid> ./loadtest.sh
#
# Override CSV output:
#   CSV=/tmp/loadtest.csv ./loadtest.sh

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3092}"           # dedicated load-test port, ≠ prod :3002
DURATION_S="${DURATION_S:-60}"
ROOMS="${ROOMS:-5}"
CLIENTS="${CLIENTS:-10}"
SCENARIO="${SCENARIO:-ramp}"
EXTERNAL="${EXTERNAL:-0}"
URL="${URL:-ws://localhost:${PORT}}"

[ -d node_modules ] || npm ci

if [ "$EXTERNAL" != "1" ]; then
  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ port :${PORT} already in use. Set EXTERNAL=1 to use the running service." >&2
    exit 1
  fi
  echo "→ booting syncplay-sync on :${PORT} (BENCH_AUTH=1)"
  BENCH_AUTH=1 PORT="${PORT}" \
    npx ts-node-dev --respawn --transpile-only src/index.ts \
    > /tmp/loadtest-sync.log 2>&1 &
  SERVICE_PID=$!
  trap 'kill ${SERVICE_PID} 2>/dev/null || true' EXIT

  # Wait until it's listening.
  for i in $(seq 1 30); do
    if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  if ! lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ service did not start; see /tmp/loadtest-sync.log" >&2
    tail -20 /tmp/loadtest-sync.log >&2
    exit 1
  fi
  echo "✓ service ready (pid ${SERVICE_PID}); driving load"
  export SERVER_PID="${SERVER_PID:-$SERVICE_PID}"
fi

URL="${URL}" \
ROOMS="${ROOMS}" CLIENTS="${CLIENTS}" \
DURATION_S="${DURATION_S}" SCENARIO="${SCENARIO}" \
SERVER_PID="${SERVER_PID:-}" \
CSV="${CSV:-}" \
PING_MS="${PING_MS:-800}" PHASE_MS="${PHASE_MS:-250}" \
MODE="${MODE:-master}" \
  npx ts-node --transpile-only sim/loadtest.ts
