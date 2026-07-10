#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOCAL_HOST="${LOCAL_HOST:-127.0.0.1}"
VITE_API_BASE="${VITE_API_BASE:-http://$LOCAL_HOST:$BACKEND_PORT}"
DATABASE_PATH="${DATABASE_PATH:-$BACKEND_DIR/data/genesis.db}"

BACKEND_PID=""
FRONTEND_PID=""

usage() {
  cat <<'EOF'
Usage: ./start-local.sh [rebuild]

  rebuild  Force a backend rebuild before starting.

Optional environment variables:
  BACKEND_PORT, FRONTEND_PORT, LOCAL_HOST, VITE_API_BASE, DATABASE_PATH
EOF
}

case "${1:-}" in
  ""|rebuild)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required." >&2
  exit 1
fi

install_dependencies() {
  local directory="$1"
  local name="$2"
  local marker="$3"

  if [[ -e "$directory/$marker" ]]; then
    return
  fi

  echo "$name dependencies not found. Installing from package-lock.json..."
  (
    cd "$directory"
    if [[ "$name" == "Backend" ]] && [[ -z "${PYTHON:-}" ]] && \
      /usr/bin/python3 -c 'import distutils' >/dev/null 2>&1; then
      echo "Using /usr/bin/python3 for native Node modules."
      PYTHON=/usr/bin/python3 npm ci --no-audit --no-fund
    else
      npm ci --no-audit --no-fund
    fi
  )
}

stop_services() {
  trap - EXIT INT TERM

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  [[ -z "$FRONTEND_PID" ]] || wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || wait "$BACKEND_PID" 2>/dev/null || true
}

trap stop_services EXIT INT TERM

mkdir -p "$(dirname "$DATABASE_PATH")" "$BACKEND_DIR/uploads/payment-proofs"

install_dependencies "$BACKEND_DIR" "Backend" "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
install_dependencies "$FRONTEND_DIR" "Frontend" "node_modules/.bin/vite"

if [[ "${1:-}" == "rebuild" || ! -f "$BACKEND_DIR/dist/main.js" ]]; then
  echo "Building backend..."
  (
    cd "$BACKEND_DIR"
    npm run build
  )
fi

echo "Starting CSI local services..."
echo "Backend:  http://$LOCAL_HOST:$BACKEND_PORT"
echo "Frontend: http://$LOCAL_HOST:$FRONTEND_PORT"
echo "Database: $DATABASE_PATH"
echo "Press Ctrl-C to stop both services."
echo

(
  cd "$BACKEND_DIR"
  exec env \
    PORT="$BACKEND_PORT" \
    DATABASE_PATH="$DATABASE_PATH" \
    DB_SYNC="${DB_SYNC:-true}" \
    AUTO_EXECUTION_ENABLED=false \
    LEGACY_RUNTIME_WEBHOOKS_ENABLED=false \
    LEGACY_TASK_WEBHOOKS_ENABLED=false \
    npm run start:prod
) &
BACKEND_PID=$!

(
  cd "$FRONTEND_DIR"
  exec env \
    VITE_API_BASE="$VITE_API_BASE" \
    npm run dev -- --host "$LOCAL_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  set +e
  wait "$BACKEND_PID"
  status=$?
  set -e
  echo "Backend stopped (exit $status)." >&2
  exit "$status"
fi

set +e
wait "$FRONTEND_PID"
status=$?
set -e
echo "Frontend stopped (exit $status)." >&2
exit "$status"
