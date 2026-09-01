# Navigation information architecture

## After login

| Role | Lands on |
| --- | --- |
| Managing Director | **Command** |
| All other customer roles | **Role home** in primary workspace |
| Supplier | **Connect** (separate session) |
| MesaWorks operator | **Platform Control** (internal) |

No product picker for shop-floor roles.

## Grouped left sidebar

Show only entitled products the user may access.

| Group | Items |
| --- | --- |
| **Executive** | Command (MD only) |
| **Operations** | MesaPlant |
| **Commercial** | MesaSell, MesaBook |
| **Network** | Connect (supplier entry is separate login) |
| **Intelligence** | MesaAnalytics (Coming soon when not entitled) |
| **Administration** | Organization Control |

Platform Control is never in the customer sidebar.

## Global header

- Organization name
- Plant switcher (MesaPlant scope)
- Company / legal entity switcher (MesaBook scope)
- Multi-plant orgs use the plant switcher; MesaBook company switcher is independent
