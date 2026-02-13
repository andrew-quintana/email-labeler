#!/usr/bin/env bash
#
# Writes GMAIL_REFRESH_TOKEN to .env. Run after you have client ID and secret
# in .env and have obtained a refresh token (e.g. via pnpm run get-refresh-token).
# Run from repo root: ./scripts/setup-gmail-refresh-token.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No .env found. Run pnpm run setup:gmail first to set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET."
  exit 1
fi

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    grep -v "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp"
    echo "${key}=${val}" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

echo ""
echo "Paste the Gmail refresh token (from pnpm run get-refresh-token)."
echo ""

read -sp "GMAIL_REFRESH_TOKEN: " refresh_token
echo ""

[[ -z "$refresh_token" ]] && { echo "GMAIL_REFRESH_TOKEN is required."; exit 1; }

set_env "GMAIL_REFRESH_TOKEN" "$refresh_token"

echo ""
echo "Wrote GMAIL_REFRESH_TOKEN to .env"
echo ""
