#!/usr/bin/env bash
# Deploy the mesaorigins.com Cloudflare path-router Worker.
#
# Required env:
#   CLOUDFLARE_API_TOKEN   — Account Workers Edit + Zone Workers Routes (mesaorigins.com)
#   APP_ORIGIN             — Cloud Run URL, https://….run.app (no trailing slash)
#   MARKETING_ORIGIN       — Vercel URL, https://….vercel.app (no trailing slash)
#
# Optional:
#   CLOUDFLARE_ACCOUNT_ID
#
# Usage:
#   APP_ORIGIN=https://mesadesk-xxx.run.app \
#   MARKETING_ORIGIN=https://mesa-website-xxx.vercel.app \
#   ./scripts/deploy-path-router.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="${ROOT}/workers/path-router"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: Set CLOUDFLARE_API_TOKEN." >&2
  exit 1
fi

if [[ -z "${APP_ORIGIN:-}" || -z "${MARKETING_ORIGIN:-}" ]]; then
  echo "ERROR: Set APP_ORIGIN and MARKETING_ORIGIN (https origins, no trailing slash)." >&2
  echo "  APP_ORIGIN=https://mesadesk-….run.app" >&2
  echo "  MARKETING_ORIGIN=https://….vercel.app" >&2
  exit 1
fi

validate_origin() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^https://[^/]+$ ]]; then
    echo "ERROR: ${name} must be https://host with no path/trailing slash (got ${value})" >&2
    exit 1
  fi
}

validate_origin APP_ORIGIN "$APP_ORIGIN"
validate_origin MARKETING_ORIGIN "$MARKETING_ORIGIN"

cd "$WORKER_DIR"
if [[ ! -d node_modules ]]; then
  npm ci
fi

echo "Deploying mesaorigins Worker (path router)"
echo "  APP_ORIGIN=${APP_ORIGIN}"
echo "  MARKETING_ORIGIN=${MARKETING_ORIGIN}"

npx wrangler deploy \
  --var "APP_ORIGIN:${APP_ORIGIN}" \
  --var "MARKETING_ORIGIN:${MARKETING_ORIGIN}"

echo "Done. Confirm DNS is Proxied (orange cloud), then:"
echo "  curl -sSI https://mesaorigins.com/api/health | grep -iE 'cf-ray|x-mesa|content-type'"
