# Marketing site deploy (Vercel interim)

Public homepage for **mesaorigins.com** is the separate
[mesa-website](https://github.com/Ashish51997/mesa-website) project, deployed on
**Vercel**. The MesaOrigins app (login + products + API) stays on **Cloud Run**.
Cloudflare path-routes the two origins — see
[cloudflare-path-routing.md](./cloudflare-path-routing.md).

## Vercel project

1. Import the `mesa-website` GitHub repo into Vercel.
2. Framework preset: Vite (or leave auto-detect).
3. Build command: `npm run build`
4. Output directory: `dist`
5. Existing `vercel.json` rewrites all paths to `index.html` for the hash SPA.

### Custom domains

In the Vercel project → **Settings → Domains**:

1. Add `mesaorigins.com`
2. Add `www.mesaorigins.com` (optional redirect to apex)
3. Follow Vercel’s DNS instructions **only if Cloudflare is not already
   proxying the zone**. When Cloudflare proxies the apex, point the orange-cloud
   records at the Worker / Origin Rules setup instead of letting Vercel own DNS.
   Vercel still needs the domain attached so its edge certificate and project
   hostname resolve correctly behind the Worker.

Typical Cloudflare setup:

- Worker / Origin Rules decide Vercel vs Cloud Run
- `MARKETING_ORIGIN` Worker var = Vercel deployment hostname
  (`https://<project>.vercel.app` or the Vercel-assigned domain)

## Login button

The marketing header **Login** CTA links to `/login` on the same public origin.
For local marketing-only development (`npm run dev` on `:5173`), copy
`.env.example`:

```bash
VITE_LOGIN_URL=http://localhost:4000/login
```

In production the button uses `/login` (no env override). Cloudflare must route
`/login` to Cloud Run — see [cloudflare-path-routing.md](./cloudflare-path-routing.md)
and deploy with `./scripts/deploy-path-router.sh`.

## Local development

| Service | URL |
| --- | --- |
| Marketing (`mesa-website`) | `http://localhost:5173` |
| App (`mesaorigins`) | `http://localhost:4000/login` |

Run both repos separately. Cloudflare is not required locally.

## Release checklist

- [ ] Vercel production deploy is green
- [ ] Domains attached (`mesaorigins.com`, optional `www`)
- [ ] Header shows **Login**
- [ ] Cloudflare routes `/` → Vercel and `/login` → Cloud Run
- [ ] Marketing copy change does **not** require a Cloud Run redeploy

## Future (Growth)

When ready to leave Vercel: publish the marketing build to GCS + Cloud CDN and
replace Worker routing with a GCP HTTPS Load Balancer URL map. Public URLs
(`/`, `/login`) stay the same.
