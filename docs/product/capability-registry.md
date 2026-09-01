# Capability registry

Single source of truth for sellable modules, surfaces, dependencies, and sidebar groups.

## Modules and surfaces

| Id | Label | Layer | Sidebar group | Requires | Primary buyer | Primary users | Cannot own |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `command` | Command | Executive (included) | Executive | Any entitled product | MD | Managing Director | Historical BI |
| `mesa-plant` | MesaPlant | Core product | Operations | — | Plant owner | Ops roles | Valued inventory, GL |
| `mesa-sell` | MesaSell | Core product | Commercial | — | Sales lead / MD | Sales | Machine schedule |
| `mesa-book` | MesaBook | Core product | Commercial | — | CFO / MD | Finance, procurement | Machine / shift assignment |
| `connect` | Connect | Extension | Network | `mesa-book` | Procurement lead | Suppliers | Employee / journal APIs |
| `mesa-analytics` | MesaAnalytics | Extension | Intelligence | Any core product | MD | MD, finance | Day-of exception acting |
| `organization-control` | Organization Control | Platform | Administration | — | Admin | Administrator | Cross-tenant ops |
| `platform-control` | Platform Control | Platform (internal) | — | MesaWorks | MesaWorks | Super-admins | Customer day-to-day |

## Packages → entitlements

| Package id | Entitled ids |
| --- | --- |
| `plant-start` | `mesa-plant`, `organization-control`, `command` |
| `commercial-start` | `mesa-sell`, `mesa-book`, `organization-control`, `command` |
| `manufacturing-suite` | `mesa-sell`, `mesa-book`, `mesa-plant`, `organization-control`, `command` |
| `connect` | `connect` (+ requires `mesa-book` already entitled) |
| `mesa-analytics` | `mesa-analytics` |

## Checklist: adding a new module

1. Choose **Mesa*** name for sellable modules, or Network/Connect pattern for external users.
2. Declare primary buyer, users, requires, optional handoffs, cannot own.
3. Assign sidebar **group** (do not append to a flat list).
4. Do not merge lifecycles with an existing module; use the five link states.
5. Add capability row here and mirror in `server/src/platform/productCatalog.ts` when shipping.
6. Add package or add-on row in [product-catalog.md](product-catalog.md).
7. Update ADR-0004 if naming pattern changes.

## Future slots (documented only)

| Slot | Example | Split when |
| --- | --- | --- |
| Intelligence | MesaAnalytics | Reporting exceeds Command cards |
| Network | Connect | External user collaboration |
| Compliance | MesaComply | Statutory workflows become enterprise SKU |
| Customer network | MesaCustomer | B2B order portal at scale |
