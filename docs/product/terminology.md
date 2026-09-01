# MesaOrigins terminology

Canonical language for sales and product docs. Do not use legacy product names (MesaLeads, MesaERP, MesaOps) in customer-facing materials.

## Platform and modules

| Term | Meaning |
| --- | --- |
| **MesaOrigins** | Platform brand: One Platform. Every Operation. |
| **MesaSell** | Win the order (enquiry → quote → decision) |
| **MesaBook** | Run the business books (commercial, valued inventory, money, tax) |
| **MesaPlant** | Run the plant floor (plan, execute, QA, operational stock, dispatch) |
| **MesaAnalytics** | Historical intelligence (future add-on) |
| **Command** | MD exception home — act today |
| **Organization Control** | Customer admin workspace |
| **Platform Control** | MesaWorks-only operator console |
| **Connect** | External vendor workspace (requires MesaBook) |

## Stock

| Term | Module | Meaning |
| --- | --- | --- |
| **Operational stock** | MesaPlant | Physical material on the floor / stores |
| **Valued inventory** | MesaBook | Legal / costing inventory ledger |

Never say “inventory” without the qualifier when both modules are present.

## Production

| Term | Module | Meaning |
| --- | --- | --- |
| **Machine execution / shift plan** | MesaPlant | Executable schedule on a machine, shift, operator |
| **Commercial production and costing** | MesaBook | Business production records, WIP, batch cost |

One executable machine schedule of record: MesaPlant only.

## Link states (handoffs)

| State | Meaning |
| --- | --- |
| **Linked** | Destination draft or record created from an immutable source snapshot |
| **Not linked** | Independent native record; no cross-module source |
| **Needs mapping** | Handoff waiting on item, UOM, warehouse, customer, or company mapping |
| **Stale** | Source changed after destination accepted the snapshot |
| **Conflict** | Destination diverged; needs human resolution |

## Roles (job families)

| Job family | Roles |
| --- | --- |
| Executive | Managing Director |
| Administration | Administrator |
| Revenue | Sales |
| Finance | Finance, Procurement |
| Operations | Planner, Operator, Quality Inspector, Store, Dispatch, Maintenance |
| Network | Supplier |
| Platform | MesaWorks operator |
