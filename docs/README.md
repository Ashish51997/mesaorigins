# Documentation

| Folder | Contents |
| --- | --- |
| [product/](product/) | Product catalog, IA, capability registry, packaging ([product-catalog.md](product/product-catalog.md)) |
| [architecture/](architecture/) | Current MesaOrigins platform architecture ([api-services.md](architecture/api-services.md), [production.md](architecture/production.md)) |
| [ops/](ops/) | Local, Docker, GCP/Neon, and marketing/Cloudflare runbooks |
| [specs/](specs/) | Product specs and glossary (`context.md`); client discovery: [mesaops-client-requirements-questionnaire.md](specs/mesaops-client-requirements-questionnaire.md) |
| [adr/](adr/) | Architecture decision records |
| [archive/](archive/) | Historical Mass Polimer / early design docs |
| [marketing/](marketing/) | Pitch deck and related assets |
| [openapi.json](openapi.json) | Generated API contract (CI-gated) |
| [india-compliance-provider.md](india-compliance-provider.md) | MesaERP compliance provider notes |

Start here for development: [ops/local.md](ops/local.md).

Marketing homepage (Vercel) + app path routing: [ops/marketing-deploy.md](ops/marketing-deploy.md), [ops/cloudflare-path-routing.md](ops/cloudflare-path-routing.md).

## Naming

All docs use **kebab-case** filenames (`spec-logbook.md`, `deploy-gcp.md`). Prefer that
convention for any new markdown added under `docs/`.
