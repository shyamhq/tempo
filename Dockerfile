# syntax=docker/dockerfile:1.7

# Stage 1: build the Console with Bun. We copy lockfile + every package.json
# first so `bun install` caches independently of source changes, then drop in
# the source and run the Next.js standalone build.
FROM oven/bun:1 AS build
WORKDIR /repo

COPY package.json bun.lockb* bun.lock* turbo.json tsconfig.base.json biome.json ./
COPY apps/console/package.json ./apps/console/package.json
COPY apps/agent/package.json ./apps/agent/package.json
# Every workspace member must be present or `bun install --frozen-lockfile`
# sees a changed workspace and aborts — even members this image never runs.
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/errors/package.json ./packages/errors/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/sse-client/package.json ./packages/sse-client/package.json
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/console ./apps/console

# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they must be
# present here, not supplied as runtime secrets. Worker URL + Clerk publishable
# key come from fly.toml [build.args] / --build-arg; the Clerk route paths are
# static defaults.
ARG NEXT_PUBLIC_WORKER_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
ENV NEXT_PUBLIC_WORKER_URL=$NEXT_PUBLIC_WORKER_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL \
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL

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
