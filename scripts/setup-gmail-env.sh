#!/usr/bin/env bash
#
# Writes Gmail OAuth client ID and secret to .env. Run this first; then get the
# refresh token separately with: pnpm run get-refresh-token
# Run from repo root: ./scripts/setup-gmail-env.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example "$ENV_FILE"
    echo "Created .env from .env.example"
  else
    touch "$ENV_FILE"
    echo "Created empty .env"
  fi
else
  # Back up existing .env before modifying
  cp "$ENV_FILE" "$ENV_FILE.bak"
  echo "Backed up existing .env to .env.bak"
fi

# Portable: set or replace a key=value line in .env
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
echo "Gmail OAuth client ID and secret (from GCP Credentials)."
echo "See docs/SETUP_GMAIL_OAUTH.md. Refresh token is set up separately."
echo ""

read -p "GMAIL_CLIENT_ID: " client_id
read -p "GMAIL_CLIENT_SECRET: " client_secret
read -p "GMAIL_USER_ID (optional; press Enter for 'me'): " user_id

[[ -z "$client_id" ]] && { echo "GMAIL_CLIENT_ID is required."; exit 1; }
[[ -z "$client_secret" ]] && { echo "GMAIL_CLIENT_SECRET is required."; exit 1; }

set_env "GMAIL_CLIENT_ID" "$client_id"
set_env "GMAIL_CLIENT_SECRET" "$client_secret"
if [[ -n "$user_id" ]]; then
  set_env "GMAIL_USER_ID" "$user_id"
fi

echo ""
echo "Wrote GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env"
echo ""
echo "Next: get a refresh token (opens browser to sign in):"
echo "  pnpm run get-refresh-token"
echo "Then add the printed token to .env as GMAIL_REFRESH_TOKEN=..."
echo "Also set all three in Trigger.dev: Dashboard → Project → Environment Variables"
echo ""
