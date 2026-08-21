#!/usr/bin/env bash
# One-time GCP bootstrap for MesaOrigins (Neon Postgres + Artifact Registry + secrets + IAM).
# Prerequisites: gcloud auth login, billing on the project, Neon Launch project in aws-ap-southeast-1.
#
# Usage:
#   export PROJECT_ID=mesaorigins-prod
#   export REGION=asia-southeast1
#   # Stream Neon URLs into Secret Manager (values are never printed):
#   export MESAORIGINS_DATABASE_URL_VALUE='postgresql://app_user:...@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=30&connection_limit=5&pool_timeout=20&schema=public'
#   export MESAORIGINS_DIRECT_DATABASE_URL_VALUE='postgresql://neondb_owner:...@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30&schema=public'
#   export MESAORIGINS_NEON_PROJECT_ID_VALUE='your-neon-project-id'
#   export MESAORIGINS_NEON_API_KEY_VALUE='...'   # Neon console API key; snapshot gate
#   ./scripts/gcp/provision.sh
#
# Neon console (before first release):
#   - Region: aws-ap-southeast-1 (Singapore). Do not use a non-colocated region.
#   - Scale-to-zero: enabled (default Launch suspend ~5 minutes).
#   - History / instant restore window: at least 7 days.
#   - Protect the production branch.
#   - Create least-privilege role app_user (no BYPASSRLS / superuser) for runtime.
#   - Owner / migration role stays on DIRECT_DATABASE_URL only.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-football-analysis-473513}"
REGION="${REGION:-asia-southeast1}"
REPO="${REPO:-mesaorigins}"
SERVICE="${SERVICE:-mesadesk}"
SA_NAME="mesadesk-run"
MIGRATE_SA_NAME="mesadesk-migrate"
BUILD_SA_NAME="mesadesk-build"

echo "==> Project: $PROJECT_ID  region: $REGION (Neon-backed; no Cloud SQL)"

gcloud config set project "$PROJECT_ID"

echo "==> Enable APIs"
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com

echo "==> Artifact Registry ($REPO)"
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" &>/dev/null; then
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="MesaOrigins images"
fi

# Never invent or print connection strings. Accept operator-supplied Neon URLs only
# when a required database secret is missing, and stream them into Secret Manager.
ensure_secret_from_env() {
  local secret_name="$1"
  local value_variable="$2"
  local hint="$3"
  if gcloud secrets describe "$secret_name" &>/dev/null; then
    echo "Secret $secret_name already exists."
    return
  fi

  local secret_value="${!value_variable:-}"
  if [[ -z "$secret_value" ]]; then
    echo "Missing required secret $secret_name." >&2
    echo "Set $value_variable ($hint) and rerun; the value will not be printed." >&2
    exit 1
  fi
  printf '%s' "$secret_value" | gcloud secrets create "$secret_name" --data-file=-
  unset secret_value
  echo "Created $secret_name."
}

echo "==> Neon connection secrets"
ensure_secret_from_env mesadesk-database-url MESAORIGINS_DATABASE_URL_VALUE \
  "Neon pooled app_user URL (-pooler host, pgbouncer=true, connect_timeout=30)"
ensure_secret_from_env mesadesk-direct-database-url MESAORIGINS_DIRECT_DATABASE_URL_VALUE \
  "Neon unpooled owner URL (no -pooler, migrate/setup-roles only)"
ensure_secret_from_env mesadesk-neon-project-id MESAORIGINS_NEON_PROJECT_ID_VALUE \
  "Neon project id from the console"
ensure_secret_from_env mesadesk-neon-api-key MESAORIGINS_NEON_API_KEY_VALUE \
  "Neon API key used by the pre-release snapshot gate"

echo "==> Runtime service account"
if ! gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="MesaOrigins Cloud Run"
fi
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/logging.logWriter" \
  --condition=None --quiet
# Remove legacy Cloud SQL and project-wide secret grants from older bootstraps.
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None --quiet 2>/dev/null || true
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None --quiet 2>/dev/null || true
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --condition=None --quiet 2>/dev/null || true

echo "==> Dedicated migration service account"
if ! gcloud iam service-accounts describe "${MIGRATE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
  gcloud iam service-accounts create "$MIGRATE_SA_NAME" --display-name="MesaOrigins database migrations"
fi
MIGRATE_SA_EMAIL="${MIGRATE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${MIGRATE_SA_EMAIL}" \
  --role="roles/logging.logWriter" --condition=None --quiet
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${MIGRATE_SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None --quiet 2>/dev/null || true

echo "==> Dedicated Cloud Build release service account"
if ! gcloud iam service-accounts describe "${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
  gcloud iam service-accounts create "$BUILD_SA_NAME" --display-name="MesaOrigins release pipeline"
fi
BUILD_SA_EMAIL="${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
for role in \
  roles/cloudbuild.builds.builder \
  roles/artifactregistry.writer \
  roles/run.admin \
  roles/logging.logWriter \
  roles/secretmanager.viewer
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA_EMAIL}" \
    --role="$role" --condition=None --quiet
