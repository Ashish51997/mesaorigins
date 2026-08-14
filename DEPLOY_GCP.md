# MesaDesk production release runbook (Google Cloud)

MesaDesk runs as one Cloud Run service backed by Cloud SQL for PostgreSQL 16,
Artifact Registry and Secret Manager. The application container connects with
the least-privilege `app_user`; only the one-shot migration job receives the
owner connection.

The pipeline never seeds, resets or recreates customer data.

## 1. Required production controls

Use one region for Cloud Run, Cloud SQL and Artifact Registry. The checked-in
defaults use `asia-south1`.

Cloud SQL must have all of these before a release can migrate data:

- regional high availability;
- automated backups and point-in-time recovery;
- deletion protection;
- an on-demand pre-release backup created by Cloud Build.

Cloud Build stops before migration if any durability control is absent.

The runtime revision is also fail-closed until `/api/ready` confirms:

- production configuration and all four 32-byte cryptographic keys;
- database connectivity through a non-superuser, non-`BYPASSRLS` role;
- every migration packaged with the image is applied and no migration is left unfinished.

`/api/health` remains a cheap process liveness check. Do not use it as the
release-readiness signal.

## 2. Bootstrap or harden the project

```bash
export PROJECT_ID=football-analysis-473513
export REGION=asia-south1
export INSTANCE=mesadesk-pg
gcloud config set project "$PROJECT_ID"

chmod +x scripts/gcp/*.sh
./scripts/gcp/provision.sh
```

New databases use a dedicated-core tier, regional HA, 30 retained backups,
seven days of transaction logs, PITR and deletion protection.

For an existing instance, explicitly apply the production durability upgrade:

```bash
HARDEN_EXISTING_SQL=1 ./scripts/gcp/provision.sh
```

This can restart the instance and changes its cost profile. Schedule the first
upgrade in a maintenance window, then verify:

```bash
gcloud sql instances describe "$INSTANCE" --format='yaml(
  settings.availabilityType,
  settings.backupConfiguration,
  settings.deletionProtectionEnabled
)'
```

The provisioner creates or verifies these required secrets:

| Secret | Runtime purpose |
|---|---|
| `mesadesk-database-url` | least-privilege application connection |
| `mesadesk-direct-database-url` | migration owner connection; migration job only |
| `mesadesk-auth-secret` | Auth.js session signing |
| `mesadesk-onboarding-emails` | internal onboarding allowlist |
| `mesadesk-vendor-bank-key` | vendor-bank encryption |
| `mesadesk-erp-ops-handoff-key` | MesaERP-to-MesaOps snapshot signatures |
| `mesadesk-ops-statutory-key` | MesaERP-issued statutory evidence signatures |
| `mesadesk-erp-external-evidence-key` | external-evidence verifier attestations |

If an existing Cloud SQL instance predates these secrets, supply its two socket
connection URLs only for that bootstrap invocation:

```bash
MESADESK_DATABASE_URL_VALUE='postgresql://app_user:REDACTED@localhost/masspolimer?host=/cloudsql/PROJECT:REGION:INSTANCE&schema=public' \
MESADESK_DIRECT_DATABASE_URL_VALUE='postgresql://OWNER:REDACTED@localhost/masspolimer?host=/cloudsql/PROJECT:REGION:INSTANCE&schema=public' \
./scripts/gcp/provision.sh
```

The values are streamed directly into Secret Manager and are never echoed.

Cryptographic secrets are independently generated. Do not reuse a value across
trust domains. Cloud Build resolves the newest enabled numeric version and pins
that version to the release; it never mounts `latest` on a revision.

The provisioner also separates identities:

- `mesadesk-run` can connect to Cloud SQL and access only the seven runtime secrets;
- `mesadesk-migrate` can connect to Cloud SQL and access only the direct owner URL;
- `mesadesk-build` can build images, create backups, deploy and impersonate the
  two workload identities, but cannot read application secret values.

Configure the repository trigger to execute as
`mesadesk-build@PROJECT_ID.iam.gserviceaccount.com`. Do not reuse the runtime
identity as a Cloud Build trigger identity.

The release migration job applies `setup-roles.sql` idempotently before the
read-only preflight and migration chain, so a first release cannot accidentally
create tables without runtime grants. `scripts/gcp/migrate.sh` remains a manual
operator/recovery path. Do not set `SEED=1` against production.

## 3. Public origin and proxy trust

`APP_URL` and `AUTH_URL` are pinned to the same public HTTPS origin. The first
release must provide it explicitly. Later releases can omit `_APP_URL` and the
pipeline reuses the existing service URL.

Cloud Run uses one trusted proxy hop, so production is deployed with
`TRUST_PROXY_HOPS=1`. Do not use Express `trust proxy=true`.

For a first release:

