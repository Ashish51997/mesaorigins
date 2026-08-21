#!/usr/bin/env bash
# One-shot production preflight for MesaOrigins (Cloud Run + Neon).
# Checks and remediates common Cloud Build blockers before a release.
# Never prints secret values.
#
# Usage:
#   export PROJECT_ID=football-analysis-473513
#   export REGION=asia-southeast1
#   ./scripts/gcp/preflight-production.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-football-analysis-473513}"
REGION="${REGION:-asia-southeast1}"
REPO="${REPO:-mesaorigins}"
SERVICE="${SERVICE:-mesadesk}"
BUILD_SA="mesadesk-build@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_SA="mesadesk-run@${PROJECT_ID}.iam.gserviceaccount.com"
MIGRATE_SA="mesadesk-migrate@${PROJECT_ID}.iam.gserviceaccount.com"
NEON_API="${NEON_API:-https://console.neon.tech/api/v2}"
NEON_MIN_HISTORY_SECONDS="${NEON_MIN_HISTORY_SECONDS:-604800}"
FAILURES=0

note() { echo "==> $*"; }
ok() { echo "  OK  $*"; }
fail() { echo "  FAIL  $*" >&2; FAILURES=$((FAILURES + 1)); }
warn() { echo "  WARN  $*"; }

gcloud config set project "$PROJECT_ID" >/dev/null

note "Artifact Registry ${REPO} in ${REGION}"
if gcloud artifacts repositories describe "$REPO" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  ok "repository exists"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="MesaOrigins images" \
    --project="$PROJECT_ID"
  ok "created repository"
fi

ensure_secret_accessor() {
  local secret="$1"
  local member="$2"
  gcloud secrets add-iam-policy-binding "$secret" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:${member}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
}

note "Required secrets + IAM"
REQUIRED_SECRETS=(
  mesadesk-database-url
  mesadesk-direct-database-url
  mesadesk-neon-project-id
  mesadesk-neon-api-key
  mesadesk-auth-secret
  mesadesk-onboarding-emails
  mesadesk-vendor-bank-key
  mesadesk-erp-ops-handoff-key
  mesadesk-ops-statutory-key
  mesadesk-erp-external-evidence-key
)
for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    fail "missing secret ${secret}"
    continue
  fi
  version="$(gcloud secrets versions list "$secret" --project="$PROJECT_ID" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')"
  version="${version##*/}"
  if [[ ! "$version" =~ ^[0-9]+$ ]]; then
    fail "secret ${secret} has no enabled version"
    continue
  fi
  ok "${secret} v${version}"
done

# Runtime secrets
for secret in \
  mesadesk-database-url \
  mesadesk-auth-secret \
  mesadesk-onboarding-emails \
  mesadesk-vendor-bank-key \
  mesadesk-erp-ops-handoff-key \
  mesadesk-ops-statutory-key \
  mesadesk-erp-external-evidence-key
do
  ensure_secret_accessor "$secret" "$RUN_SA"
done
ensure_secret_accessor mesadesk-direct-database-url "$MIGRATE_SA"
ensure_secret_accessor mesadesk-neon-project-id "$BUILD_SA"
ensure_secret_accessor mesadesk-neon-api-key "$BUILD_SA"
# Build SA must list versions for pinning
for secret in "${REQUIRED_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    gcloud secrets add-iam-policy-binding "$secret" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:${BUILD_SA}" \
      --role="roles/secretmanager.viewer" \
      --quiet >/dev/null 2>&1 || true
  fi
done
ok "IAM accessors refreshed"

note "Neon connection URL shape"
python3 - "$PROJECT_ID" <<'PY'
import json, subprocess, sys
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

project = sys.argv[1]

def access(name: str) -> str:
    return subprocess.check_output(
        ["gcloud", "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={project}"],
        text=True,
    )

def put(name: str, value: str) -> None:
    subprocess.run(
        ["gcloud", "secrets", "versions", "add", name, f"--project={project}", "--data-file=-"],
        input=value.encode(),
        check=True,
    )

