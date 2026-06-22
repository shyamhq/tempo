# syntax=docker/dockerfile:1.7

# Stage 1: build the Worker with Bun. Copy lockfile + package.json files first
# so bun install caches independently of source changes.
FROM oven/bun:1 AS build
WORKDIR /repo

COPY package.json bun.lockb* bun.lock* turbo.json tsconfig.base.json biome.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/console/package.json ./apps/console/package.json
COPY apps/agent/package.json ./apps/agent/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/errors/package.json ./packages/errors/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/sse-client/package.json ./packages/sse-client/package.json
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/worker ./apps/worker

WORKDIR /repo/apps/worker
# Use the package.json build script (single source of truth) — it carries the
# --loader=.md:text flag the worker needs for its src/skills/*.md imports.
RUN bun run build

# Stage 2: production runtime — minimal Node 20 image.
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

COPY --from=build /repo/apps/worker/dist/index.js ./index.js

EXPOSE 3001
CMD ["node", "index.js"]
