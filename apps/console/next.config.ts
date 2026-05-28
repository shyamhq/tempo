import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@tempo/contracts'],
  // Standalone build emits a minimal `server.js` + node_modules tree that the
  // production Dockerfile copies into a `node:20-slim` runtime stage (T11).
  output: 'standalone',
  // The monorepo lockfile lives at the repo root; without this Next emits a
  // warning when it auto-detects a second lockfile inside `apps/console`.
  outputFileTracingRoot: process.cwd().replace(/\/apps\/console\/?$/, ''),
};

export default config;
