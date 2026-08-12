# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*


# Install the complete dependency graph once. Copying the Prisma schema before
# npm ci lets @prisma/client's postinstall hook find the project schema.
FROM base AS dependencies
COPY package.json package-lock.json ./
COPY server/prisma/schema.prisma ./server/prisma/schema.prisma
RUN --mount=type=cache,target=/root/.npm npm ci
RUN npx prisma generate


# Hot-reload target used by docker-compose.dev.yml.
FROM dependencies AS development
ENV NODE_ENV=development
ENV PORT=3000
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]


# Compile the Vite SPA and bundled Express server.
FROM dependencies AS build
COPY . .
RUN npx prisma generate
RUN npm run build


# Keep migration and seed tooling out of the production runtime image while
# still making those commands available as one-shot Compose services.
FROM dependencies AS migration
ENV NODE_ENV=production
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]


# Prune development-only packages after the application has been built.
FROM build AS production-dependencies
RUN npm prune --omit=dev


# Production-like local image and Cloud Run image: Vite SPA + Express API.
FROM base AS production
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/prisma/schema.prisma ./server/prisma/schema.prisma
COPY firebase-applet-config.json ./firebase-applet-config.json

# The legacy JSON bridge still serves domains that have not moved to Postgres.
# The directory becomes a named volume in Compose and must be writable by the
# non-root runtime user.
RUN mkdir -p /app/storage && chown node:node /app/storage

EXPOSE 8080
USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "dist/server.cjs"]
