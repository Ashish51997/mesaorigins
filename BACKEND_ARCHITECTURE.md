# Mass Polimer ERP — Production Backend Architecture

Status: **approved · foundation implemented** (this commit). Vertical slice (users + customers → inquiry → quotation → order, server + frontend) is next.
Companion to `PRODUCTION_READINESS.md` (the audit this addresses).

> **Foundation shipped:** Dockerized Postgres (`docker-compose.yml`) + full Prisma schema (all entities, FK value chain, `version` optimistic-lock columns) + migration + seed-from-mockData + Express app (`server/`) with the middleware chain (requestLog → dev-stub auth → authz → Zod → error) and the ported permission map. Verified against a live Postgres: migration applied, seed inserted (dedup surfaced the mock data's duplicate sales orders), and the API answered `/api/health`, `/api/me` (identity resolved from `x-dev-user`), and JSON 404s. Client `tsc` + server `tsc` clean, 22/22 tests, build OK. The legacy `/api/data` blob still serves un-migrated domains (strangler).

## Decision log (from the grilling session)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Backend direction | **Node + PostgreSQL API** | Real referential integrity across the value chain; portable off Firebase; conventional and documentable. |
| 2 | Authentication | **Firebase Auth, verified server-side** — *implemented in a later phase* | Keeps one-click Google + email/password on the client; API verifies the Firebase ID token via the Admin SDK. Deferred now behind a dev-stub seam so the rest ships first. |
| 3 | API style | **REST + Zod** | Decoupled client/server, integration-friendly, natural migration from today's `fetch` layer; Zod gives runtime validation + shared types. |
| 4 | Scope this pass | **Foundation + one vertical slice** | Prove every layer end-to-end on one domain as a reference implementation; app stays runnable; remaining domains cloned from the template. |
| — | Frontend data layer | **TanStack Query** | Standard server-state cache/mutations; retires lift-everything-in-`App.tsx` + whole-blob auto-save. |
| — | Tenancy | **Multi-tenant SaaS** — retrofit ✅ done | Product sold to many manufacturers. Pooled shared-schema + `organizationId` + Postgres RLS (FORCE, non-superuser `app_user`) + app guard; silo tier for enterprise. `Organization`/`User`/`Membership` + per-tenant composite uniques; per-tenant provisioning seed. Cross-tenant isolation verified. See `SYSTEM_ARCHITECTURE.md` → Tenancy model. |

---

## 1. Target architecture

```
                          ┌──────────────────────────────────────┐
  Browser (React SPA)     │  Firebase Auth (client)  [Phase 2]    │
    │                     │   Google + email/password             │
    │  TanStack Query     │   → Firebase ID token (JWT)           │
    │  + typed apiClient   └──────────────────────────────────────┘
    │        │ Authorization: Bearer <token>
    ▼        ▼
┌───────────────────────────────────────────────────────────────┐
│  Express API  (server/)                                        │
│                                                                │
│  requestLog → auth → authz(permission) → zodValidate → handler │
│                │                                               │
│   auth.ts  ◀── Phase 1: dev-stub identity (x-dev-user header)  │
│            ◀── Phase 2: firebase-admin verifyIdToken()         │
│                                                                │
│   authz.ts ── role→permission from ported FEATURES/roles map   │
│   services ── business rules + Prisma transactions             │
│   errors   ── { error: { code, message, details } } envelope   │
└───────────────────────────────┬───────────────────────────────┘
                                 │ Prisma
                                 ▼
                        ┌────────────────────┐
                        │  PostgreSQL 16     │
                        │  (Docker Compose)  │
                        │  FK integrity +    │
                        │  row `version`     │
                        └────────────────────┘

RETIRED as domains migrate: data.json blob store + client-SDK Firestore writes.
```

## 2. Tech stack

- **Runtime:** Node + TypeScript (`tsx` dev, `tsc`/esbuild build) — matches the current setup.
- **Web:** Express 4 (already a dependency).
- **DB:** PostgreSQL 16, local via **Docker Compose**.
- **ORM:** Prisma (typed schema, migrations, seed).
- **Validation:** Zod (request bodies + shared inferred types).
- **Auth:** `firebase-admin` (Phase 2) behind an `auth` middleware seam; Phase 1 uses a dev-stub identity.
- **Authz:** in-house `requirePermission(featureKey)` middleware, role→permission map **ported from `src/lib/accessCatalog.ts` + `src/lib/roles.ts`** so client and server share one policy.
- **Frontend:** `@tanstack/react-query` + a small typed `apiClient` (fetch wrapper that attaches the auth token and unwraps the error envelope).
- **Config:** `dotenv` (already present) — `DATABASE_URL`, `PORT`, `FIREBASE_*` (Phase 2), `DEV_AUTH=1` toggle.

## 3. Repo layout

```
/server
  /prisma
    schema.prisma          # ALL entities + relations
    seed.ts                # seeds Postgres from src/mockData.ts + directory seed
    migrations/…
  /src
    index.ts               # boot: mount /api routers, serve the SPA (dev+prod), legacy /api/data during transition
    app.ts                 # express app + middleware chain
    db.ts                  # Prisma client singleton
    middleware/ auth.ts  authz.ts  validate.ts  error.ts  log.ts
    lib/ permissions.ts  ids.ts
    modules/
      users/    { router, service, schema }
      customers/{ router, service, schema }
      inquiries/{ router, service, schema }
      orders/   { router, service, schema }
      …(later domains)
docker-compose.yml         # postgres service
src/lib/apiClient.ts        # frontend fetch wrapper
src/lib/queries/*.ts        # TanStack Query hooks per resource
```

The existing `server.ts` is replaced by `server/src/index.ts`, which keeps the current responsibilities (Vite middleware in dev, static `dist` in prod) and adds the resource routers.

## 4. Data model & the value chain

All ~16 entities become tables. Foreign keys make the chain real and enforce integrity the audit found missing:

```
Customer 1─* Inquiry 1─1 SalesOrder 1─* ProductionPlan 1─1 MachineLogbook
                                                                 │ 1─*
                                                              RollRecord 1─1 QualityInspection
                                                                 │ (pass)
                                                              InventoryTxn (FG) 1─* DispatchRecord ─* SalesOrder(status)
Customer 1─* Complaint 1─1 CAPA
User *─1 Role     LogbookTemplate 1─* MachineLogbook     Recipe/BOM     MaintenanceTask
Permission / EmployeeGrant / Delegation  (authorization tables)
```

- **Optimistic locking:** every mutable row carries `version Int @default(0)`; updates do `WHERE id = ? AND version = ?` and bump it → concurrent edits get a `409 Conflict` instead of silently clobbering (fixes the blob-clobber blocker at the record level).
- **IDs:** database-generated (`cuid`/uuid), replacing the audit's `array.length` / `Date.now()+Math.random()` collision-prone client IDs.
- **Server-authoritative numbering:** `SO-`, `INQ-`, `C-` numbers minted by a Postgres sequence, not array length (fixes number reuse after cancel).

## 5. Auth & authz

**Identity (auth middleware) — the deferred seam.**
- **Phase 1 (this pass):** `DEV_AUTH=1` → `auth` reads an `x-dev-user` header (or defaults to a seeded admin) and loads that `User` from Postgres. Lets the whole API + slice run and be tested without Firebase wiring.
- **Phase 2 (later):** same middleware, real body: `firebase-admin.auth().verifyIdToken(bearer)` → find/create the `User` by Firebase UID/email → attach to `req.user`. No route or service changes — only the middleware body swaps.

**Authorization (authz middleware).** `requirePermission('screen:orders' | 'action:order.approve')` resolves the user's role → permission set from the **ported `FEATURES`/role catalog**, plus per-user grants/delegations from Postgres (with delegation **expiry actually enforced** — a bug the audit flagged). This makes server-side authz the source of truth; the client `can()` stays a cosmetic UX hint.

## 6. API conventions

- Base path `/api`. Resourceful: `GET/POST /api/customers`, `GET/PATCH/DELETE /api/customers/:id`, etc.
- Every write body validated by a Zod schema; 422 with field details on failure.
- Error envelope: `{ error: { code, message, details? } }` with correct HTTP status.
- Lifecycle transitions are explicit endpoints, transactional where they touch multiple tables (e.g. later: `POST /api/inspections/:id/pass` books an FG `InventoryTxn` + dispatchable pallet in one transaction).
- List endpoints support basic filter/paginate query params.

### API documentation (OpenAPI)

The contract is published as OpenAPI 3.1 — browsable at **`/api/docs`**, machine-readable at **`/api/openapi.json`**. Both are unauthenticated so an integrator can read the contract before holding a credential.

**The document is generated from the running server, not hand-written**, which is what stops it drifting from the code:

| Part of the spec | Where it comes from |
|---|---|
| Paths, methods, path params | Walking the mounted Express router stack (`openapi/routes.ts`) |
| Request body schemas | The Zod schema on each route, via `zod-to-json-schema` |
| Required permission (per operation) | The feature key tagged onto `requirePermission()` |
| `401` / `403` / `422` / `500` responses | Derived from which middleware the route actually carries |
| Response schemas | Generated from the Prisma datamodel (`openapi/models.ts`) |
| Summaries, descriptions, domain error codes | `openapi/metadata.ts` — the one hand-written file |

`validateBody()` and `requirePermission()` tag the handlers they return with a symbol the generator reads back; adding a route therefore puts it in the docs automatically.

Only the prose can go stale, so `openapi.test.ts` fails the build when a mounted route has no entry in `metadata.ts` (or when an entry describes a route that no longer exists), and checks that every `responseModel` names a real Prisma model and field.

```
npm run docs:openapi   # write docs/openapi.json for spec linting / client generation
```

Two spec-lint warnings are known and left alone: `/api/logbooks/plan/{planId}` is ambiguous with `/api/logbooks/{id}/submit` to a spec consumer (Express resolves it fine by literal-segment precedence), and `GET /api/health` plus the legacy `/api/data` pair have no 4xx response because none is reachable.

## 7. Frontend migration (strangler pattern)

Per-domain cutover, app runnable throughout:

- **Migrated domains** (this pass: customers, inquiries, orders, users) → served by the new REST API from Postgres; their screens use `src/lib/queries/*` TanStack Query hooks; their lifted state + their keys in the legacy `/api/data` blob are removed.
- **Un-migrated domains** → keep today's lifted-state + `/api/data` path **unchanged** until their phase. Both paths run in the same server during transition.
- `main.tsx` gains a `QueryClientProvider`; `apiClient` attaches the auth token (dev header now, Firebase token later).

## 8. What ships THIS pass

**Foundation**
- `docker-compose.yml` (Postgres 16) + `.env.example` additions.
- `server/prisma/schema.prisma` — **all** entities + relations + `version` columns.
- `server/prisma/seed.ts` — seeds Postgres from `src/mockData.ts` and the directory seed.
- Express app + middleware chain (`log`, `auth` dev-stub, `authz`, `validate`, `error`), Prisma singleton, boot that also serves the SPA.
- `server/src/lib/permissions.ts` — role→permission ported from the client catalog.

**Vertical slice — end-to-end (server + frontend)**
- Modules `users`, `customers`, `inquiries`, `orders`: routers + Zod + services implementing the real lifecycle **with the audit's Sales bugs fixed** (duplicate-order guard, server IDs/numbering, GST-uniqueness, required-field validation).
- Frontend: `apiClient`, query hooks, `QueryClientProvider`, and migration of the Sales role screens (Customers, Inquiries, Quotations, Orders) + the Users directory onto the API.
- **Tests:** API integration tests (supertest) for the slice; existing `vitest` suite stays green.

**Verification each step:** `tsc` clean · `vitest` green · `npm run build` OK · Postgres up via Compose · app runnable.

## 9. Explicitly deferred (named, not forgotten)

- **Firebase-admin token verification** (Phase 2) — ✅ wired. Set `DEV_AUTH=0` + `FIREBASE_SERVICE_ACCOUNT`; SPA sends `Authorization: Bearer <ID token>`. While `DEV_AUTH=1`, the login picker / `x-dev-user` stub still works; a Bearer token is preferred when present.
- **Remaining domains** end-to-end: planning, logbook, quality, inventory, store, dispatch, CAPA, reports, ACL admin — schema exists now; routers + frontend follow the slice's template.
- **Value-chain transaction endpoints** (QA→FG→dispatch, plan→logbook) — Phase 3, once those domains migrate.
- **Real-time push** — none initially; TanStack Query refetch-on-focus. Add SSE/WebSockets later if needed.
- **Cloud deployment** — local Docker Compose now; a documented deploy (managed Postgres like Neon + a Node host) is provided, but actually provisioning cloud accounts needs credentials I can't create autonomously.

## 10. Risks / call-outs

- Two persistence models coexist during the strangler window (Postgres for migrated domains, `data.json` for the rest) — intended and temporary.
- Replacing `server.ts` changes `npm run dev`/`build`/`start`; I'll keep the same commands working.
- The slice is substantial; I'll implement incrementally with commits at each green checkpoint so nothing is left half-broken.
