# MesaOrigins production architecture (Neon)

MesaOrigins runs as **one React + Express Cloud Run service** backed by **Neon
PostgreSQL 16**. The three product services (MesaLeads, MesaERP, MesaOps) stay
inside the modular monolith. There is no Kubernetes, no Redis on day one, and no
Cloud SQL for the default pooled SaaS.

Scale-to-zero is **on for both Cloud Run and Neon**. That is what keeps pilot
cost near **$25–45/month** instead of a Cloud SQL regional-HA bill near
**$210–260/month**.

See also: [architecture.md](./architecture.md), [api-services.md](./api-services.md),
[ops/deploy-gcp.md](../ops/deploy-gcp.md).

## Topology

```text
Shop-floor tablets / office browsers / supplier portal
        |
        | HTTPS (Cloudflare DNS / TLS)
        v
Cloud Run (asia-southeast1)
  SPA (dist/client) + Express API
  Auth.js -> tenant -> entitlement -> permission
  Prisma pooler URL (app_user)
  Outbox drain on start + after emit (no 2s keep-alive)
        |
        | TCP TLS
        v
Neon Postgres 16 (aws-ap-southeast-1)
  PgBouncer pooler -> compute (scale-to-zero) -> storage + RLS + outbox
```

| Layer | Choice |
| --- | --- |
| App | One Cloud Run service, `min-instances=0`, CPU throttled |
| DB | Neon Launch, scale-to-zero after ~5 min idle, autoscale while awake |
| Region | Neon `aws-ap-southeast-1` + Cloud Run `asia-southeast1` (colocated) |
| Pooling | `DATABASE_URL` = Neon pooler; `DIRECT_DATABASE_URL` = unpooled (migrate only) |
| RLS | `set_config('app.current_tenant', …, true)` inside `$transaction` (SET LOCAL) |
| CI database | Disposable Postgres in Cloud Build — never the shared Neon project |
| Staging | Neon branch + Cloud Run min 0 |
| Files | Defer Cloudflare R2 until attachments ship |
| India residency silo | Extra Neon project later, or Cloud SQL `asia-south1` (BR-08) |

Neon has **no Mumbai region**. Putting the API in Mumbai against Neon Singapore
adds roughly 50–80 ms per SQL round-trip and breaks the warm p95 &lt; 300 ms
budget. India clients pay about 100–140 ms HTTPS RTT to Singapore; that is
acceptable for warm shop-floor traffic.

## Warm request path

1. Cloudflare terminates TLS and forwards to Cloud Run.
2. Express serves the SPA or `/api`.
3. Auth.js session resolves membership → organization.
4. Service entitlement and exact permission gates run.
5. Prisma opens a transaction, sets `app.current_tenant` with SET LOCAL, and
   reads/writes under forced RLS as `app_user`.
6. Cross-service handoffs commit domain rows and an `IntegrationOutboxEvent` in
   the same transaction. The outbox worker drains **once after emit** (and once
   on process start). It does **not** poll every 2 seconds in production.

## Idle, sleep, and cold start

| Phase | Behaviour | Bill |
| --- | --- | --- |
| Serving | Cloud Run CPU on; Neon CU awake | both |
| After last request | Instance scales to 0; Prisma connections close | Cloud Run stops |
| ~5 minutes later | Neon compute suspends | storage only (~$0.35/GB-month) |
| Next request | Container start + Neon resume | cold path ~2–8 s, then warm |

No Cloud Scheduler keep-alive. Warm NFR: API p95 &lt; 300 ms. The first request
after overnight sleep may take 2–8 seconds; the UI should show a loading state.
Turn scale-to-zero off only after a paying 3-shift plant measures morning delay
as a real problem.

Prisma production URLs must include `connect_timeout=30` so the first request
after suspend does not fail while Neon wakes. Do **not** use the Neon serverless
WebSocket driver; this is a Node Cloud Run process that is allowed to exit when
idle.

## Connection contract

| Secret | Role | Host shape |
| --- | --- | --- |
| `mesadesk-database-url` | `app_user` runtime | `…-pooler.…aws.neon.tech` + `sslmode=require&pgbouncer=true&connect_timeout=30&connection_limit=5&pool_timeout=20` |
| `mesadesk-direct-database-url` | owner / migrate | unpooled `….aws.neon.tech` + `sslmode=require&connect_timeout=30` |

Runtime never mounts the owner URL. The one-shot Cloud Run migrate job mounts
only the direct URL (as both `DIRECT_DATABASE_URL` and `DATABASE_URL` for Prisma
CLI).

## Cost stages (list prices, USD/month)

Neon Launch compute **$0.106/CU-hour**; Scale **$0.222/CU-hour**; storage
**$0.35/GB-month**. Cloud Build **E2_HIGHCPU_8** is **$0.0156/min** (no free
tier once a custom machine type is set).

### Stage 0 — pilot (1 plant)

**Target ~$25–45/month**

- Neon 0.5 CU awake ~8–16 h/day: ~$11–22
- Cloud Run min 0: ~$5–15
- Cloud Build 4–10 full releases: ~$4–12
- Registry / secrets / egress: ~$3–8
- Staging Neon branch: ~$1–5

### Stage 1 — 5–10 plants

**Target ~$60–140/month** — still scale-to-zero; overlapping shifts keep Neon
awake more of the day. Autoscale max ~4 CU. Cloud Run max ~8.

### Stage 2 — 25–50 plants / live books

**Target ~$250–500/month** — move to Neon **Scale** only for SOC 2 / SLA /
30-day restore, not to disable suspend. Keep min 0 on Cloud Run.

### Stage 3 — 100+ / enterprise

Raise awake autoscale. India-residency customers get a **silo** database
(Cloud SQL `asia-south1` or a future Neon Mumbai project). Still no Kubernetes.

## Cloud Build

One production release is roughly **25–45 minutes** wall clock (quality gate +
images + Neon snapshot gate + migrate + candidate smoke + promote). At
$0.0156/min that is about **$0.40–$0.70 per release**.

| Cadence | Cloud Build $/month |
| --- | --- |
| 8 releases (pilot) | ~$4 |
| 20 releases | ~$11 |
| Full promote on every PR | $40+ (avoid) |

PR / CI should run the quality gate only. The promote path (migrate + traffic)
runs on the release branch. Disposable Postgres in Cloud Build remains the CI
database; Neon is not used for the quality gate.

## Release pipeline shape

1. Quality gate (disposable Postgres, two-tenant RLS fixture, tests, OpenAPI, build)
2. Build and push app + migration images
3. Neon safety gate (history window ≥ 7 days, protected project/branch, pre-migrate snapshot)
4. One-shot migrate job with owner URL
5. Candidate Cloud Run revision with no traffic (`min-instances=0`)
6. Smoke `/api/ready`, OpenAPI, security headers
7. Send 100% traffic; roll back on stable-URL failure

Never seed production. Pin Secret Manager **numeric** versions, never `latest`.

## Risks accepted

- Neon cannot store data in India today; default pool is Singapore.
- First request after idle is 2–8 s, not &lt; 300 ms.
- Launch has no uptime SLA; Scale is deferred until compliance requires it.
