#!/usr/bin/env bash
# Run Prisma migrate + setup-roles against Cloud SQL via Auth Proxy.
#
# Usage:
#   export PROJECT_ID=football-analysis-473513 REGION=asia-south1 INSTANCE=mesadesk-pg
#   ./scripts/gcp/migrate.sh
#   SEED=1 ./scripts/gcp/migrate.sh   # optional demo data
#
# If DIRECT_DATABASE_URL is unset, loads mesadesk-direct-database-url from Secret
# Manager and rewrites the Cloud SQL socket host to 127.0.0.1:$PROXY_PORT.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-football-analysis-473513}"
REGION="${REGION:-asia-south1}"
INSTANCE="${INSTANCE:-mesadesk-pg}"
PROXY_PORT="${PROXY_PORT:-5433}"
CONNECTION="${PROJECT_ID}:${REGION}:${INSTANCE}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo "Install Cloud SQL Auth Proxy:"
  echo "  brew install cloud-sql-proxy"
  exit 1
fi

# Socket URL from Secret Manager → TCP URL for local Auth Proxy.
rewrite_socket_to_tcp() {
  local url="$1"
  # postgresql://user:pass@localhost/db?host=/cloudsql/...&schema=public
  # → postgresql://user:pass@127.0.0.1:PORT/db?schema=public
  python3 - "$url" "$PROXY_PORT" <<'PY'
import sys, re
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse, quote
url, port = sys.argv[1], sys.argv[2]
u = urlparse(url)
# password may contain special chars already percent-encoded
userinfo = u.netloc.split("@", 1)[0] if "@" in u.netloc else ""
db = u.path.lstrip("/") or "masspolimer"
qs = parse_qs(u.query)
schema = (qs.get("schema") or ["public"])[0]
print(f"postgresql://{userinfo}@127.0.0.1:{port}/{db}?schema={schema}")
PY
}

if [[ -z "${DIRECT_DATABASE_URL:-}" ]]; then
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "Set DIRECT_DATABASE_URL or install gcloud to pull mesadesk-direct-database-url."
    exit 1
  fi
  echo "==> Loading mesadesk-direct-database-url from Secret Manager"
  SECRET_URL="$(gcloud secrets versions access latest \
    --secret=mesadesk-direct-database-url \
    --project="$PROJECT_ID")"
  DIRECT_DATABASE_URL="$(rewrite_socket_to_tcp "$SECRET_URL")"
fi

export DIRECT_DATABASE_URL
export DATABASE_URL="${DATABASE_URL:-$DIRECT_DATABASE_URL}"

echo "==> Starting Cloud SQL Auth Proxy on :${PROXY_PORT} ($CONNECTION)"
cloud-sql-proxy --port="$PROXY_PORT" "$CONNECTION" &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
sleep 3

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
