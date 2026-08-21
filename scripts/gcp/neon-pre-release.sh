#!/usr/bin/env bash
# Pre-release Neon durability gate: history window, protected branch, snapshot.
# Used by Cloud Build before prisma migrate deploy. Never prints secret values.
#
# Required Secret Manager secrets (accessed by mesadesk-build):
#   mesadesk-neon-api-key
#   mesadesk-neon-project-id
#
# Optional env:
#   NEON_MIN_HISTORY_SECONDS  default 604800 (7 days)
#   BUILD_ID                  included in snapshot name when set

set -euo pipefail

NEON_API="${NEON_API:-https://console.neon.tech/api/v2}"
NEON_MIN_HISTORY_SECONDS="${NEON_MIN_HISTORY_SECONDS:-604800}"
PROJECT_ID="${PROJECT_ID:?PROJECT_ID is required}"
BUILD_SA="${BUILD_SA:-mesadesk-build@${PROJECT_ID}.iam.gserviceaccount.com}"

require_secret() {
  local name="$1"
  if ! gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    cat >&2 <<EOF
Missing Secret Manager secret: ${name}

Create it (value is not printed by these docs), then grant the build SA:

  printf '%s' 'YOUR_VALUE' | gcloud secrets create ${name} --project=${PROJECT_ID} --data-file=-
  gcloud secrets add-iam-policy-binding ${name} \\
    --project=${PROJECT_ID} \\
    --member=serviceAccount:${BUILD_SA} \\
    --role=roles/secretmanager.secretAccessor

Required Neon gate secrets:
  mesadesk-neon-project-id   Neon console project id
  mesadesk-neon-api-key      Neon API key (console → Account settings → API keys)

Or run scripts/gcp/provision.sh with:
  MESAORIGINS_NEON_PROJECT_ID_VALUE=...
  MESAORIGINS_NEON_API_KEY_VALUE=...
EOF
    exit 1
  fi
  local version
  version="$(gcloud secrets versions list "$name" --project="$PROJECT_ID" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')"
  version="${version##*/}"
  [[ "$version" =~ ^[0-9]+$ ]] || {
    echo "Secret ${name} has no enabled version." >&2
    exit 1
  }
}

echo "==> Checking required Neon / database secrets exist"
require_secret mesadesk-database-url
require_secret mesadesk-direct-database-url
require_secret mesadesk-neon-project-id
require_secret mesadesk-neon-api-key

secret_value() {
  local name="$1"
  gcloud secrets versions access latest --secret="$name" --project="$PROJECT_ID"
}

echo "==> Loading Neon project id and API key from Secret Manager"
NEON_PROJECT_ID="$(secret_value mesadesk-neon-project-id)"
NEON_API_KEY="$(secret_value mesadesk-neon-api-key)"
[[ -n "$NEON_PROJECT_ID" ]] || { echo "mesadesk-neon-project-id is empty" >&2; exit 1; }
[[ -n "$NEON_API_KEY" ]] || { echo "mesadesk-neon-api-key is empty" >&2; exit 1; }

neon_get() {
  local path="$1"
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${NEON_API_KEY}" \
    -H "Accept: application/json" \
    "${NEON_API}${path}"
}

neon_post() {
  local path="$1"
  local body="$2"
  curl --fail --silent --show-error \
    -X POST \
    -H "Authorization: Bearer ${NEON_API_KEY}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${NEON_API}${path}"
}

echo "==> Verifying Neon project ${NEON_PROJECT_ID}"
PROJECT_JSON="$(neon_get "/projects/${NEON_PROJECT_ID}")"
printf '%s' "$PROJECT_JSON" > /tmp/neon-project.json

# Auto-remediate common durability settings so releases do not fail one-by-one.
python3 - "$NEON_API" "$NEON_PROJECT_ID" "$NEON_API_KEY" "$NEON_MIN_HISTORY_SECONDS" <<'PY'
import json, sys, urllib.request

api, project_id, api_key, min_history = sys.argv[1:5]
min_history = int(min_history)
project = json.load(open("/tmp/neon-project.json")).get("project") or json.load(open("/tmp/neon-project.json"))
region = project.get("region_id") or project.get("region") or ""
if region and "ap-southeast-1" not in region and "aws-ap-southeast-1" not in region:
    raise SystemExit(f"Neon production safety gate failed: expected aws-ap-southeast-1, got {region!r}")

