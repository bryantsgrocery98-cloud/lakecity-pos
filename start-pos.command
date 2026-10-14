#!/bin/bash
# Mac launcher: double-click in Finder. (First time: right-click > Open.)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org and run this again."
  read -r -p "Press Enter to close."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing the POS parts (needs internet once)…"
  npm install --omit=dev --no-audit --no-fund || { read -r -p "Install failed. Press Enter."; exit 1; }
fi
echo "POS is running. Close this window to stop the register."
node launch.mjs
