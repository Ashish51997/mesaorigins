# MesaOrigins production release runbook (Cloud Run + Neon)

MesaOrigins runs as one Cloud Run service backed by **Neon PostgreSQL 16**,
Artifact Registry and Secret Manager. The application container connects with
the least-privilege `app_user` pooled URL; only the one-shot migration job
receives the unpooled owner connection.

Scale-to-zero is on for **both** Cloud Run (`min-instances=0`) and Neon
(compute suspends after idle). Topology and cost stages:
[docs/architecture/production.md](../architecture/production.md).

The pipeline never seeds, resets or recreates customer data.

## 1. Required production controls

Use one region for Cloud Run and Artifact Registry. The checked-in defaults use
`asia-southeast1` so the API sits next to Neon `aws-ap-southeast-1`. Neon has no
Mumbai region; do not split the API into `asia-south1` against Singapore Neon.

Neon must have all of these before a release can migrate data:

- scale-to-zero enabled (Launch default; do not pin always-on for the pilot);
- history / instant-restore window of at least **7 days**;
- production branch **protected**;
- a pre-release snapshot (or restore branch) created by Cloud Build.

Cloud Build stops before migration if the Neon safety gate fails.

The runtime revision is also fail-closed until `/api/ready` confirms:

- production configuration and all four 32-byte cryptographic keys;
- database connectivity through a non-superuser, non-`BYPASSRLS` role;
- every migration packaged with the image is applied and no migration is left unfinished;
- the integration outbox worker is enabled (on-demand drain in production).

`/api/health` remains a cheap process liveness check. Do not use it as the
release-readiness signal.

## 2. Bootstrap the project

Create the Neon project in the console first (Singapore / `aws-ap-southeast-1`):

1. Enable scale-to-zero.
2. Set history retention ≥ 7 days.
3. Protect the production branch.
4. Create database roles matching local Compose: owner for migrations and
   `app_user` for runtime (no superuser / `BYPASSRLS`).
5. Copy the **pooled** connection string for `app_user` and the **unpooled**
   string for the owner.

```bash
export PROJECT_ID=football-analysis-473513
export REGION=asia-southeast1
gcloud config set project "$PROJECT_ID"

chmod +x scripts/gcp/*.sh

MESAORIGINS_DATABASE_URL_VALUE='postgresql://app_user:REDACTED@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=30&connection_limit=5&pool_timeout=20&schema=public' \
MESAORIGINS_DIRECT_DATABASE_URL_VALUE='postgresql://neondb_owner:REDACTED@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30&schema=public' \
MESAORIGINS_NEON_PROJECT_ID_VALUE='your-neon-project-id' \
MESAORIGINS_NEON_API_KEY_VALUE='your-neon-api-key' \
./scripts/gcp/provision.sh
```

Values are streamed directly into Secret Manager and are never echoed.

Required secrets:

| Secret | Runtime purpose |
|---|---|
| `mesadesk-database-url` | least-privilege pooled application connection |
| `mesadesk-direct-database-url` | migration owner connection; migration job only |
| `mesadesk-neon-project-id` | Cloud Build Neon safety gate |
| `mesadesk-neon-api-key` | Cloud Build Neon snapshot / branch API |
| `mesadesk-auth-secret` | Auth.js session signing |
| `mesadesk-onboarding-emails` | internal onboarding allowlist |
| `mesadesk-vendor-bank-key` | vendor-bank encryption |
| `mesadesk-erp-ops-handoff-key` | MesaERP-to-MesaOps snapshot signatures |
| `mesadesk-ops-statutory-key` | MesaERP-issued statutory evidence signatures |
| `mesadesk-erp-external-evidence-key` | external-evidence verifier attestations |

Cryptographic secrets are independently generated. Do not reuse a value across
trust domains. Cloud Build resolves the newest enabled numeric version and pins
that version to the release; it never mounts `latest` on a revision.

Identities:

- `mesadesk-run` accesses only the seven runtime secrets (no owner URL, no Neon API key);
- `mesadesk-migrate` accesses only the direct owner URL;
- `mesadesk-build` can build images, run the Neon gate, deploy and impersonate the
  two workload identities, but cannot read application crypto secret values.

Configure the repository trigger to execute as
`mesadesk-build@PROJECT_ID.iam.gserviceaccount.com`.

After secrets exist, apply roles and migrations once with the owner URL:

```bash
DIRECT_DATABASE_URL='postgresql://neondb_owner:REDACTED@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30&schema=public' \
./scripts/gcp/migrate.sh
```

Do not set `SEED=1` against production.

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
  --substitutions=_REGION="$REGION",_REPO=mesaorigins,_SERVICE=mesadesk,_APP_URL="$APP_URL"
```

For an existing service URL:

```bash
gcloud builds submit --config cloudbuild.yaml \
  --service-account="projects/$PROJECT_ID/serviceAccounts/mesadesk-build@$PROJECT_ID.iam.gserviceaccount.com" \
  --substitutions=_REGION="$REGION",_REPO=mesaorigins,_SERVICE=mesadesk
