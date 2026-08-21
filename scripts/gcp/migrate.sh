#!/usr/bin/env bash
# Run Prisma migrate + setup-roles against Neon using the owner (direct) URL.
#
# Usage:
#   export DIRECT_DATABASE_URL='postgresql://owner:...@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30&schema=public'
#   ./scripts/gcp/migrate.sh
#   SEED=1 ./scripts/gcp/migrate.sh   # optional demo data — never against customer prod
#
# If DIRECT_DATABASE_URL is unset, loads mesadesk-direct-database-url from Secret Manager.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-football-analysis-473513}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${DIRECT_DATABASE_URL:-}" ]]; then
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "Set DIRECT_DATABASE_URL or install gcloud to pull mesadesk-direct-database-url."
    exit 1
  fi
  echo "==> Loading mesadesk-direct-database-url from Secret Manager"
  DIRECT_DATABASE_URL="$(gcloud secrets versions access latest \
    --secret=mesadesk-direct-database-url \
    --project="$PROJECT_ID")"
fi

case "$DIRECT_DATABASE_URL" in
  *neon.tech*) ;;
  *)
    echo "DIRECT_DATABASE_URL does not look like a Neon host (expected *.neon.tech)." >&2
    exit 1
    ;;
esac
case "$DIRECT_DATABASE_URL" in
  *-pooler.*)
    echo "DIRECT_DATABASE_URL must be the unpooled Neon host (no -pooler)." >&2
    exit 1
    ;;
esac

export DIRECT_DATABASE_URL
export DATABASE_URL="${DATABASE_URL:-$DIRECT_DATABASE_URL}"

echo "==> MesaERP preflight, runtime-role bootstrap and additive migration"
# Keep the manual path identical to the migration image/Cloud Build contract:
# assert the least-privilege runtime role, run the read-only MesaERP data
# preflight before any additive DDL, deploy migrations, then verify status.
npm run release:migrate

echo "==> Optional seed (demo tenant)"
if [[ "${SEED:-0}" == "1" ]]; then
  npx prisma db seed
fi

echo "Migrate complete."
