# Cloudflare path routing (marketing + app)

Interim architecture: **mesa-website on Vercel** serves the public homepage;
**MesaOrigins on Cloud Run** serves login, products, and API. Cloudflare sits in
front of both and routes by path on `mesaorigins.com`.

```text
Browser → Cloudflare (DNS/TLS)
            ├─ /login, /admin, /api, /auth, /mesaops, …
            │     → Cloud Run (mesadesk)
            └─ everything else (/ , /assets, …)
                  → Vercel (mesa-website)
```

Same public origin keeps session cookies and Google OAuth simple:

```bash
APP_URL="https://mesaorigins.com"
AUTH_URL="https://mesaorigins.com"
# OAuth redirect URI: https://mesaorigins.com/auth/callback/google
```

## Path rules

| Path prefix | Origin |
| --- | --- |
| `/login`, `/login/*` | Cloud Run |
| `/admin`, `/admin/*` | Cloud Run |
| `/api/*` | Cloud Run |
| `/auth/*` | Cloud Run |
| `/mesaops/*`, `/mesaleads/*`, `/mesaerp/*` | Cloud Run |
| `/supplier-portal/*`, `/command/*` | Cloud Run |
| `/app-assets/*` | Cloud Run |
| `/sw.js` | Cloud Run |
| **Default** (`/`, `/assets/*`, …) | **Vercel** |

Marketing uses hash routes (`#/about`), so Vercel only needs to serve
`index.html` at `/`. App Vite assets use `/app-assets` so they do not collide
with marketing `/assets` on Vercel.

## Option A — Cloudflare Worker (recommended)

Worker source lives in-repo at [`workers/path-router`](../../workers/path-router).
Configured vars:

| Var | Current value | Role |
| --- | --- | --- |
| `APP_ORIGIN` | `https://mesadesk-4sdtmcjrcq-as.a.run.app` | Cloud Run (`mesadesk`) |
| `MARKETING_ORIGIN` | `https://mesa-website-eight.vercel.app` | Vercel marketing site (project alias) |

### Deploy

```bash
# Node 20+ required (wrangler 4)
export CLOUDFLARE_API_TOKEN='…'   # Account: Workers Edit + Zone: Workers Routes

APP_ORIGIN=https://mesadesk-4sdtmcjrcq-as.a.run.app \
MARKETING_ORIGIN=https://mesa-website-eight.vercel.app \
./scripts/deploy-path-router.sh
```

The script runs `wrangler deploy` with those vars and attaches routes:

- `mesaorigins.com/*`
- `www.mesaorigins.com/*`

### Worker behaviour

```javascript
// See workers/path-router/src/index.ts — summary:
const APP_PREFIXES = [
  '/login',
  '/admin',
  '/api',
  '/auth',
  '/mesaops',
  '/mesaleads',
  '/mesaerp',
  '/supplier-portal',
  '/command',
  '/app-assets',
  '/sw.js',
  '/manifest.webmanifest',
  '/icons',
];

function isAppPath(pathname) {
  return APP_PREFIXES.some((prefix) => (
    pathname === prefix
    || pathname.startsWith(`${prefix}/`)
  ));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = isAppPath(url.pathname)
      ? env.APP_ORIGIN
      : env.MARKETING_ORIGIN;

    const target = new URL(url.pathname + url.search, origin + '/');
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');

    return fetch(new Request(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    }));
  },
};
```

4. Cloudflare SSL/TLS mode: **Full (strict)** for both origins.
5. DNS: **orange-cloud (Proxied)** for `mesaorigins.com` and `www`. Worker
   routes only run on proxied hostnames.

### DNS must go through Cloudflare (critical)

If `/api/health` still returns Vercel HTML and responses have **no** `cf-ray` /
`x-mesa-router` header, traffic is hitting Vercel **directly** and the Worker
never runs.

In Cloudflare → **DNS**:

1. Apex `mesaorigins.com` and `www` must show **Proxied** (orange cloud), not
   DNS-only (grey cloud).
2. Do **not** leave grey-cloud A/AAAA records that point straight at Vercel IPs
   while also expecting Worker routes to apply.
3. Recommended Worker-as-proxy setup:
   - `mesaorigins.com` A → `192.0.2.1` (placeholder), **Proxied**
   - `www` CNAME → `mesaorigins.com`, **Proxied**
   - Worker route `mesaorigins.com/*` fetches Vercel / Cloud Run upstreams
4. After changing DNS, wait for propagation, then confirm:

```bash
curl -sSI https://mesaorigins.com/api/health | grep -iE 'cf-ray|x-mesa|server|content-type'
# expect: cf-ray present, x-mesa-router: app, content-type: application/json
```

## Option B — Origin Rules

If your Cloudflare plan has enough Origin Rules, map each app prefix to the
Cloud Run origin and leave the default origin as Vercel. Worker routing is more
flexible when prefixes grow.

## Smoke checks

- [ ] `https://mesaorigins.com/` loads marketing (Vercel)
- [ ] Header **Login** opens `https://mesaorigins.com/login` (Cloud Run, themed)
- [ ] `https://mesaorigins.com/api/health` returns JSON from Cloud Run
- [ ] `/app-assets/*.js` loads from Cloud Run (not a Vercel 404)
- [ ] `/assets/*.js` loads from Vercel
- [ ] Google OAuth callback reaches `/auth/callback/google` on Cloud Run

## Related

- [marketing-deploy.md](./marketing-deploy.md) — Vercel project and domain setup
- [deploy-gcp.md](./deploy-gcp.md) — Cloud Run app releases
- [google-workspace-email.md](./google-workspace-email.md) — `APP_URL` / OAuth notes