```

Do not push the working tree directly to the automatic production branch until
the complete quality gate is green.

## 4. What the release pipeline does

`cloudbuild.yaml` performs these steps in order:

1. Builds a quality image.
2. Starts disposable PostgreSQL 16 with separate bootstrap, non-super migration
   owner and least-privilege runtime roles (CI never points at Neon).
3. Proves a two-tenant legacy upgrade and cross-tenant denial, then applies the
   complete clean migration chain, seeds only the disposable database, and runs
   frontend/server type checks, unit tests, integration tests, OpenAPI
   determinism, both dependency audits and the production build.
   `RUN_MESAERP_DB_INTEGRATION=1` is mandatory so database suites cannot skip.
4. Builds and pushes immutable application and migration images tagged with the
   Cloud Build ID.
5. Runs `scripts/gcp/neon-pre-release.sh`: verifies Neon history ≥ 7 days,
   protected production branch, and creates a pre-release snapshot/restore point.
6. Runs `prisma migrate deploy` in a single-task, zero-retry Cloud Run Job using
   the owner connection (no Cloud SQL socket attachment).
7. Deploys a revision with no traffic, `min-instances=0`, CPU throttling on, and a
   unique candidate URL. Startup probe allows up to ~3 minutes for Neon cold start.
8. Smoke-tests candidate readiness, OpenAPI and the SPA.
9. Sends 100% traffic to the verified revision and checks the stable URL.
10. Rolls traffic back to the prior revision if the stable check fails.
11. Publishes `latest` only after successful promotion.

All database migrations are forward-only and additive. A failed candidate does
not receive traffic, while the previous revision remains active against the
forward-migrated database.

**Cost note:** the full promote path is ~25–45 minutes on `E2_HIGHCPU_8`
(~$0.40–$0.70 per release). Run quality-only CI on PRs; promote only from the
release branch. See [production.md](../architecture/production.md).

## 5. Scale-to-zero and cold start

Production Cloud Run uses `min-instances=0` and default CPU throttling. The
integration outbox drains on process start and after each outbox insert; it does
**not** poll every 2 seconds. That lets Prisma connections close when the
instance scales to zero so Neon can suspend.

| Path | Expectation |
|---|---|
| Warm shop-floor API | p95 &lt; 300 ms |
| First request after overnight idle | ~2–8 s (Neon resume + container start) |

`/api/ready` and smoke retries tolerate the cold path. Do not add a Cloud
Scheduler ping; it would erase overnight savings.

To pin always-on later (only if a 3-shift plant requires it): disable Neon
scale-to-zero and deploy with `--min-instances=1 --no-cpu-throttling`. Both
layers must stay awake together or Neon will never sleep.

## 6. Post-release verification

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
has `DEV_AUTH=0`, `/api/ready` reports a least-privilege database role with zero
pending migrations, and `integrationOutbox.continuousPolling` is `false`.

### Provision a production platform administrator

Run this only through the privileged migration connection after migrations.
The email must also be in the `ONBOARDING_ALLOWED_EMAILS` value mounted on
Cloud Run. The utility never prints the password or password hash.

```bash
umask 077
openssl rand -base64 24 > /tmp/mesaorigins-platform-admin-password
chmod 600 /tmp/mesaorigins-platform-admin-password

DIRECT_DATABASE_URL='postgresql://...' \
PLATFORM_ADMIN_EMAIL='admin@example.com' \
PLATFORM_ADMIN_PASSWORD_FILE='/tmp/mesaorigins-platform-admin-password' \
PLATFORM_ADMIN_ORGANIZATION='demo' \
ONBOARDING_ALLOWED_EMAILS='admin@example.com' \
npm run provision:platform-admin
```

If the email already exists, the command stops without changing it. After
verifying that identity, set `PLATFORM_ADMIN_REUSE_EXISTING=1`. To deliberately
replace its password, also set `PLATFORM_ADMIN_ROTATE_EXISTING=1`; the password
update and revocation of all existing sessions are atomic. Remove the temporary
password file after storing the credential in an approved password manager.

## 7. Staging

Prefer a Neon **branch** of production (scale-to-zero on) and a separate Cloud
Run service with `min-instances=0`. Do not provision a second always-on database
for staging.

## 8. Rotation and rollback

Adding a new secret version does not silently change a running revision. Run the
release pipeline to pin and verify the new version.

Application rollback is a Cloud Run traffic operation:

```bash
gcloud run revisions list --service=mesadesk --region="$REGION"
gcloud run services update-traffic mesadesk --region="$REGION" \
  --to-revisions=PREVIOUS_REVISION=100
```

Database migrations are not rolled back automatically. Correct a migration
with a new forward migration. Restore from the pre-release Neon snapshot only
through an incident-reviewed recovery procedure.

## 9. Troubleshooting

| Symptom | Action |
|---|---|
| Neon safety gate fails history/protected branch | In Neon console set ≥7 day history and protect the production branch, then rerun. |
| Snapshot API unavailable | The gate falls back to a named restore branch; if both fail, check the Neon API key scopes. |
| Migration job cannot connect | Confirm `mesadesk-direct-database-url` is the **unpooled** Neon host with `connect_timeout=30`. |
| Candidate `/api/ready` is 503 | Read candidate logs; allow for Neon cold start. Inspect configuration, runtime DB role and migration counts. Do not promote. |
| First morning request is slow | Expected with scale-to-zero (2–8 s). Only pin always-on if a paying plant requires it. |
| Neon never suspends | Ensure Cloud Run `min-instances=0`, CPU throttling on, and outbox continuous polling is off in production. |
| `APP_URL` validation fails | Supply the exact public HTTPS origin with `_APP_URL`; do not use an internal or HTTP address. |
| Secret version cannot be resolved | Create/enable a version, then rerun. Do not replace numeric pinning with `latest`. |
| Artifact push is denied | Grant the trigger's actual build service account Artifact Registry writer access. |
| Migration owner is blocked by forced RLS | Do not disable RLS or grant runtime bypass. Confirm every forced table is owned by the direct migration identity and has `migration_owner_all_tenants` restricted to that exact owner/session. |
