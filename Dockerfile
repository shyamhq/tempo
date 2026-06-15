# syntax=docker/dockerfile:1.7

# Stage 1: build the Console with Bun. We copy lockfile + every package.json
# first so `bun install` caches independently of source changes, then drop in
# the source and run the Next.js standalone build.
FROM oven/bun:1 AS build
WORKDIR /repo

COPY package.json bun.lockb* bun.lock* turbo.json tsconfig.base.json biome.json ./
COPY apps/console/package.json ./apps/console/package.json
COPY apps/agent/package.json ./apps/agent/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/console ./apps/console

WORKDIR /repo/apps/console
RUN bun run build
RUN bun build ../../packages/db/src/migrate.ts --target=node --bundle --outfile=.next/standalone/packages/db/src/migrate.js

# Stage 2: production runtime. Next standalone bundles its own minimal
# node_modules tree; we just need Node and the three emitted artefacts.
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone output: `.next/standalone/apps/console/server.js` is the entry,
# but Next mirrors the monorepo layout, so we keep `/app` rooted at the
# standalone directory.
COPY --from=build /repo/apps/console/.next/standalone ./
COPY --from=build /repo/apps/console/.next/static ./apps/console/.next/static
COPY --from=build /repo/apps/console/public ./apps/console/public
COPY --from=build /repo/packages/db/drizzle ./packages/db/drizzle

EXPOSE 3000
CMD ["node", "apps/console/server.js"]
