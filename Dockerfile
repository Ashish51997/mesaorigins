# Production image: Vite SPA + Express API in one Cloud Run service.
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/prisma ./server/prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=build /app/dist ./dist
COPY firebase-applet-config.json ./firebase-applet-config.json

# Cloud Run injects PORT; listen on 0.0.0.0 (already in server).
EXPOSE 8080
USER node
CMD ["node", "dist/server.cjs"]
