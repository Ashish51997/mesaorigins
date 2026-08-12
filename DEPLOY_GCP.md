# Phase C — Deploy Mesadesk to Google Cloud

One Cloud Run service (Vite SPA + Express) + Cloud SQL Postgres 16 + Secret Manager + Firebase Auth (`DEV_AUTH=0`).

Region default: **asia-south1** (Mumbai). Override with `REGION`.

---

## 0. Prerequisites

1. [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
2. Billing enabled on the target project
3. Firebase project with Google sign-in (same as client `firebase-applet-config.json`)
4. Firebase **Admin SDK** service-account JSON downloaded from Firebase Console → Project settings → Service accounts

```bash
gcloud auth login
gcloud auth application-default login   # for local proxy / client libs
```

Pick or create a project (do **not** reuse unrelated apps):

```bash
export PROJECT_ID=mesadesk-prod   # change me
export REGION=asia-south1
export INSTANCE=mesadesk-pg

gcloud projects create "$PROJECT_ID" --name="Mesadesk"   # if new
gcloud billing projects link "$PROJECT_ID" --billing-account=YOUR_BILLING_ACCOUNT_ID
gcloud config set project "$PROJECT_ID"
```

---

## 1. Provision (APIs, SQL, secrets, IAM)

From the repo root:

```bash
chmod +x scripts/gcp/*.sh
./scripts/gcp/provision.sh
```

This creates:

| Resource | Name |
|----------|------|
| Artifact Registry | `mesadesk` (Docker) |
| Cloud SQL | `mesadesk-pg` (Postgres 16, **ENTERPRISE** + `db-f1-micro`) |
| DB | `masspolimer` |
| Users | `masspolimer` (owner), `app_user` (RLS runtime) |
| Secrets | `mesadesk-database-url`, `mesadesk-direct-database-url`, `mesadesk-firebase-sa` |
| SA | `mesadesk-run@…` (`cloudsql.client` + secret accessor) |

**Save the owner/app passwords** printed by the script.

Upload the real Firebase Admin JSON:

```bash
gcloud secrets versions add mesadesk-firebase-sa --data-file=./path/to/firebase-adminsdk.json
```

---

## 2. Schema + roles on Cloud SQL

Install [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy) (`brew install cloud-sql-proxy`).

Install [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy) if needed (`brew install cloud-sql-proxy`), then:

```bash
export PROJECT_ID=football-analysis-473513 REGION=asia-south1 INSTANCE=mesadesk-pg
./scripts/gcp/migrate.sh
# Demo data (optional):
SEED=1 ./scripts/gcp/migrate.sh
```

The script pulls `mesadesk-direct-database-url` from Secret Manager and rewrites it to `127.0.0.1:5433` for the proxy. You only need to set `DIRECT_DATABASE_URL` yourself if you prefer not to use gcloud.

`setup-roles.sql` grants `app_user` the same RLS-friendly privileges as local Docker.

Runtime URLs in Secret Manager stay on the **Unix socket** form Cloud Run expects:

```text
postgresql://app_user:APP_PASS@localhost/masspolimer?host=/cloudsql/PROJECT:REGION:INSTANCE&schema=public
```

---

## 3. Build & deploy

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=${REGION},_SERVICE=mesadesk,_INSTANCE=${INSTANCE}
```

Cloud Run settings applied by the build:

- `DEV_AUTH=0`, `NODE_ENV=production`, `PORT=8080`
- Secrets: `DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT`
- Cloud SQL attachment: `$PROJECT_ID:$REGION:$INSTANCE`
- Public HTTPS (`--allow-unauthenticated`); API still requires Firebase Bearer when `DEV_AUTH=0`

After deploy:

```bash
gcloud run services describe mesadesk --region="$REGION" --format='value(status.url)'
curl -sS "$(gcloud run services describe mesadesk --region="$REGION" --format='value(status.url)')/api/health"
# Expect: {"status":"ok","auth":"firebase",...}
```

Point Firebase **Authorized domains** at the `*.run.app` host (and custom domain if any).

Set `APP_URL` to the Cloud Run URL if you use absolute links:

```bash
gcloud run services update mesadesk --region="$REGION" \
  --update-env-vars=APP_URL=https://YOUR-SERVICE-xxxxx.run.app
```

Optional: run as dedicated SA:

```bash
gcloud run services update mesadesk --region="$REGION" \
  --service-account=mesadesk-run@${PROJECT_ID}.iam.gserviceaccount.com
```

---

## 4. Client / auth checklist

| Item | Value |
|------|--------|
| `DEV_AUTH` | `0` on Cloud Run |
| `AUTH_SECRET` | Secret Manager → `mesadesk-auth-secret` (≥32 chars). Required for password login + onboarding. |
| `ONBOARDING_ALLOWED_EMAILS` | Secret Manager → `mesadesk-onboarding-emails` (e.g. `aroul303@gmail.com`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional Google OAuth; redirect `{APP_URL}/auth/callback/google` |
| Login UI | Google and/or email+password when `/api/health` → `auth: "authjs"` |
| People directory | Email must exist as a `User` with membership; set passwords via `POST /api/employees/:id/password` or seed |

### Fix: `AUTH_SECRET is not set` on Cloud Run

Create the secret (once), then mount it on the service:

```bash
# Create / rotate Auth.js secret (≥32 chars)
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create mesadesk-auth-secret --data-file=- \
  || openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add mesadesk-auth-secret --data-file=-

# Product-owner allowlist for /onboarding
printf '%s' 'aroul303@gmail.com' | gcloud secrets create mesadesk-onboarding-emails --data-file=- \
  || printf '%s' 'aroul303@gmail.com' | gcloud secrets versions add mesadesk-onboarding-emails --data-file=-

# Mount on the running service (immediate fix without full rebuild)
gcloud run services update mesadesk --region="$REGION" \
  --update-secrets=AUTH_SECRET=mesadesk-auth-secret:latest,ONBOARDING_ALLOWED_EMAILS=mesadesk-onboarding-emails:latest \
  --update-env-vars=DEV_AUTH=0,NODE_ENV=production

# Confirm
curl -sS "$(gcloud run services describe mesadesk --region="$REGION" --format='value(status.url)')/api/health"
# expect: "auth":"authjs"
```

Future Cloud Build deploys pick these up via `cloudbuild.yaml` `--set-secrets`.

### Provision the production platform administrator

Run this only through the privileged migration connection, after migrations.
The email must also be present in the `ONBOARDING_ALLOWED_EMAILS` value mounted
on Cloud Run. The utility never prints the password or hash.

```bash
umask 077
openssl rand -base64 24 > /tmp/mesadesk-platform-admin-password
chmod 600 /tmp/mesadesk-platform-admin-password

DIRECT_DATABASE_URL='postgresql://...' \
PLATFORM_ADMIN_EMAIL='admin@example.com' \
PLATFORM_ADMIN_PASSWORD_FILE='/tmp/mesadesk-platform-admin-password' \
PLATFORM_ADMIN_ORGANIZATION='demo' \
ONBOARDING_ALLOWED_EMAILS='admin@example.com' \
npm run provision:platform-admin
```

If the email already exists, the command stops without changing it. After
verifying that identity, set `PLATFORM_ADMIN_REUSE_EXISTING=1`. To deliberately
replace its password, also set `PLATFORM_ADMIN_ROTATE_EXISTING=1`; the password
update and revocation of all existing sessions are atomic. Remove the temporary
password file after storing the credential in an approved password manager.

---

## 5. Local vs production

| | Local (Phase A/B) | Cloud (Phase C) |
|--|-------------------|-----------------|
| Postgres | Docker `:5432` | Cloud SQL + socket |
| Auth | `DEV_AUTH=1` picker OK | `DEV_AUTH=0` + Auth.js (`AUTH_SECRET`) |
| Image | `npm run dev` | Cloud Build → Cloud Run |

Do not commit `.env` or OAuth client secrets. Rotate DB passwords in Secret Manager and update Cloud SQL users if leaked.

---

## 6. Costs (ballpark)

- Cloud SQL ENTERPRISE `db-f1-micro`: always-on; stop/delete when unused to avoid charges
  (Enterprise Plus needs `db-perf-optimized-N-*` — override with `EDITION=ENTERPRISE_PLUS TIER=db-perf-optimized-N-2`)
- Cloud Run: scale-to-zero with `--min-instances=0`
- Artifact Registry + Secret Manager: negligible at this scale

Tear down:

```bash
gcloud run services delete mesadesk --region="$REGION" --quiet
gcloud sql instances delete "$INSTANCE" --quiet
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `P1001` / can't reach DB | Confirm `--add-cloudsql-instances` and socket `host=/cloudsql/...` in secret |
| `auth: "dev"` in prod | `DEV_AUTH` still `1` — set `0` on the service |
| 401 after Google login | User email missing in DB; or wrong Firebase project / Admin JSON |
| Prisma engine error | Image must include `debian-openssl-3.0.x` binary (see `schema.prisma`) |
| Cloud Build can't deploy | Grant Cloud Build SA `roles/run.admin` + `roles/iam.serviceAccountUser` (provision script does this) |
| `uploadArtifacts` / Artifact Registry denied | Grant **the SA the trigger actually runs as** `roles/artifactregistry.writer`. Check with `gcloud builds describe BUILD_ID --format='value(serviceAccount)'` — often `mesadesk-run@…`, not the default Cloud Build SA. Also confirm repo `mesadesk` exists in `asia-south1` |
