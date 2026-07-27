---
name: static-data-migration
description: Audits and migrates static demo data in the Mass Polimer ERP onto Postgres. Covers src/mockData.ts, the legacy data.json blob served by /api/data, and localStorage stores (userStore, accessStore). Use when adding a Prisma model for data that is currently hardcoded, when retiring a data.json key or App.tsx lifted state, when a screen still reads initial* arrays instead of a TanStack Query hook, or when the user mentions mock data, seed data, static data, unlinked data, or the legacy blob.
---

# Static Data Migration (Mass Polimer ERP)

This codebase has **three overlapping data planes**. Most operational domains are on Postgres, but static demo data and legacy sync code are still loaded in parallel. This skill covers auditing that state and moving a dataset from static → Postgres cleanly.

| Plane | Lives in | Status |
|---|---|---|
| Postgres (authoritative) | `server/prisma/schema.prisma` + `server/src/modules/*` + `src/lib/queries/*` | Target for all operational data |
| Legacy blob | `data.json` + `server/src/legacy/dataJson.ts` (`/api/data`) + lifted state in `src/App.tsx` | Being retired — write-noise for migrated domains |
| Client static / localStorage | `src/mockData.ts`, `src/lib/userStore.ts`, `src/lib/accessStore.ts` | Demo seed + browser-local state |

`STATIC_AND_UNLINKED_DATA.md` at the repo root is the standing inventory report. Read it before starting and update it when you change any plane.

## Step 0 — Always audit first

```bash
node .cursor/skills/static-data-migration/scripts/audit-static-data.mjs
```

Prints `data.json` key row counts, every `src/mockData.ts` export with its importers, Prisma models, and flags exports with no model or no importer. Never assume a dataset's status from the report doc alone — the doc can lag the code.

## Workflow A — Migrate a static dataset to Postgres

Copy this checklist and track progress:

```
- [ ] 1. Audit: who reads it, is there a Prisma model, is it in the blob
- [ ] 2. Add the Prisma model + migration
- [ ] 3. Seed it in server/prisma/seed.ts
- [ ] 4. Add the server module (schemas / service / router)
- [ ] 5. Add the TanStack Query hook
- [ ] 6. Switch the screen off the static import
- [ ] 7. Remove the static source and blob key
- [ ] 8. Tests + docs
```

**1. Audit.** Run the script. Identify every importer of the `initial*` export, whether the data also flows through `data.json`, and whether `src/App.tsx` holds lifted state for it.

**2. Prisma model.** Add to `server/prisma/schema.prisma`. Every tenant table needs `organizationId`, a relation to `Organization`, and RLS. Then:

```bash
npm run db:migrate   # prisma migrate dev — name it after the domain
```

**3. Seed.** Extend `server/prisma/seed.ts`: add the table to `ALL_TABLES`, import the `initial*` array, and insert inside the RLS-armed transaction with `withOrg(...)`. FK-filter with the existing `keep()` / `uniqueBy()` helpers rather than letting the insert throw. If the rows reference a machine, resolve the `M01`-style code through `machineIdByCode` — `Machine.code` is the human ID, `Machine.id` is the FK.

**4. Server module.** Create `server/src/modules/<domain>/` with `schemas.ts` (Zod), `service.ts` (Prisma + `audit`), `router.ts` (`requirePermission` + `validateBody`), and register the router on the authenticated `api` router in `server/src/app.ts`. Services read the tenant from `tenantContext`, never from the request body.

**5. Query hook.** Add `src/lib/queries/<domain>.ts` with a local `keys` object, `use{Entity}()` queries and `use{Action}{Entity}()` mutations that invalidate on success.

**6. Switch the screen.** Replace the `initialX` import with the hook. Handle loading/error states — static arrays were always synchronously available and the screen probably assumes that.

**7. Remove the static source.** Delete the export from `src/mockData.ts` once nothing imports it, drop the key from `server/src/legacy/dataJson.ts` `getInitialData()`, remove the lifted state and its sync entry in `src/App.tsx` (both the `POST /api/data` path and the `firebaseSync` path), and delete the key from `data.json`.

**8. Verify.** `npm run lint && npm run lint:server`, then `npm run test:unit` and `npm run test:server`. Add a module test at `server/src/modules/<domain>/<domain>.test.ts`.

See [reference.md](reference.md) for the exact code pattern at each layer.

## Workflow B — Retire a legacy blob key

Use when a domain is already on Postgres but `data.json` / `App.tsx` still carry it.

1. Confirm no screen reads the App state for that key — migrated screens are passed `[]` stubs, which is the tell.
2. Remove the `useState` + its entry from the `GET /api/data` hydration and the debounced save in `src/App.tsx`.
3. Remove the key from `getInitialData()` in `server/src/legacy/dataJson.ts` and from the Firestore collection list in `src/lib/firebaseSync.ts`.
4. Delete the key from `data.json`.
5. When the last key is gone, delete `data.json`, `server/src/legacy/dataJson.ts`, and its `app.use('/api/data', ...)` mount.

## Workflow C — Fix an unlinked relationship

Seed data has known dangling references (see `STATIC_AND_UNLINKED_DATA.md` §4). When fixing one, correct it **in `src/mockData.ts` or the seed constant**, not in `data.json` — the blob is downstream and being retired. Re-run `npm run db:reset && npm run db:seed` and confirm no `[seed] … skipped` / `dropped` warnings appear for the rows you fixed.

## Rules

- **Tenant scoping is not optional.** Every new table gets `organizationId` and RLS; every service resolves the org via `tenantContext`, and writes go through `tenantTx()` so the `app.current_tenant` GUC is set.
- **Audit every mutation.** Service writes call `audit(tx, { action, entity, entityId, before, after })` inside the transaction.
- **Never widen the blob.** Do not add keys to `data.json` or new lifted state to `App.tsx`. New data goes straight to Postgres.
- **`localStorage` stores are not truth.** `mp_employees`, `mp_permissions`, `mp_grants`, `mp_delegations` duplicate Postgres `Membership` / `Role` / `EmployeeGrant`. Migrating them means reading the admin API, not re-seeding the store.
- **Two ID spaces for machines.** UI and seed data use codes `M01`…`M09`; Postgres FKs use `Machine.id`. The legacy `Extruder-0x` IDs in `dataJson.ts` match nothing — treat them as broken.
- **Seed with the direct URL.** Seeding and migrations use `DIRECT_DATABASE_URL` (owner role, bypasses RLS); the running server uses `DATABASE_URL` (`app_user`, RLS enforced).
- **Update the report.** Any change to a data plane means updating the affected table in `STATIC_AND_UNLINKED_DATA.md`.

## Commands

| Task | Command |
|---|---|
| Start Postgres | `docker compose up -d` |
| Create migration | `npm run db:migrate` |
| Reset + reseed | `npm run db:reset && npm run db:seed` |
| Inspect data | `npm run db:studio` |
| Typecheck | `npm run lint` / `npm run lint:server` |
| Client tests | `npm run test:unit` |
| Server tests | `npm run test:server` |
