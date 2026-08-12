# Mesadesk Docker setup

The default Compose stack runs a production-like Mesadesk image with PostgreSQL
16. Prisma migrations run as a one-shot dependency before the app starts. Both
Postgres and the remaining legacy JSON store use named volumes.

## First local start

Docker Desktop must be running.

```bash
docker compose up -d --build
docker compose --profile tools run --rm seed
docker compose restart app
docker compose ps
```

Open <http://localhost:3000>. The seed is intentionally separate because it
truncates and recreates the demo database. Do not rerun it against data you want
to keep.

The base stack uses development-only database credentials but defaults to
`DEV_AUTH=0`, so an exposed production-like container never accepts
`x-dev-user` impersonation by default. Copy `.env.example` to `.env` when you
need to override ports or optional services:

```bash
cp .env.example .env
```

Common overrides are `MESADESK_APP_PORT`, `MESADESK_POSTGRES_PORT`,
`MESADESK_POSTGRES_USER`, `MESADESK_POSTGRES_PASSWORD`,
`MESADESK_POSTGRES_DB`, and `MESADESK_SEED_PASSWORD`. For an isolated local
demo of the production image, opt into the development identity picker with
`MESADESK_DEV_AUTH=1`; never use that override on a shared or public host.

## Hot-reload development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The repository is bind-mounted into the app container while dependencies remain
in the `mesadesk-node-modules` volume. The API and Vite middleware are served on
the same `MESADESK_APP_PORT` as the default stack. This override explicitly sets
`DEV_AUTH=1` for the local hot-reload workflow; the base Compose file remains
fail-closed.

## Operations

```bash
# Follow application logs
docker compose logs -f app

# Apply pending migrations without rebuilding
docker compose run --rm migrate

# Stop containers while preserving data
docker compose down

# Remove containers and local named-volume data
docker compose down --volumes
```

`docker compose down --volumes` permanently deletes the local database and
legacy JSON data. Images are not removed by that command.

## Health checks

```bash
curl --fail http://localhost:3000/api/health
curl --fail -H 'x-dev-user: EMP-002' http://localhost:3000/api/me
```

The first endpoint checks application liveness. The second also verifies the
seeded development identity and PostgreSQL-backed tenant lookup, but it succeeds
only when the development override is explicitly enabled.

## Production image

Build the same final target used by Compose and Cloud Run:

```bash
docker build --target production -t mesadesk:local .
```

The runtime image runs as the unprivileged `node` user and does not contain the
Prisma CLI or development dependencies. Use the `migration` target for release
migrations. For a real deployment, keep `MESADESK_DEV_AUTH=0`, use a strong
`AUTH_SECRET`, and supply authentication and database credentials through the
platform's secret manager.
