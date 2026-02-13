#!/usr/bin/env bash
#
# Enables the Gmail API in your GCP project (if gcloud is installed) and prints
# the main setup links. Run before or with setup-gmail-env.sh.
#
# Usage:
#   ./scripts/setup-gcp-gmail.sh              # prompt for project ID, enable API via gcloud if available
#   GCP_PROJECT_ID=123456789 ./scripts/setup-gcp-gmail.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load project ID from .env if present
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # Optional: look for a GCP_PROJECT_ID in .env (we don't add it by default)
  if grep -q "^GCP_PROJECT_ID=" "$ENV_FILE" 2>/dev/null; then
    export GCP_PROJECT_ID="${GCP_PROJECT_ID:-$(grep "^GCP_PROJECT_ID=" "$ENV_FILE" | cut -d= -f2-)}"
  fi
fi

echo ""
echo "GCP setup for Gmail (OAuth + Gmail API)"
echo "--------------------------------------"
echo ""

# Project ID: env var or prompt
if [[ -z "$GCP_PROJECT_ID" ]]; then
  read -p "GCP project ID (numeric, from console URL or Credentials page): " GCP_PROJECT_ID
fi
if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo "No project ID. Open the links below and use the project ID from the URL."
  GCP_PROJECT_ID="YOUR_PROJECT_ID"
fi

# Enable Gmail API via gcloud if available
if command -v gcloud &>/dev/null; then
  echo "Enabling Gmail API for project $GCP_PROJECT_ID (gcloud)..."
  if gcloud services enable gmail.googleapis.com --project="$GCP_PROJECT_ID" 2>/dev/null; then
    echo "Gmail API enabled."
  else
    echo "gcloud enable failed (check project ID and permissions). Enable manually via the link below."
  fi
else
  echo "gcloud CLI not found. Enable the Gmail API manually:"
  echo "  https://console.cloud.google.com/apis/api/gmail.googleapis.com/overview?project=${GCP_PROJECT_ID}"
fi

echo ""
echo "Next steps (open in browser):"
echo "  1. Gmail API (enable if needed): https://console.cloud.google.com/apis/api/gmail.googleapis.com/overview?project=${GCP_PROJECT_ID}"
echo "  2. OAuth consent screen:         https://console.cloud.google.com/apis/credentials/consent?project=${GCP_PROJECT_ID}"
echo "  3. Create OAuth client:          https://console.cloud.google.com/apis/credentials?project=${GCP_PROJECT_ID}"
echo ""
echo "Then run: pnpm run setup:gmail   (client ID + secret) and  pnpm run get-refresh-token"
echo ""
