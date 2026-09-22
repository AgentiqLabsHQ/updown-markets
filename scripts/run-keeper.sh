#!/bin/bash
# Wrapper for the scheduled keeper run (see README for setup).
# Supplies the operator credential to scripts/keeper.mjs from one of two places —
# never from this repo, never typed into chat:
#
#   1. scripts/.env.keeper (git-ignored) — a plain file containing e.g.
#        PRIVATE_KEY=0xabc123...
#      Create it yourself with your own editor/terminal; this script only reads it.
#
#   2. macOS Keychain, service name "updown-keeper-key" — set it up once with:
#        security add-generic-password -a "$USER" -s updown-keeper-key -w
#      (it will prompt you to type the key; nothing is echoed or logged)
#
# If neither is present, the run is skipped (logged) rather than failing loudly on
# every scheduled tick.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."

if [ -f scripts/.env.keeper ]; then
  set -a
  # shellcheck disable=SC1091
  source scripts/.env.keeper
  set +a
elif security find-generic-password -s updown-keeper-key >/dev/null 2>&1; then
  export PRIVATE_KEY
  PRIVATE_KEY="$(security find-generic-password -s updown-keeper-key -w)"
fi

if [ -z "${PRIVATE_KEY:-}" ] && [ -z "${MNEMONIC:-}" ]; then
  echo "$(date -u +%FT%TZ) keeper: skipped — no operator key configured (see scripts/run-keeper.sh header)" >> scripts/keeper.log
  exit 0
fi

{
  echo "$(date -u +%FT%TZ) keeper: starting run"
  node scripts/keeper.mjs
  echo "$(date -u +%FT%TZ) keeper: run finished"
} >> scripts/keeper.log 2>&1
