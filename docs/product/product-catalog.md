# MesaOrigins product catalog

Audience: founder and sales. English only.

MesaOrigins is one manufacturing platform. Customers activate sellable modules under clear packages. Organization Control and Command ship with every paying package; Platform Control is MesaWorks-only.

## Sellable modules

| Module | Promise | Primary users |
| --- | --- | --- |
| **MesaPlant** | Plan machines and shifts, execute, QA, move operational stock, dispatch | Planner, operator, QA, store, dispatch, maintenance |
| **MesaBook** | Commercial documents, valued inventory, procurement, money, tax | Finance, procurement |
| **MesaSell** | Enquiry → quote → customer decision | Sales, MD |
| **MesaAnalytics** | Historical trends and cross-plant reporting (future add-on) | MD, finance, plant head |
| **Connect** | Vendor collaboration outside the company | Supplier users |

## Platform surfaces (not sold separately)

| Surface | Who | Purpose |
| --- | --- | --- |
| **Organization Control** | Customer administrator | People, roles, plants, companies, active/available products |
| **Platform Control** | MesaWorks super-admins only | Create orgs, entitlements, first admin |
| **Command** | Managing Director / owner | Live exceptions and drill-through (not Analytics) |

## Packages

| Package | Includes | Default for |
| --- | --- | --- |
| **Plant Start** | MesaPlant + Organization Control + Command | Paper/Excel shop floor (default pilot) |
| **Commercial Start** | MesaSell + MesaBook + Organization Control + Command | Quote-to-cash / finance-first |
| **Manufacturing Suite** | MesaSell + MesaBook + MesaPlant + Organization Control + Command | Full chain |
| **Connect** | Add-on; **requires MesaBook** | Vendor collaboration |
| **MesaAnalytics** | Future add-on | Trends and BI; not Command |

## Pricing dimensions (no list prices in this doc)

- **Per plant** for MesaPlant
- **Per company / legal entity** for MesaBook
- **Per seat** where role-based limits apply
- **Per add-on module** for Connect and MesaAnalytics
- **Per organization** for platform access

## Land → expand → platform

1. **Land** with Plant Start (or Commercial Start if finance is the pain).
2. **Expand** when MD asks for one commercial number, quotes, or valued inventory.
3. **Platform** when vendors need Connect or leadership needs MesaAnalytics.

See [product-lifecycle.md](product-lifecycle.md) and [expansion-playbook.md](expansion-playbook.md).

## Plant Start pilot checklist (sales + delivery)

Use this when positioning the default pilot package.

**Includes**

- MesaPlant (one plant, operational roles)
- Organization Control (people, roles, plant scope)
- Command (MD exceptions from live plant data)
- Seeded demo path: logbook → QA → dispatch

**Excludes (expansion triggers)**

- MesaSell and MesaBook (enable via Platform Control when the customer is ready)
- Connect (requires MesaBook)
- MesaAnalytics (future add-on)

**Demo credentials (local seed)**

- Plant Start org: `MesaOrigins (Demo Plant)` — MesaPlant only
- MD: `madan.lal@masspolymer.in` / `mesaorigins123` → lands on Command
- Operator: `nandlal@masspolymer.in` / `mesaorigins123` → lands on MesaPlant
- Platform Control: `/admin` (MesaWorks only)
