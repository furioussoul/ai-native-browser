#!/usr/bin/env bash
set -euo pipefail
# Ensure we are using nvm-managed Node, not Homebrew Node (which caused ICU mismatch)
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi
# Prefer a specific Node version; adjust if you installed a different one
if nvm ls 22 >/dev/null 2>&1; then
  nvm use 22 >/dev/null
elif nvm ls 22.11.0 >/dev/null 2>&1; then
  nvm use 22.11.0 >/dev/null
fi
# Fallback: if nvm didn't switch (non-zero), attempt direct path
if [ "$(command -v node)" = "/opt/homebrew/bin/node" ] || [[ $(command -v node) == *"/Cellar/node"* ]]; then
  echo "[warn] nvm Node not active; attempting direct nvm path fallback" >&2
  if [ -x "$NVM_DIR/versions/node/v22.11.0/bin/node" ]; then
    export PATH="$NVM_DIR/versions/node/v22.11.0/bin:$PATH"
  fi
fi
echo "Using node: $(command -v node) ($(node -v))"
# Run renderer dev server
npm run dev:renderer
