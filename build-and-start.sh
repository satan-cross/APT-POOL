#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install Node.js and pnpm, then run this script again." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set to your PostgreSQL connection string." >&2
  exit 1
fi

API_PORT="${API_PORT:-${PORT:-5000}}"
WEB_PORT="${WEB_PORT:-4173}"
BASE_PATH="${BASE_PATH:-/}"

echo "Building all workspace packages..."
PORT="$API_PORT" BASE_PATH="$BASE_PATH" pnpm run build

PORT="$API_PORT" node --enable-source-maps artifacts/api-server/dist/index.mjs &
api_pid=$!
PORT="$WEB_PORT" BASE_PATH="$BASE_PATH" pnpm --filter @workspace/security-command-center run serve &
web_pid=$!

cleanup() {
  trap - EXIT INT TERM
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "API:       http://localhost:$API_PORT"
echo "Dashboard: http://localhost:$WEB_PORT"

if wait -n "$api_pid" "$web_pid"; then
  exit 0
else
  exit "$?"
fi