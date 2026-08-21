# API services

MesaOrigins exposes one Express `/api` surface, partitioned by product service.
Source trees match the prefixes: `server/src/{platform,mesaops,mesaerp,mesaleads}`.

| Service | Canonical prefix | Entitlement | Server folder |
| --- | --- | --- | --- |
| Platform | `/api` (`/health`, `/me`, auth, onboarding) | none / platform admin | `server/src/platform`, `server/src/auth` |
| MesaOps | `/api/mesaops/v1/*` | `requireService('mesaops')` | `server/src/mesaops` |
| MesaERP | `/api/mesaerp/v1/*` | `requireService('mesaerp')` | `server/src/mesaerp` |
| MesaLeads | `/api/mesaleads/*`, `/api/public/mesaleads/*` | mesaleads entitlement | `server/src/mesaleads` |
| Supplier portal | `/api/supplier-portal/v1/*` | supplier session cookie | `server/src/mesaerp` (portal routers) |

## Mount order

Defined in [`server/src/app.ts`](../../server/src/app.ts):

1. Public health + auth + public MesaLeads + supplier portal
2. Authenticate + resolve tenant + `/me`
3. Platform onboarding
4. MesaLeads (authenticated)
5. `mountMesaErpRouters` → `/mesaerp/v1`
6. `mountMesaOpsRouters` → `/mesaops/v1` (+ optional legacy flat-path compat)

## MesaOps compatibility

While `MESAOPS_API_COMPAT` is enabled (default when `NODE_ENV !== 'production'`, or set to `1`), the same MesaOps handlers are also mounted at the historical flat paths (`/api/customers`, `/api/plans`, …). Prefer `/api/mesaops/v1/*`. Set `MESAOPS_API_COMPAT=0` to disable. OpenAPI documents **only** the canonical `/mesaops/v1` paths.

## Client

MesaOps TanStack hooks use `mesaOpsPath()` from [`src/mesaops/lib/apiBase.ts`](../../src/mesaops/lib/apiBase.ts) so every call is prefixed with `/mesaops/v1` after the shared `/api` base in [`src/shared/lib/apiClient.ts`](../../src/shared/lib/apiClient.ts).

## Contract

`npm run docs:openapi` regenerates [`docs/openapi.json`](../openapi.json) from the live router stack. Operations are tagged by service (`MesaOps`, `MesaERP`, `MesaLeads`, `Platform`, `Supplier Portal`) plus their domain tag.
