# Reference — layer-by-layer patterns

Concrete patterns copied from working code in this repo. `maintenance` is the smallest complete module; `sales` is the fullest.

---

## 1. Prisma model

`server/prisma/schema.prisma`. Tenant tables carry `organizationId`, a cascading `Organization` relation, an index on `organizationId`, and `version` when the domain uses optimistic locking.

```prisma
model MaintenanceTask {
  id             String   @id @default(cuid())
  organizationId String
  machineId      String
  taskName       String
  status         String   @default("scheduled")
  version        Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  machine      Machine      @relation(fields: [machineId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([machineId])
}
```

Human-facing codes that must stay unique per tenant use a compound unique, e.g. `Machine`:

```prisma
  code String // 'M01'..'M09'
  @@unique([organizationId, code])
```

## 2. Migration + RLS

```bash
npm run db:migrate   # prisma migrate dev
```

`prisma migrate dev` does **not** emit row-level security. Append it by hand to the generated `server/prisma/migrations/<ts>_<name>/migration.sql`, matching `20260726150924_add_formulation`:

```sql
ALTER TABLE "MyTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MyTable" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MyTable";
CREATE POLICY tenant_isolation ON "MyTable"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
```

`FORCE` applies the policy to the table owner too; when `app.current_tenant` is unset the predicate is NULL and nothing matches. No `GRANT` is needed — `server/prisma/setup-roles.sql` sets default privileges so `app_user` picks up new tables automatically.

## 3. Seed

`server/prisma/seed.ts`. Three edits: add the table name to `ALL_TABLES` (it is TRUNCATEd first), import the source array, insert inside the RLS-armed transaction.

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.current_tenant', ${O}, true)`;
  await tx.myTable.createMany({ data: withOrg(keptRows) });
}, { timeout: 30000 });
```

`withOrg` stamps `organizationId`. FK-filter and de-duplicate before inserting so bad demo rows warn instead of throwing:

```ts
const keptOrders = uniqueBy(
  keep(initialSalesOrders, (o) => keptInquiryIds.has(o.inquiryId), 'salesOrders(fk)'),
  (o) => o.soNumber, 'salesOrders(soNumber)',
);
```

Machine references resolve code → id, since `Machine.id` is a cuid and mock data uses `M01`-style codes:

```ts
const machineIdByCode = new Map(
  (await tx.machine.findMany({ select: { id: true, code: true } })).map((m) => [m.code, m.id]),
);
// ...
machineId: machineIdByCode.get(t.machineCode)!,
```

Insert order matters: `Machine` and `LogbookTemplate` before anything that references them.

## 4. Server module

Layout — `server/src/modules/<domain>/`: `schemas.ts`, `service.ts`, `router.ts`, `<domain>.test.ts`.

**schemas.ts** — Zod, with user-facing messages and coercion:

```ts
export const maintenanceCreateSchema = z.object({
  machineId: z.string().min(1, 'Machine is required'),
  type: z.enum(['Preventive', 'Calibration', 'Overhaul', 'Breakdown']).default('Preventive'),
  cost: z.coerce.number().min(0).default(0),
});
export type MaintenanceCreate = z.infer<typeof maintenanceCreateSchema>;
```

**service.ts** — org from `tenantContext`, writes through `tenantTx()`, audit inside the transaction, `ApiError` for expected failures:

```ts
function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}

export async function addMaintenance(input: MaintenanceCreate) {
  const machine = await prisma.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');
  return tenantTx(async (tx) => {
    const task = await tx.maintenanceTask.create({ data: { ...input, status: 'scheduled', organizationId: org() } });
    await audit(tx, { action: 'maintenance.create', entity: 'MaintenanceTask', entityId: task.id, after: task });
    return task;
  });
}
```

Reads use `prisma` directly (the guarded client in `server/src/db.ts` scopes them); writes use `tenantTx` so the tenant GUC is set for RLS.

**router.ts** — the local `ah` async wrapper, `requirePermission('screen:<id>')`, `validateBody`:

```ts
export const maintenanceRouter = express.Router();

maintenanceRouter.get('/maintenance', requirePermission('screen:preventive'), ah(() => svc.listMaintenance()));
maintenanceRouter.post('/maintenance', requirePermission('screen:preventive'), validateBody(maintenanceCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.addMaintenance(req.body); }));
```

Reference data readable by any signed-in member omits `requirePermission` (e.g. `GET /machines`).

**Registration** — `server/src/app.ts`, on the authenticated `api` router, after `authenticate` and `resolveTenant`:

```ts
api.use(maintenanceRouter);
```

Screen permission IDs come from `server/src/lib/permissions.ts` (mirrored client-side in `src/lib/accessCatalog.ts`); a new screen needs an entry in both.

## 5. Client query hook

`src/lib/queries/<domain>.ts` — local `keys` object, `api` from `src/lib/apiClient.ts`, mutations invalidate on success.

```ts
const keys = { stock: ['inventory', 'stock'] as const };

export function useStock() {
  return useQuery({ queryKey: keys.stock, queryFn: () => api.get<ApiStock>('/inventory/stock') });
}

export function useReceive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/inventory/receive', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.stock }),
  });
}
```

Cross-domain effects invalidate both keys — confirming an order invalidates `['orders']` and `['inquiries']`.

## 6. Screen wiring

Replace the static import with the hook and add states the static array never needed:

```tsx
// before
import { initialMachines } from '../../mockData';
const MACHINES = initialMachines.map((m) => m.id);

// after
const { data: machines = [], isLoading } = useMachines();
```

Current static importers to watch: `src/components/store/StoreScreens.tsx` and `src/components/maintenance/MaintenanceScreens.tsx` (machine ID list + `currentLot` lookup), `src/lib/simulation.ts`, and two tests that import `initialLogbookTemplates` / `initialMachineLogbooks`.

## 7. Legacy blob plumbing

`server/src/legacy/dataJson.ts` exports `legacyDataRouter`, mounted **unauthenticated** at `/api/data` before the authenticated router. `GET /` reads `data.json` (creating it from `getInitialData()` if missing); `POST /` merges the body onto a fresh read and writes back.

Blob keys do not match mockData export names:

| mockData export | `data.json` key |
|---|---|
| `initialLogbookTemplates` | `templates` |
| `initialQualityInspections` | `inspections` |
| `initialInventoryTransactions` | `inventory` |
| `initialDispatchRecords` | `dispatches` |
| `initialCustomerComplaints` | `complaints` |
| `initialCapaRecords` | `capas` |

`src/App.tsx` hydrates 12 arrays from `GET /api/data` (or `fetchFromFirestore()` on the Google SSO path) and debounce-saves changed keys after 1s. The blob's `recipes`, `maintenanceTasks`, `permissions`, `aclRequests` are never read by `App.tsx`.

Known-dead entries: `packingRecords` (no Prisma model, never rendered), `recipes` (superseded by `Formulation`), `maintenanceTasks` (uses `Extruder-0x` IDs that match no machine), `permissions` / `aclRequests` (always empty).

## 8. Tests

| Scope | Location | Command |
|---|---|---|
| Client | `src/components/__tests__/*.test.tsx` (jsdom, `vitest.config.ts`) | `npm run test:unit` |
| Server | `server/src/modules/<domain>/<domain>.test.ts` (node, `vitest.server.config.ts`, serial) | `npm run test:server` |

Server tests share one Postgres instance and run with `fileParallelism: false` — they need the DB up (`docker compose up -d`) and seeded.
