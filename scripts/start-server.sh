#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

HOST="${HOST:-127.0.0.1}"
START_PORT="${PORT:-3000}"
MAX_PORT="${MAX_PORT:-3010}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Dependencies are missing. Run 'npm install' from $ROOT_DIR first." >&2
  exit 1
fi

is_port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

port="$START_PORT"
while [ "$port" -le "$MAX_PORT" ]; do
  if ! is_port_in_use "$port"; then
    break
  fi
  port=$((port + 1))
done

if [ "$port" -gt "$MAX_PORT" ]; then
  echo "No free port found between $START_PORT and $MAX_PORT." >&2
  echo "Set PORT or MAX_PORT to choose another range." >&2
  exit 1
fi

echo "Starting Kestro web server"
echo "URL: http://$HOST:$port"

cd "$WEB_DIR"
exec npm run dev -- --hostname "$HOST" --port "$port"

