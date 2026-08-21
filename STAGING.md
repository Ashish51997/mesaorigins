# Free shared staging (Neon + local app)

Shared demo data on a Neon free database. The app runs on your laptop (`npm run dev`). No Cloud Run / Cloud Build for staging.

## Prerequisites

- Node 22+
- Neon free project with DB `masspolimer`, roles `app_user` (RLS) and `masspolimer` (owner)
- Connection strings in `.neon-urls.env` (gitignored) or pasted into `.env`

## One-time setup

```bash
# 1) Ensure .env has Neon DATABASE_URL + DIRECT_DATABASE_URL (see .env.example Neon section)
cp .env.example .env   # only if .env does not exist yet; then paste Neon URLs

# 2) Install + generate Prisma client
npm ci
npx prisma generate

# 3) Roles + migrations against Neon (owner URL)
npm run release:migrate

# 4) Load shared demo data (TRUNCATES the Neon DB — coordinate with the team)
SEED_USER_PASSWORD=mesaorigins123 npm run db:seed
```

## Daily use

```bash
npm run dev
```

Open http://localhost:3000. With `DEV_AUTH=1`, use the login picker / `x-dev-user` header.

Seeded password (unless you changed it): `mesaorigins123`.

## Smoke checks

```bash
curl --fail http://localhost:3000/api/health
curl --fail -H 'x-dev-user: EMP-002' http://localhost:3000/api/me
```

## Rules

- Do **not** commit `.env` or `.neon-urls.env`
- Do **not** re-seed casually — seed wipes shared data
- Do **not** point production Cloud Run at this Neon branch
- Do **not** set `DEV_AUTH=1` on a public URL

## Apply schema changes

```bash
npm run release:migrate
```

