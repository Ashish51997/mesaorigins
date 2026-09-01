#!/usr/bin/env bash
# Switch mesaorigins.com DNS from Cloudflare Email Routing to Google Workspace mail.
#
# Prerequisites:
#   - Google Workspace signup completed for the domain
#   - Cloudflare API token with Zone → DNS → Edit (+ Email Routing → Edit if available)
#
# Usage:
#   export CLOUDFLARE_API_TOKEN='your-token'
#   ./scripts/cloudflare-google-workspace-dns.sh
#
# Optional:
#   DOMAIN=mesaorigins.com ./scripts/cloudflare-google-workspace-dns.sh

set -euo pipefail

DOMAIN="${DOMAIN:-mesaorigins.com}"
API_BASE="https://api.cloudflare.com/client/v4"
GOOGLE_MX_HOST="smtp.google.com"
GOOGLE_SPF="v=spf1 include:_spf.google.com ~all"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: Set CLOUDFLARE_API_TOKEN (Zone DNS Edit for ${DOMAIN})." >&2
  echo "Create at: Cloudflare → My Profile → API Tokens" >&2
  exit 1
fi

cf_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="${API_BASE}${path}"
  if [[ -n "$data" ]]; then
    curl -sS -g -X "$method" --url "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data"
  else
    curl -sS -g -X "$method" --url "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
  fi
}

cf_ok() {
  local label="$1"
  local json="$2"
  if CF_JSON="$json" python3 -c 'import json, os, sys; d=json.loads(os.environ["CF_JSON"]); sys.exit(0 if d.get("success") else 1)'; then
    ok "$label"
    return 0
  fi
  echo "  FAIL  $label" >&2
  CF_JSON="$json" python3 <<'PY' || echo "$json" >&2
import json, os, sys
d = json.loads(os.environ["CF_JSON"])
for e in d.get("errors") or []:
    code = e.get("code")
    msg = e.get("message")
    print(f"    Cloudflare error {code}: {msg}", file=sys.stderr)
if not d.get("errors"):
    print(f"    Response: {d}", file=sys.stderr)
PY
  return 1
}

json_mx_record() {
  DOMAIN="$DOMAIN" GOOGLE_MX_HOST="$GOOGLE_MX_HOST" python3 <<'PY'
import json, os
print(json.dumps({
    "type": "MX",
    "name": os.environ["DOMAIN"],
    "content": os.environ["GOOGLE_MX_HOST"],
    "priority": 1,
    "ttl": 1,
    "proxied": False,
}))
PY
}

json_txt_record() {
  DOMAIN="$DOMAIN" GOOGLE_SPF="$GOOGLE_SPF" python3 <<'PY'
import json, os
print(json.dumps({
    "type": "TXT",
    "name": os.environ["DOMAIN"],
    "content": os.environ["GOOGLE_SPF"],
    "ttl": 1,
}))
PY
}

note() { echo "==> $*"; }
ok() { echo "  OK  $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

note "Resolving Cloudflare zone for ${DOMAIN}"
ZONE_JSON="$(cf_api GET "/zones?name=${DOMAIN}")"
ZONE_ID="$(echo "$ZONE_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["result"][0]["id"] if d.get("success") and d["result"] else "")')"
if [[ -z "$ZONE_ID" ]]; then
  fail "Could not find zone ${DOMAIN}. Check token permissions."
fi
ok "Zone ID ${ZONE_ID}"

note "Disabling Cloudflare Email Routing (stops route*.mx.cloudflare.net from returning)"
if [[ "${SKIP_EMAIL_ROUTING_DISABLE:-}" == "1" ]]; then
  ok "Skipped (SKIP_EMAIL_ROUTING_DISABLE=1 — assume you disabled routing in the dashboard)"
