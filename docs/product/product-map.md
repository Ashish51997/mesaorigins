# Product ownership map

One owner per journey step. Cross-module writes only via optional handoffs with explicit link states.

## Value chain ownership

| Step | Owner | Notes |
| --- | --- | --- |
| Enquiry / lead | MesaSell | Native create without MesaBook |
| Quotation / win-loss | MesaSell | Optional handoff to MesaBook commercial order |
| Sales order / invoice / AR | MesaBook | Legal commercial books |
| Purchase order / AP / vendors | MesaBook | Connect attaches here |
| Valued inventory / costing | MesaBook | Not operational stock |
| Operational demand | MesaPlant | Local demand allowed without MesaBook |
| Machine / shift / operator plan | MesaPlant | Never owned by MesaBook |
| Logbook / execution | MesaPlant | Shop-floor source of truth |
| QA pass / hold / reject | MesaPlant | Holds can block dispatch |
| Operational stock issue / put-away | MesaPlant | Physical movement |
| Gate pass / physical dispatch | MesaPlant | |
| Commercial production evidence | MesaBook | Issue / completion vouchers when Plant absent or via handoff |
| Exceptions today | Command | Reads from entitled modules |
| Trends over time | MesaAnalytics | Future; not Command |

## Independence rules

- MesaPlant can run without MesaBook (local demand, execution, operational stock).
- MesaBook can run without MesaPlant (commercial production vouchers without machine schedule).
- MesaSell can run without MesaPlant.
- Connect requires MesaBook.
- Disabling a module does not delete accepted records in another module.

## Status display rule

When records are linked, UI must show:

1. Source lifecycle status
2. Destination lifecycle status
3. Link state: **Linked**, **Not linked**, **Needs mapping**, **Stale**, or **Conflict**

Never merge into a single ambiguous “status.”

## Stock and production language

| Concept | MesaPlant | MesaBook |
| --- | --- | --- |
| Stock | Operational stock | Valued inventory |
| Production | Machine execution / shift plan | Commercial production and costing |