history = project.get("history_retention_seconds")
if history is None and project.get("history_retention_hours") is not None:
    history = int(project["history_retention_hours"]) * 3600
history = int(history or 0)

def patch_project(body: dict) -> dict:
    request = urllib.request.Request(
        f"{api}/projects/{project_id}",
        data=json.dumps(body).encode(),
        method="PATCH",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)

if history < min_history:
    print(f"Raising Neon history retention from {history}s to {min_history}s")
    updated = patch_project({"project": {"history_retention_seconds": min_history}})
    history = int((updated.get("project") or {}).get("history_retention_seconds") or 0)
    if history < min_history:
        raise SystemExit(
            f"Neon production safety gate failed: history retention {history}s is below required {min_history}s (7 days)"
        )
print(f"Neon project ok (region={region or 'unspecified'}, history_seconds={history})")
PY

echo "==> Listing branches; production branch must be protected"
BRANCHES_JSON="$(neon_get "/projects/${NEON_PROJECT_ID}/branches")"
printf '%s' "$BRANCHES_JSON" > /tmp/neon-branches.json
python3 - "$NEON_API" "$NEON_PROJECT_ID" "$NEON_API_KEY" <<'PY'
import json, sys, urllib.request

api, project_id, api_key = sys.argv[1:4]
payload = json.load(open("/tmp/neon-branches.json"))
branches = payload.get("branches") or []
if not branches:
    raise SystemExit("Neon production safety gate failed: no branches returned")
primary = next((b for b in branches if b.get("default") or b.get("primary")), None)
if primary is None:
    primary = next((b for b in branches if (b.get("name") or "").lower() in {"main", "production", "prod"}), branches[0])
protected = bool(primary.get("protected") or primary.get("protection_status") == "protected")
if not protected:
    print(f"Protecting Neon branch {primary.get('name')!r}")
    request = urllib.request.Request(
        f"{api}/projects/{project_id}/branches/{primary['id']}",
        data=json.dumps({"branch": {"protected": True}}).encode(),
        method="PATCH",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request) as response:
        primary = json.load(response).get("branch") or primary
    protected = bool(primary.get("protected") or primary.get("protection_status") == "protected")
if not protected:
    raise SystemExit(
        f"Neon production safety gate failed: branch {primary.get('name')!r} is not protected"
    )
open("/tmp/neon-branch-id", "w").write(primary["id"])
print(f"Protected branch ok: {primary.get('name')} ({primary['id']})")
PY

BRANCH_ID="$(cat /tmp/neon-branch-id)"
# Keep names short/safe for Neon branch fallback (alphanumeric + hyphen, <= 50).
SNAP_BASE="pre-rel-${BUILD_ID:-manual}"
SNAP_NAME="$(printf '%s' "$SNAP_BASE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | cut -c1-50)"
echo "==> Creating pre-release snapshot ${SNAP_NAME}"
# Neon snapshot API: POST /projects/{project_id}/branches/{branch_id}/snapshot
# Some accounts use /snapshots; try snapshot endpoint first, fall back to branch create name.
if ! SNAP_JSON="$(neon_post "/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}/snapshot" \
  "{\"name\":\"${SNAP_NAME}\"}" 2>/tmp/neon-snap-err.txt)"; then
  # Fallback: create an immediate timestamped child branch as a restore point.
  # Append epoch so retries never collide with a leftover restore branch.
  RESTORE_NAME="$(printf '%s-%s' "$SNAP_NAME" "$(date +%s)" | cut -c1-63)"
  echo "Snapshot endpoint unavailable; creating restore branch ${RESTORE_NAME} instead."
  SNAP_JSON="$(neon_post "/projects/${NEON_PROJECT_ID}/branches" \
    "{\"branch\":{\"name\":\"${RESTORE_NAME}\",\"parent_id\":\"${BRANCH_ID}\"},\"endpoints\":[]}")"
fi
printf '%s' "$SNAP_JSON" > /tmp/neon-snapshot.json
python3 <<'PY'
import json
payload = json.load(open("/tmp/neon-snapshot.json"))
# Accept either a snapshot object or a created branch restore point.
ok = bool(payload.get("snapshot") or payload.get("branch") or payload.get("id"))
if not ok:
    raise SystemExit("Neon production safety gate failed: could not create snapshot/restore point")
print("Pre-release Neon restore point created.")
PY

echo "Neon safety gate passed."
