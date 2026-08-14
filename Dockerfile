# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*


# Install the complete dependency graph once. Copying the Prisma schema before
# npm ci lets @prisma/client's postinstall hook find the project schema.
FROM base AS dependencies
COPY package.json package-lock.json ./
COPY server/prisma/schema.prisma ./server/prisma/schema.prisma
# Cloud Build's standard docker builder may run without BuildKit. Keep this
# layer compatible with both classic Docker and BuildKit; its worker-local npm
# cache would not survive across Cloud Build jobs anyway.
RUN npm ci
RUN npx prisma generate


# Hot-reload target used by docker-compose.dev.yml.
FROM dependencies AS development
ENV NODE_ENV=development
ENV PORT=3000
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]


# Reproducible CI target. Cloud Build runs this image against a disposable
# PostgreSQL container, applies every migration, seeds demo fixtures, and then
# executes the complete lint/test/build gate.
FROM dependencies AS quality
COPY . .
RUN npx prisma generate


# Compile the Vite SPA and bundled Express server.
FROM dependencies AS build
COPY . .
RUN npx prisma generate
RUN npm run build


# Keep migration, role-bootstrap and seed tooling out of the production runtime
# image while still making those commands available as one-shot services.
FROM dependencies AS migration
ENV NODE_ENV=production
COPY . .
CMD ["npm", "run", "release:migrate"]


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
COPY --from=build /app/server/prisma/migrations ./server/prisma/migrations
EXPOSE 8080
USER node
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/ready').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "dist/server/server.mjs"]
