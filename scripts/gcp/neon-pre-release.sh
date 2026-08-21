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

python3 - "$NEON_MIN_HISTORY_SECONDS" <<'PY'
import json, sys
min_history = int(sys.argv[1])
project = json.load(open("/tmp/neon-project.json")).get("project") or json.load(open("/tmp/neon-project.json"))
failures = []
region = project.get("region_id") or project.get("region") or ""
if region and "ap-southeast-1" not in region and "aws-ap-southeast-1" not in region:
    failures.append(f"expected Neon region aws-ap-southeast-1, got {region!r}")
# Neon exposes history retention as seconds on newer APIs; accept hours when present.
history = project.get("history_retention_seconds")
if history is None and project.get("history_retention_hours") is not None:
    history = int(project["history_retention_hours"]) * 3600
if history is None:
    # Some payloads nest settings; treat missing as fail-closed for production.
    settings = project.get("settings") or {}
    history = settings.get("history_retention_seconds")
    if history is None and settings.get("history_retention_hours") is not None:
        history = int(settings["history_retention_hours"]) * 3600
if history is None:
    failures.append("history retention is missing; set at least 7 days in the Neon console")
elif int(history) < min_history:
    failures.append(f"history retention {history}s is below required {min_history}s (7 days)")
if failures:
    raise SystemExit("Neon production safety gate failed: " + "; ".join(failures))
print(f"Neon project ok (region={region or 'unspecified'}, history_seconds={history})")
PY

echo "==> Listing branches; production branch must be protected"
BRANCHES_JSON="$(neon_get "/projects/${NEON_PROJECT_ID}/branches")"
printf '%s' "$BRANCHES_JSON" > /tmp/neon-branches.json
python3 <<'PY'
import json
payload = json.load(open("/tmp/neon-branches.json"))
branches = payload.get("branches") or []
if not branches:
    raise SystemExit("Neon production safety gate failed: no branches returned")
# Prefer the default/primary branch; otherwise the first branch named main/production.
primary = next((b for b in branches if b.get("default") or b.get("primary")), None)
if primary is None:
    primary = next((b for b in branches if (b.get("name") or "").lower() in {"main", "production", "prod"}), branches[0])
protected = bool(primary.get("protected") or primary.get("protection_status") == "protected")
if not protected:
    raise SystemExit(
        f"Neon production safety gate failed: branch {primary.get('name')!r} is not protected"
    )
open("/tmp/neon-branch-id", "w").write(primary["id"])
print(f"Protected branch ok: {primary.get('name')} ({primary['id']})")
PY

BRANCH_ID="$(cat /tmp/neon-branch-id)"
SNAP_NAME="pre-release-${BUILD_ID:-manual}"
echo "==> Creating pre-release snapshot ${SNAP_NAME}"
# Neon snapshot API: POST /projects/{project_id}/branches/{branch_id}/snapshot
# Some accounts use /snapshots; try snapshot endpoint first, fall back to branch create name.
if ! SNAP_JSON="$(neon_post "/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}/snapshot" \
  "{\"name\":\"${SNAP_NAME}\"}" 2>/tmp/neon-snap-err.txt)"; then
  # Fallback: create an immediate timestamped child branch as a restore point.
  echo "Snapshot endpoint unavailable; creating restore branch instead."
  SNAP_JSON="$(neon_post "/projects/${NEON_PROJECT_ID}/branches" \
    "{\"branch\":{\"name\":\"${SNAP_NAME}\",\"parent_id\":\"${BRANCH_ID}\"},\"endpoints\":[]}")"
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
