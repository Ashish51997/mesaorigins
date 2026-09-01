# Cloudflare Worker: mesaorigins.com path router

Deploys as Worker name **`mesaorigins`** (existing zone routes).

| Var | Value |
| --- | --- |
| `APP_ORIGIN` | `https://mesadesk-4sdtmcjrcq-as.a.run.app` |
| `MARKETING_ORIGIN` | `https://mesa-website.vercel.app` |

## Deploy

```bash
export CLOUDFLARE_API_TOKEN='…'  # Workers Edit (+ DNS Edit if fixing records)
export CLOUDFLARE_ACCOUNT_ID='9caeb2e7455eead5c95b34e7340fd974'

APP_ORIGIN=https://mesadesk-4sdtmcjrcq-as.a.run.app \
MARKETING_ORIGIN=https://mesa-website.vercel.app \
./scripts/deploy-path-router.sh
```

## DNS (required for routing)

Worker routes only run when DNS is **Proxied**. If responses have no `cf-ray`
or `x-mesa-router`, traffic is skipping Cloudflare (often grey-cloud → Vercel).

See [docs/ops/cloudflare-path-routing.md](../../docs/ops/cloudflare-path-routing.md).