else
  DISABLE_ROUTING="$(cf_api POST "/zones/${ZONE_ID}/email/routing/disable" '{}')"
  if ! cf_ok "Email Routing disabled" "$DISABLE_ROUTING"; then
    cat >&2 <<'EOF'

  STOP  Cloudflare Email Routing is still active and locks MX records.

  Do this in the dashboard (2 minutes), then run again with:
    export SKIP_EMAIL_ROUTING_DISABLE=1
    npm run dns:google-workspace

  Manual steps:
    1. https://dash.cloudflare.com → mesaorigins.com
    2. Email → Email Routing
    3. Click Disable (or Delete all routes, then Disable)
    4. Re-run this script

  Optional: create a new API token with Email Routing → Edit so the script
  can disable routing automatically next time.
EOF
    exit 1
  fi
fi

note "Removing old MX records (Cloudflare / Google)"
MX_JSON="$(cf_api GET "/zones/${ZONE_ID}/dns_records?type=MX&per_page=100")"
MX_IDS="$(echo "$MX_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for r in data.get("result", []):
    print(r["id"])
')"
while IFS= read -r id || [[ -n "${id:-}" ]]; do
  if [[ -n "${id:-}" ]]; then
    DELETE_JSON="$(cf_api DELETE "/zones/${ZONE_ID}/dns_records/${id}")"
    cf_ok "Deleted MX record ${id}" "$DELETE_JSON" || fail "Could not delete MX record ${id}"
  fi
done <<< "$MX_IDS"

note "Adding Google Workspace MX (${GOOGLE_MX_HOST}, priority 1)"
CREATE_MX="$(cf_api POST "/zones/${ZONE_ID}/dns_records" "$(json_mx_record)")"
cf_ok "MX ${GOOGLE_MX_HOST}" "$CREATE_MX" || fail "Could not create Google MX record"

note "Updating SPF TXT for Google Workspace"
TXT_JSON="$(cf_api GET "/zones/${ZONE_ID}/dns_records?type=TXT&per_page=100")"
# Remove legacy Cloudflare Email Routing SPF if present (multiple SPF TXT records break deliverability).
LEGACY_SPF_IDS="$(echo "$TXT_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for r in data.get("result", []):
    content = (r.get("content") or "").lower()
    if content.startswith("v=spf1") and "include:_spf.mx.cloudflare.net" in content:
        print(r["id"])
')"
while IFS= read -r legacy_id || [[ -n "${legacy_id:-}" ]]; do
  if [[ -n "${legacy_id:-}" ]]; then
    DELETE_SPF="$(cf_api DELETE "/zones/${ZONE_ID}/dns_records/${legacy_id}")"
    cf_ok "Removed legacy Cloudflare SPF ${legacy_id}" "$DELETE_SPF" || true
  fi
done <<< "$LEGACY_SPF_IDS"
SPF_ID="$(echo "$TXT_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for r in data.get("result", []):
    content = (r.get("content") or "").lower()
    if content.startswith("v=spf1"):
        print(r["id"])
        break
')"

if [[ -n "$SPF_ID" ]]; then
  UPDATE_SPF="$(cf_api PUT "/zones/${ZONE_ID}/dns_records/${SPF_ID}" "$(json_txt_record)")"
  cf_ok "SPF updated" "$UPDATE_SPF" || fail "Could not update SPF"
else
  CREATE_SPF="$(cf_api POST "/zones/${ZONE_ID}/dns_records" "$(json_txt_record)")"
  cf_ok "SPF created" "$CREATE_SPF" || fail "Could not create SPF"
fi

note "Verifying public DNS (may take a few minutes to propagate)"
sleep 5
dig +short MX "${DOMAIN}" @1.1.1.1 || true

cat <<EOF

Done. Next steps in Google Admin (admin.google.com):

1. Domains → Activate Gmail (if not already).
2. Users → Create sales@${DOMAIN} as:
   - a user mailbox, OR
   - an alias on your admin user, OR
   - a Group (recommended) that forwards to your inbox.
3. Apps → Google Workspace → Gmail → Authenticate email → generate DKIM.
4. Add the DKIM TXT record in Cloudflare (google._domainkey).

Test: send mail to sales@${DOMAIN} from an external address after MX propagates.
EOF