def harden(name: str, *, expect_pooler: bool) -> None:
    raw = access(name)
    u = urlparse(raw)
    host = u.hostname or ""
    qs = parse_qs(u.query, keep_blank_values=True)
    changed = False
    if "neon.tech" not in host:
        raise SystemExit(f"FAIL  {name} host is not Neon: {host}")
    if expect_pooler and "-pooler." not in host:
        raise SystemExit(f"FAIL  {name} must use the Neon -pooler host")
    if not expect_pooler and "-pooler." in host:
        raise SystemExit(f"FAIL  {name} must be unpooled (no -pooler)")
    if (qs.get("sslmode") or [""])[0] != "require":
        qs["sslmode"] = ["require"]
        changed = True
    if expect_pooler and (qs.get("pgbouncer") or [""])[0] != "true":
        qs["pgbouncer"] = ["true"]
        changed = True
    if (qs.get("connect_timeout") or [""])[0] != "30":
        qs["connect_timeout"] = ["30"]
        changed = True
    if expect_pooler and "connection_limit" not in qs:
        qs["connection_limit"] = ["5"]
        changed = True
    if expect_pooler and "pool_timeout" not in qs:
        qs["pool_timeout"] = ["20"]
        changed = True
    if "ap-southeast-1" not in host:
        print(f"  WARN  {name} host is not Singapore (ap-southeast-1): {host}", flush=True)
    if changed:
        flat = {k: v[-1] for k, v in qs.items()}
        new = urlunparse(u._replace(query=urlencode(flat)))
        put(name, new)
        print(f"  OK  {name} updated (connect_timeout/ssl/pool params)", flush=True)
    else:
        print(f"  OK  {name} shape looks good", flush=True)

harden("mesadesk-database-url", expect_pooler=True)
harden("mesadesk-direct-database-url", expect_pooler=False)
PY

note "Neon durability (history + protected branch)"
NEON_PROJECT_ID="$(gcloud secrets versions access latest --secret=mesadesk-neon-project-id --project="$PROJECT_ID")"
NEON_API_KEY="$(gcloud secrets versions access latest --secret=mesadesk-neon-api-key --project="$PROJECT_ID")"

PROJECT_JSON="$(curl --fail --silent --show-error \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Accept: application/json" \
  "${NEON_API}/projects/${NEON_PROJECT_ID}")"
printf '%s' "$PROJECT_JSON" > /tmp/mesaorigins-neon-project.json

python3 - "$NEON_API" "$NEON_PROJECT_ID" "$NEON_API_KEY" "$NEON_MIN_HISTORY_SECONDS" <<'PY'
import json, os, sys, urllib.request

api, project_id, api_key, min_history = sys.argv[1:5]
min_history = int(min_history)
project = json.load(open("/tmp/mesaorigins-neon-project.json")).get("project") or {}
region = project.get("region_id") or ""
history = int(project.get("history_retention_seconds") or 0)
print(f"  OK  neon project {project.get('name')} region={region} history={history}s", flush=True)
if "ap-southeast-1" not in region:
    raise SystemExit(f"FAIL  Neon region must be aws-ap-southeast-1, got {region!r}")

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        f"{api}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)

if history < min_history:
    updated = req("PATCH", f"/projects/{project_id}", {"project": {"history_retention_seconds": min_history}})
    history = int((updated.get("project") or {}).get("history_retention_seconds") or 0)
    print(f"  OK  history retention raised to {history}s", flush=True)

branches = req("GET", f"/projects/{project_id}/branches").get("branches") or []
primary = next((b for b in branches if b.get("default")), branches[0])
if not primary.get("protected"):
    updated = req("PATCH", f"/projects/{project_id}/branches/{primary['id']}", {"branch": {"protected": True}})
    primary = updated.get("branch") or primary
    print(f"  OK  protected branch {primary.get('name')}", flush=True)
else:
    print(f"  OK  branch {primary.get('name')} already protected", flush=True)
PY

note "Cloud Run service URL in ${REGION}"
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)' 2>/dev/null || true)"
if [[ "$SERVICE_URL" =~ ^https:// ]]; then
  ok "service exists: ${SERVICE_URL}"
  echo "  TIP  trigger can omit _APP_URL; pipeline will reuse this URL"
else
  warn "no Cloud Run service in ${REGION} yet — first deploy needs _APP_URL=https://your-origin"
fi

note "Dry-run Neon pre-release gate"
chmod +x "$(dirname "$0")/neon-pre-release.sh"
PROJECT_ID="$PROJECT_ID" BUILD_ID="preflight-$(date +%s)" \
  "$(dirname "$0")/neon-pre-release.sh"
ok "neon-pre-release.sh passed"

if [[ "$FAILURES" -gt 0 ]]; then
  echo
  echo "Preflight finished with ${FAILURES} failure(s). Fix MISSING secrets, then rerun." >&2
  exit 1
fi

cat <<EOF

Preflight passed. Re-run production Cloud Build.

If this is the first deploy in ${REGION} and no service URL exists yet:
  gcloud builds submit --config cloudbuild.yaml \\
    --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \\
    --substitutions=_REGION=${REGION},_REPO=${REPO},_SERVICE=${SERVICE},_APP_URL=https://YOUR_ORIGIN

Otherwise the existing trigger on main is enough.
EOF