done
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/cloudsql.admin" \
  --condition=None --quiet 2>/dev/null || true

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
CLOUD_BUILD_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$BUILD_SA_EMAIL" \
  --member="serviceAccount:${CLOUD_BUILD_SERVICE_AGENT}" \
  --role="roles/iam.serviceAccountTokenCreator" --quiet
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None --quiet 2>/dev/null || true
for workload_identity in "$SA_EMAIL" "$MIGRATE_SA_EMAIL"; do
  gcloud iam service-accounts add-iam-policy-binding "$workload_identity" \
    --member="serviceAccount:${BUILD_SA_EMAIL}" \
    --role="roles/iam.serviceAccountUser" --quiet
done

CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for legacy_member in "serviceAccount:${CB_SA}" "serviceAccount:${COMPUTE_SA}"; do
  for legacy_role in \
    roles/artifactregistry.writer \
    roles/cloudsql.admin \
    roles/iam.serviceAccountUser \
    roles/run.admin \
    roles/secretmanager.secretAccessor \
    roles/secretmanager.viewer
  do
    gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
      --member="$legacy_member" --role="$legacy_role" \
      --condition=None --quiet 2>/dev/null || true
  done
done
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None --quiet 2>/dev/null || true

echo "==> Auth.js AUTH_SECRET"
if ! gcloud secrets describe mesadesk-auth-secret &>/dev/null; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create mesadesk-auth-secret --data-file=-
  echo "Created mesadesk-auth-secret."
else
  echo "Secret mesadesk-auth-secret already exists."
fi

echo "==> Onboarding allowlist (product owner emails)"
if ! gcloud secrets describe mesadesk-onboarding-emails &>/dev/null; then
  printf '%s' 'aroul303@gmail.com' | gcloud secrets create mesadesk-onboarding-emails --data-file=-
  echo "Created mesadesk-onboarding-emails (default: aroul303@gmail.com)."
  echo "  To change: printf 'you@example.com' | gcloud secrets versions add mesadesk-onboarding-emails --data-file=-"
else
  echo "Secret mesadesk-onboarding-emails already exists."
fi

create_base64_secret() {
  local name="$1"
  if ! gcloud secrets describe "$name" &>/dev/null; then
    openssl rand -base64 32 | tr -d '\n' | gcloud secrets create "$name" --data-file=-
    echo "Created $name."
  else
    echo "Secret $name already exists."
  fi
}

echo "==> MesaERP encryption and independent trust-domain keys"
create_base64_secret mesadesk-vendor-bank-key
create_base64_secret mesadesk-erp-ops-handoff-key
create_base64_secret mesadesk-ops-statutory-key
create_base64_secret mesadesk-erp-external-evidence-key

echo "==> Least-privilege per-secret runtime access"
for secret in \
  mesadesk-database-url \
  mesadesk-auth-secret \
  mesadesk-onboarding-emails \
  mesadesk-vendor-bank-key \
  mesadesk-erp-ops-handoff-key \
  mesadesk-ops-statutory-key \
  mesadesk-erp-external-evidence-key
do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" --quiet
done
gcloud secrets add-iam-policy-binding mesadesk-direct-database-url \
  --member="serviceAccount:${MIGRATE_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" --quiet

# Build identity may read Neon project id + API key for the pre-release snapshot
# gate, and may resolve numeric secret versions (viewer already granted). Grant
# accessor only on the Neon ops secrets — never on application crypto keys.
for secret in mesadesk-neon-project-id mesadesk-neon-api-key; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${BUILD_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" --quiet
done

cat <<EOF

Done (Neon bootstrap).

Next:
  1. In Neon: confirm scale-to-zero, >=7 day history, protected production branch,
     app_user least-privilege, then run setup-roles via DIRECT_DATABASE_URL
     (see docs/ops/deploy-gcp.md).
  2. Deploy:
       gcloud builds submit --config cloudbuild.yaml \\
         --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA_EMAIL}" \\
         --substitutions=_REGION=${REGION},_REPO=${REPO},_SERVICE=${SERVICE},_APP_URL=https://your-origin

Cloud Run service account:
  ${SA_EMAIL}
Cloud Run migration service account:
  ${MIGRATE_SA_EMAIL}
Cloud Build trigger service account:
  ${BUILD_SA_EMAIL}
EOF
