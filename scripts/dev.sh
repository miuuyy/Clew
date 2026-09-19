#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
BACKEND_PORT=8787
FRONTEND_PORT=5178
BACKEND_PYPROJECT="$ROOT_DIR/backend/pyproject.toml"
BACKEND_STAMP="$VENV_DIR/.backend_editable_installed"
FRONTEND_PACKAGE_JSON="$ROOT_DIR/frontend/package.json"
FRONTEND_LOCKFILE="$ROOT_DIR/frontend/package-lock.json"
FRONTEND_STAMP="$ROOT_DIR/frontend/node_modules/.install_stamp"

choose_python() {
  local candidate
  for candidate in /opt/homebrew/bin/python3.12 python3.12 /opt/homebrew/bin/python3.11 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

choose_node_bin_dir() {
  if [[ -x "/opt/homebrew/opt/node@22/bin/node" && -x "/opt/homebrew/opt/node@22/bin/npm" ]]; then
    printf '%s\n' "/opt/homebrew/opt/node@22/bin"
    return 0
  fi
  local node_path
  node_path="$(command -v node)"
  dirname "$node_path"
}

PYTHON_BIN="$(choose_python)"
NODE_BIN_DIR="$(choose_node_bin_dir)"
PATH="$NODE_BIN_DIR:$PATH"

wait_for_listener() {
  local port="$1"
  local timeout_seconds="${2:-12}"
  local elapsed=0
  while (( elapsed < timeout_seconds * 10 )); do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
elif ! "$VENV_DIR/bin/python" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
  echo "The existing .venv needs Python 3.11 or newer. Recreate it explicitly before starting Clew." >&2
  exit 1
fi

source "$VENV_DIR/bin/activate"

export PIP_DISABLE_PIP_VERSION_CHECK=1
if ! python -c 'import pip' >/dev/null 2>&1; then
  python -m ensurepip --upgrade >/dev/null
fi
if [[ ! -f "$BACKEND_STAMP" || "$BACKEND_PYPROJECT" -nt "$BACKEND_STAMP" ]]; then
  python -m pip install -e "$ROOT_DIR/backend" >/dev/null
  touch "$BACKEND_STAMP"
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]] \
  || [[ ! -f "$FRONTEND_STAMP" ]] \
  || [[ "$FRONTEND_PACKAGE_JSON" -nt "$FRONTEND_STAMP" ]] \
  || [[ -f "$FRONTEND_LOCKFILE" && "$FRONTEND_LOCKFILE" -nt "$FRONTEND_STAMP" ]]; then
  (
    cd "$ROOT_DIR/frontend"
    if [[ -f "$FRONTEND_LOCKFILE" ]]; then
      npm ci >/dev/null
    else
      npm install >/dev/null
    fi
    touch "$FRONTEND_STAMP"
  )
fi

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 0.4
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
      sleep 0.2
    fi
  fi
}

kill_port_listeners "$BACKEND_PORT"
kill_port_listeners "$FRONTEND_PORT"

cleanup() {
  local pids
  pids="$(jobs -p || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

(
  cd "$ROOT_DIR"
  uvicorn app.main:app --reload --reload-dir backend/app --reload-exclude '.venv/*' --reload-exclude 'frontend/node_modules/*' --host 127.0.0.1 --port "$BACKEND_PORT" --app-dir backend
) &
BACKEND_PID=$!

(
  cd "$ROOT_DIR/frontend"
  npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort
) &
FRONTEND_PID=$!

if ! wait_for_listener "$BACKEND_PORT" 15; then
  echo "Backend failed to start on $BACKEND_PORT" >&2
  exit 1
fi

if ! wait_for_listener "$FRONTEND_PORT" 12; then
  echo "Vite failed to start on $FRONTEND_PORT. See its error above." >&2
  exit 1
fi

echo "Backend:  http://127.0.0.1:$BACKEND_PORT"
echo "Frontend: http://127.0.0.1:$FRONTEND_PORT"
echo "Python:   $("$VENV_DIR/bin/python" -V 2>&1)"
echo "Node:     $(node -v)"

wait
