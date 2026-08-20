#!/usr/bin/env bash
# One-time GCP bootstrap for MesaOrigins (Cloud SQL + Artifact Registry + secrets + IAM).
# Prerequisites: gcloud auth login, billing on the project.
#
# Usage:
#   export PROJECT_ID=mesaorigins-prod   # or your project
#   export REGION=asia-south1
#   ./scripts/gcp/provision.sh

set -euo pipefail


PROJECT_ID="${PROJECT_ID:-football-analysis-473513}"
REGION="${REGION:-asia-south1}"
INSTANCE="${INSTANCE:-mesadesk-pg}"
# Regional HA requires a dedicated-core tier; shared-core db-f1-micro is not a
# suitable production financial-book database.
EDITION="${EDITION:-ENTERPRISE}"
TIER="${TIER:-db-custom-1-3840}"
DB_NAME="${DB_NAME:-masspolimer}"
DB_OWNER="${DB_OWNER:-masspolimer}"
DB_APP="${DB_APP:-app_user}"
REPO="${REPO:-mesadesk}"
SERVICE="${SERVICE:-mesadesk}"
SA_NAME="mesadesk-run"
MIGRATE_SA_NAME="mesadesk-migrate"
BUILD_SA_NAME="mesadesk-build"

echo "==> Project: $PROJECT_ID  region: $REGION"

gcloud config set project "$PROJECT_ID"

echo "==> Enable APIs"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
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

echo "==> Cloud SQL Postgres 16 ($INSTANCE)"
if ! gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" &>/dev/null; then
  # Generate credentials and stream their connection URLs directly into Secret
  # Manager. Credential values are never written to stdout.
  OWNER_PASS="$(openssl rand -base64 24 | tr -d '=+/')"
  APP_PASS="$(openssl rand -base64 24 | tr -d '=+/')"
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_16 \
    --edition="$EDITION" \
    --tier="$TIER" \
    --region="$REGION" \
    --storage-size=20 \
    --storage-auto-increase \
    --availability-type=REGIONAL \
    --root-password="$OWNER_PASS" \
    --backup-start-time=18:30 \
    --enable-point-in-time-recovery \
    --retained-backups-count=30 \
    --retained-transaction-log-days=7 \
    --deletion-protection

  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE"

  # Cloud SQL root is `postgres`. Create app roles matching local docker-compose.
  # Use Cloud SQL Auth Proxy later for setup-roles.sql; here create users.
  gcloud sql users create "$DB_OWNER" --instance="$INSTANCE" --password="$OWNER_PASS" || true
  gcloud sql users create "$DB_APP" --instance="$INSTANCE" --password="$APP_PASS" || true

  SOCKET="/cloudsql/${PROJECT_ID}:${REGION}:${INSTANCE}"
  # Prisma + Cloud SQL connector (Unix socket).
  DATABASE_URL="postgresql://${DB_APP}:${APP_PASS}@localhost/${DB_NAME}?host=${SOCKET}&schema=public&connection_limit=5&pool_timeout=10&connect_timeout=10"
  DIRECT_DATABASE_URL="postgresql://${DB_OWNER}:${OWNER_PASS}@localhost/${DB_NAME}?host=${SOCKET}&schema=public"

  printf '%s' "$DATABASE_URL" | gcloud secrets create mesadesk-database-url --data-file=- 2>/dev/null \
    || printf '%s' "$DATABASE_URL" | gcloud secrets versions add mesadesk-database-url --data-file=-
  printf '%s' "$DIRECT_DATABASE_URL" | gcloud secrets create mesadesk-direct-database-url --data-file=- 2>/dev/null \
    || printf '%s' "$DIRECT_DATABASE_URL" | gcloud secrets versions add mesadesk-direct-database-url --data-file=-

  echo "Secrets mesadesk-database-url and mesadesk-direct-database-url created."
else
  echo "Instance $INSTANCE already exists — skipping create."
  if [[ "${HARDEN_EXISTING_SQL:-0}" == "1" ]]; then
    echo "==> Enabling regional HA, backups, PITR and deletion protection"
    gcloud sql instances patch "$INSTANCE" --quiet \
      --tier="$TIER" \
      --availability-type=REGIONAL \
      --backup-start-time=18:30 \
      --enable-point-in-time-recovery \
      --retained-backups-count=30 \
      --retained-transaction-log-days=7 \
      --deletion-protection
  else
    echo "Set HARDEN_EXISTING_SQL=1 to apply the required production durability controls."
  fi
fi

# Cloud SQL assigns new built-in users the managed cloudsqlsuperuser database
# role by default. The application identity must not retain that effective
# membership. Remove every database-role assignment through the Cloud SQL Admin
# API for both new and existing instances; protected Cloud SQL role state cannot
# be made safe by the release migration's SQL alone.
echo "==> Revoke default Cloud SQL database roles from $DB_APP"
gcloud sql users assign-roles "$DB_APP" \
  --instance="$INSTANCE" \
  --project="$PROJECT_ID" \
  --type=BUILT_IN \
  --database-roles= \
  --revoke-existing-roles

# An existing instance may predate this provisioner. Never invent or print a
# replacement connection string: accept an operator-supplied value only when a
# required database secret is missing, and stream it directly to Secret Manager.
ensure_database_secret() {
  local secret_name="$1"
  local value_variable="$2"
  if gcloud secrets describe "$secret_name" &>/dev/null; then
    echo "Secret $secret_name already exists."
    return
  fi

  local secret_value="${!value_variable:-}"
  if [[ -z "$secret_value" ]]; then
    echo "Missing required secret $secret_name." >&2
    echo "Set $value_variable to the existing Cloud SQL socket URL and rerun; the value will not be printed." >&2
    exit 1
  fi
  printf '%s' "$secret_value" | gcloud secrets create "$secret_name" --data-file=-
  unset secret_value
  echo "Created $secret_name."
}

ensure_database_secret mesadesk-database-url MESAORIGINS_DATABASE_URL_VALUE
ensure_database_secret mesadesk-direct-database-url MESAORIGINS_DIRECT_DATABASE_URL_VALUE

echo "==> Runtime service account"
if ! gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="MesaOrigins Cloud Run"
fi
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
# --condition=None required when the project policy already has conditional bindings.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/logging.logWriter" \
  --condition=None --quiet
# Remove legacy project-wide grants. Runtime secret access is granted per
# secret below, and image publication belongs only to the build identity.
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
  --role="roles/cloudsql.client" --condition=None --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${MIGRATE_SA_EMAIL}" \
  --role="roles/logging.logWriter" --condition=None --quiet

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
  roles/secretmanager.viewer \
  roles/cloudsql.admin
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA_EMAIL}" \
    --role="$role" --condition=None --quiet
done

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

# The trigger uses BUILD_SA_EMAIL. Remove legacy privileges from the default
# Cloud Build and Compute identities so a bypass build cannot deploy releases.
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

cat <<EOF

Done (bootstrap).

Next:
  1. Apply roles + migrate (see DEPLOY_GCP.md § migrate)
  2. Deploy:
       gcloud builds submit --config cloudbuild.yaml \\
         --substitutions=_REGION=${REGION},_SERVICE=${SERVICE},_INSTANCE=${INSTANCE}

Cloud Run service account to use (optional override in deploy):
  ${SA_EMAIL}
Cloud Run migration service account:
  ${MIGRATE_SA_EMAIL}
Cloud Build trigger service account:
  ${BUILD_SA_EMAIL}
EOF
