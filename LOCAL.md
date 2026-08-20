# Local development (team standard)

Every developer runs **the same stack on their own machine**:

- Docker Postgres 16 on `localhost:5432`
- Node app via `npm run dev` on `http://localhost:3000`
- Demo seed data (optional after first migrate)

Do **not** point day-to-day development at a shared Neon/Cloud SQL database. Shared DBs get wiped when anyone re-seeds and fight over migrations.

For a production-like full Compose stack (app image + migrate + Postgres), see [DOCKER.md](./DOCKER.md).

## Prerequisites

- Node 22+
- Docker Desktop running
- Git clone of this repo

## One-time setup (every machine)

```bash
# 1) Env file — local Postgres URLs are already the defaults
cp .env.example .env

# 2) Fill required secrets (do not commit .env)
#    AUTH_SECRET: openssl rand -hex 32
#    Each MesaERP/Ops key: openssl rand -base64 32
#      MESAORIGINS_VENDOR_BANK_ENCRYPTION_KEY
#      MESAORIGINS_ERP_OPS_HANDOFF_HMAC_KEY
#      MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY
#      MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY

# 3) Install + Prisma client
npm ci
npx prisma generate

# 4) Start local Postgres only (roles created on first boot)
npm run db:up

# 5) Migrations + demo seed
npm run release:migrate
SEED_USER_PASSWORD=mesaorigins123 npm run db:seed
```

Confirm `.env` keeps:

```bash
DATABASE_URL="postgresql://app_user:app_user@localhost:5432/masspolimer?schema=public"
DIRECT_DATABASE_URL="postgresql://masspolimer:masspolimer@localhost:5432/masspolimer?schema=public"
DEV_AUTH="1"
NODE_ENV="development"
```

## Daily use

```bash
npm run db:up    # if Postgres is not already running
npm run dev
```

Open http://localhost:3000.

Organization login (after seed):

- Email: `deepak.bansal@masspolymer.in`
- Password: `mesaorigins123` (or whatever you set in `SEED_USER_PASSWORD`)

## Smoke checks

```bash
curl --fail http://localhost:3000/api/health
curl --fail -H 'x-dev-user: EMP-002' http://localhost:3000/api/me
```

## Schema changes

```bash
npm run release:migrate
```

Re-seed only when you intend to wipe **your** local demo data:

```bash
SEED_USER_PASSWORD=mesaorigins123 npm run db:seed
```

## Rules

- Do **not** commit `.env` or `.neon-urls.env`
- Do **not** use `DEV_AUTH=1` on a public URL
- Prefer this local Postgres path for every laptop; keep Neon/Cloud for explicit shared staging or production release only
- Blank UI in dev after a CSP change: development must allow Vite’s inline React Refresh preamble (`script-src` includes `'unsafe-inline'` only when `NODE_ENV !== 'production'`)
