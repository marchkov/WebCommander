#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

export NODE_ENV="${NODE_ENV:-development}"
case "${1:-}" in
    "") ;;
    production) export NODE_ENV=production ;;
    *) echo "Usage: $0 [production]" >&2; exit 1 ;;
esac
export WC_HOST="${WC_HOST:-127.0.0.1}"
export WC_SERVE_STATIC=true

echo "Starting WebCommander..."
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Please install Node.js 18+ first." >&2
    exit 1
fi

if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    npm install
fi

if [[ ! -d dist ]]; then
    echo "Building frontend..."
    npm run build
fi

echo "Mode: $NODE_ENV / Bind address: $WC_HOST"
echo "Check config.json for settings"
echo "Open http://localhost:${WC_PORT:-3001} in your browser (HTTPS for production)"
exec node server/index.js
