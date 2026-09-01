# Google Workspace email (mesaorigins.com)

## DNS switch (Cloudflare → Google Workspace)

Current production DNS uses **Cloudflare Email Routing** (`route*.mx.cloudflare.net`).
Google Workspace needs **Google MX** instead.

### Automated (recommended)

```bash
# Cloudflare → My Profile → API Tokens → Create Token
# Permissions: Zone → DNS → Edit (zone: mesaorigins.com)

export CLOUDFLARE_API_TOKEN='your-token-here'
chmod +x scripts/cloudflare-google-workspace-dns.sh
./scripts/cloudflare-google-workspace-dns.sh
```

The script:

- Removes Cloudflare Email Routing MX records
- Adds `smtp.google.com` (priority 1)
- Sets SPF: `v=spf1 include:_spf.google.com ~all`

### Manual (Cloudflare dashboard)

1. **Email** → **Email Routing** → **Disable** (stops Cloudflare from re-adding `route*.mx.cloudflare.net`).
2. **DNS** → delete MX records pointing to `route1/2/3.mx.cloudflare.net`
2. Add MX: Name `@`, Priority `1`, Target `smtp.google.com`, DNS only
3. Edit SPF TXT on `@` to: `v=spf1 include:_spf.google.com ~all`

## Create sales@mesaorigins.com

In [Google Admin](https://admin.google.com):

| Option | Best for |
| --- | --- |
| **Group** | Team inbox; multiple people receive `sales@` |
| **Alias** | One person; `sales@` → your main mailbox |
| **User** | Dedicated mailbox with its own login |

**Group (recommended):**

1. Directory → Groups → Create group
2. Email: `sales@mesaorigins.com`
3. Add members (your admin user, etc.)
4. Access type: Public (or restricted, as you prefer)

## DKIM (after Gmail is active)

1. Admin → Apps → Google Workspace → Gmail → **Authenticate email**
2. Generate DKIM for `mesaorigins.com`
3. Cloudflare DNS → add TXT:
   - Name: `google._domainkey`
   - Content: value from Google Admin
4. Click **Start authentication** in Admin after DNS propagates

## DMARC (optional, recommended)

TXT on `_dmarc`:

```
v=DMARC1; p=none; rua=mailto:security@mesaorigins.com
```

## MesaOrigins app hooks

Production `.env`:

```bash
APP_URL="https://mesaorigins.com"
AUTH_URL="https://mesaorigins.com"
ONBOARDING_ALLOWED_EMAILS="yourname@mesaorigins.com"
```

Google OAuth redirect URI:

```
https://mesaorigins.com/auth/callback/google
```

Public homepage marketing is on Vercel; `/login`, `/auth`, and product paths are on Cloud Run. Cloudflare must route `/auth/*` to Cloud Run so this callback works — see [cloudflare-path-routing.md](./cloudflare-path-routing.md).

Public contact email in MesaLeads profile: `sales@mesaorigins.com` (see `provisionMesaWorks.ts`).

## Verify DNS

```bash
dig +short MX mesaorigins.com @1.1.1.1
# expect: 1 smtp.google.com.

dig +short TXT mesaorigins.com @1.1.1.1
# expect SPF include:_spf.google.com
```

Google Admin Toolbox: https://toolbox.googleapps.com/apps/dig/