```bash
export APP_URL=https://your-production-origin.example
gcloud builds submit --config cloudbuild.yaml \
  --service-account="projects/$PROJECT_ID/serviceAccounts/mesadesk-build@$PROJECT_ID.iam.gserviceaccount.com" \
  --substitutions=_REGION="$REGION",_SERVICE=mesadesk,_INSTANCE="$INSTANCE",_APP_URL="$APP_URL"
```

For an existing service URL:

```bash
gcloud builds submit --config cloudbuild.yaml \
  --service-account="projects/$PROJECT_ID/serviceAccounts/mesadesk-build@$PROJECT_ID.iam.gserviceaccount.com" \
  --substitutions=_REGION="$REGION",_SERVICE=mesadesk,_INSTANCE="$INSTANCE"
```

Do not push the working tree directly to the automatic production branch until
the complete quality gate is green.

## 4. What the release pipeline does

`cloudbuild.yaml` performs these steps in order:

1. Builds a quality image.
2. Starts a disposable PostgreSQL 16 database.
3. Applies the complete migration chain, seeds only that disposable database,
   then runs frontend/server type checks, unit tests, integration tests, OpenAPI
   determinism, the production dependency audit and the production build.
   `RUN_MESAERP_DB_INTEGRATION=1` is mandatory so database suites cannot skip.
4. Builds and pushes immutable application and migration images tagged with the
   Cloud Build ID.
5. Verifies Cloud SQL durability controls and creates an on-demand backup.
6. Reasserts the least-privilege runtime role, then runs the read-only MesaERP
   preflight and `prisma migrate deploy` in a single-task, zero-retry Cloud Run
   Job using the owner connection.
7. Deploys a revision with no traffic and a unique candidate URL.
8. Smoke-tests candidate readiness, OpenAPI and the SPA.
   It also verifies security headers, rejects development identity headers,
   confirms an unauthenticated MesaERP request fails closed, and proves server
   bundles/source maps return 404.
9. Sends 100% traffic to the verified revision and checks the stable URL.
10. Rolls traffic back to the prior revision if the stable check fails, then
    removes the temporary candidate tag after success.
11. Publishes `latest` only after successful promotion.

All database migrations are forward-only and additive. A failed candidate does
not receive traffic, while the previous revision remains active against the
forward-migrated database.

## 5. Post-release verification

```bash
SERVICE_URL="$(gcloud run services describe mesadesk \
  --region="$REGION" --format='value(status.url)')"

curl --fail --silent --show-error "$SERVICE_URL/api/health"
curl --fail --silent --show-error "$SERVICE_URL/api/ready"
curl --fail --silent --show-error "$SERVICE_URL/api/openapi.json" >/dev/null

gcloud run services describe mesadesk --region="$REGION" \
  --format='yaml(status.latestReadyRevisionName,status.traffic)'
gcloud run revisions describe \
  "$(gcloud run services describe mesadesk --region="$REGION" --format='value(status.latestReadyRevisionName)')" \
  --region="$REGION" --format='yaml(spec.containers[0].env,status.conditions)'
```

Confirm that secret references show numeric versions, the runtime environment
has `DEV_AUTH=0`, and `/api/ready` reports a least-privilege database role with
zero pending migrations.

## 6. Rotation and rollback

Adding a new secret version does not silently change a running revision. Run the
release pipeline to pin and verify the new version.

Application rollback is a Cloud Run traffic operation:

```bash
gcloud run revisions list --service=mesadesk --region="$REGION"
gcloud run services update-traffic mesadesk --region="$REGION" \
  --to-revisions=PREVIOUS_REVISION=100
```

Database migrations are not rolled back automatically. Correct a migration
with a new forward migration. Restore from the pre-release backup only through
an incident-reviewed recovery procedure.

## 7. Troubleshooting

| Symptom | Action |
|---|---|
| Safety gate reports zonal or backups disabled | Run the explicit existing-instance hardening step and verify Cloud SQL settings. |
| Migration preflight stops on split plans | Reconcile each legacy planned quantity; never guess or reset the database. |
| Candidate `/api/ready` is 503 | Read candidate logs and inspect configuration, runtime DB role and migration counts. Do not promote it. |
| `APP_URL` validation fails | Supply the exact public HTTPS origin with `_APP_URL`; do not use an internal or HTTP address. |
| Secret version cannot be resolved | Create/enable a version, then rerun. Do not replace numeric pinning with `latest`. |
| Runtime role is unsafe | Correct `mesadesk-database-url` to use `app_user` and reapply `setup-roles.sql`. |
| Artifact push is denied | Grant the trigger's actual build service account Artifact Registry writer access. |
| Migration job cannot connect | Verify its Cloud SQL attachment and the owner socket URL in `mesadesk-direct-database-url`. |
