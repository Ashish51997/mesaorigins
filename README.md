# MesaOrigins

Manufacturing operations platform — **One Platform. Every Operation.**

MesaOrigins is a modular monolith (React + Express + PostgreSQL) with three product services:

| Service | Focus |
| --- | --- |
| **MesaLeads** | Leads, technical review, quotations |
| **MesaERP** | Procurement, sales, inventory, finance, tax |
| **MesaOps** | Planning, execution, QA, maintenance, dispatch |

## Quick start

```bash
cp .env.example .env   # fill AUTH_SECRET + MesaERP/Ops keys
npm ci
npx prisma generate
npm run setup:local    # Docker Postgres + migrate + seed
npm run dev            # http://localhost:3000
```

Full local and Docker instructions: [docs/ops/local.md](docs/ops/local.md).

## Repository layout

```text
src/
  main.tsx          Product path router
  platform/         Landing + /admin portal
  shared/           Shared UI + API client
  mesaops/          MesaOps SPA
  mesaerp/          MesaERP SPA
  mesaleads/        MesaLeads SPA
server/src/
  platform/         Auth + org onboarding API
  mesaops/          MesaOps domain APIs
  mesaerp/          MesaERP APIs
  mesaleads/        MesaLeads APIs
  auth/ middleware/ lib/ openapi/
public/             PWA assets and icons
scripts/            GCP provision/migrate and QA gates
docs/               Architecture, ops runbooks, specs, ADRs
```

## Documentation

| Doc | Purpose |
| --- | --- |
| [docs/ops/local.md](docs/ops/local.md) | Day-to-day developer setup |
| [docs/ops/docker.md](docs/ops/docker.md) | Full Compose stack |
| [docs/ops/deploy-gcp.md](docs/ops/deploy-gcp.md) | GCP / Cloud Run + Neon deploy |
| [docs/architecture/production.md](docs/architecture/production.md) | Neon production topology and cost stages |
| [docs/architecture/architecture.md](docs/architecture/architecture.md) | Current platform architecture |
| [docs/architecture/api-services.md](docs/architecture/api-services.md) | HTTP prefixes per service |
| [docs/](docs/) | Specs, ADRs, OpenAPI, archive |

## Scripts (common)

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Vite (tsx watch) |
| `npm run build` / `npm start` | Production build and run |
| `npm run test:unit` / `test:server` | Vitest suites |
| `npm run docs:openapi` | Regenerate `docs/openapi.json` |
| `npm run setup:local` | Postgres up + migrate + seed |
