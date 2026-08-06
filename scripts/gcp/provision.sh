#!/usr/bin/env bash
# One-time GCP bootstrap for Mesadesk (Cloud SQL + Artifact Registry + secrets + IAM).
# Prerequisites: gcloud auth login, billing on the project.
#
# Usage:
#   export PROJECT_ID=mesadesk-prod   # or your project
#   export REGION=asia-south1
#   ./scripts/gcp/provision.sh

set -euo pipefail


PROJECT_ID="${PROJECT_ID:-football-analysis-473513}"
REGION="${REGION:-asia-south1}"
INSTANCE="${INSTANCE:-mesadesk-pg}"
# ENTERPRISE + shared-core (cheap). ENTERPRISE_PLUS requires db-perf-optimized-N-*.
EDITION="${EDITION:-ENTERPRISE}"
TIER="${TIER:-db-f1-micro}"
DB_NAME="${DB_NAME:-masspolimer}"
DB_OWNER="${DB_OWNER:-masspolimer}"
DB_APP="${DB_APP:-app_user}"
REPO="${REPO:-mesadesk}"
SERVICE="${SERVICE:-mesadesk}"
SA_NAME="mesadesk-run"

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
    --description="Mesadesk images"
fi

echo "==> Cloud SQL Postgres 16 ($INSTANCE)"
if ! gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" &>/dev/null; then
  # Generate passwords (printed once — store in Secret Manager / password manager).
  OWNER_PASS="$(openssl rand -base64 24 | tr -d '=+/')"
  APP_PASS="$(openssl rand -base64 24 | tr -d '=+/')"
  echo "Generated DB passwords (save these):"
  echo "  OWNER ($DB_OWNER): $OWNER_PASS"
  echo "  APP   ($DB_APP):   $APP_PASS"

  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_16 \
    --edition="$EDITION" \
    --tier="$TIER" \
    --region="$REGION" \
    --storage-size=20 \
    --storage-auto-increase \
    --availability-type=ZONAL \
    --root-password="$OWNER_PASS"

  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE"

  # Cloud SQL root is `postgres`. Create app roles matching local docker-compose.
  # Use Cloud SQL Auth Proxy later for setup-roles.sql; here create users.
  gcloud sql users create "$DB_OWNER" --instance="$INSTANCE" --password="$OWNER_PASS" || true
  gcloud sql users create "$DB_APP" --instance="$INSTANCE" --password="$APP_PASS" || true

  SOCKET="/cloudsql/${PROJECT_ID}:${REGION}:${INSTANCE}"
  # Prisma + Cloud SQL connector (Unix socket).
  DATABASE_URL="postgresql://${DB_APP}:${APP_PASS}@localhost/${DB_NAME}?host=${SOCKET}&schema=public"
  DIRECT_DATABASE_URL="postgresql://${DB_OWNER}:${OWNER_PASS}@localhost/${DB_NAME}?host=${SOCKET}&schema=public"

  printf '%s' "$DATABASE_URL" | gcloud secrets create mesadesk-database-url --data-file=- 2>/dev/null \
    || printf '%s' "$DATABASE_URL" | gcloud secrets versions add mesadesk-database-url --data-file=-
  printf '%s' "$DIRECT_DATABASE_URL" | gcloud secrets create mesadesk-direct-database-url --data-file=- 2>/dev/null \
    || printf '%s' "$DIRECT_DATABASE_URL" | gcloud secrets versions add mesadesk-direct-database-url --data-file=-

  echo "Secrets mesadesk-database-url and mesadesk-direct-database-url created."
else
  echo "Instance $INSTANCE already exists — skipping create. Update secrets manually if needed."
fi

echo "==> Runtime service account"
if ! gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="Mesadesk Cloud Run"
fi
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
# --condition=None required when the project policy already has conditional bindings.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None --quiet
# If Cloud Build trigger runs as mesadesk-run, it must be able to push images.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --condition=None --quiet

# Cloud Build default SA can deploy Run + push images
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin" \
  --condition=None --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None --quiet
# Required to docker push → asia-south1-docker.pkg.dev/.../mesadesk
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None --quiet
# Newer Cloud Build worker pools often act as the Compute default SA
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None --quiet

echo "==> Firebase secret placeholder"
if ! gcloud secrets describe mesadesk-firebase-sa &>/dev/null; then
  echo '{"hint":"Replace with Firebase Admin SDK JSON"}' | gcloud secrets create mesadesk-firebase-sa --data-file=-
  echo "Created mesadesk-firebase-sa placeholder — replace with real JSON:"
  echo "  gcloud secrets versions add mesadesk-firebase-sa --data-file=./firebase-admin.json"
fi

cat <<EOF

Done (bootstrap).

Next:
  1. Apply roles + migrate (see DEPLOY_GCP.md § migrate)
  2. Upload Firebase Admin JSON → mesadesk-firebase-sa
  3. Deploy:
       gcloud builds submit --config cloudbuild.yaml \\
         --substitutions=_REGION=${REGION},_SERVICE=${SERVICE},_INSTANCE=${INSTANCE}

Cloud Run service account to use (optional override in deploy):
  ${SA_EMAIL}
EOF
