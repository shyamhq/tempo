#!/usr/bin/env bun
// Bundles src/hosted/runner.ts into e2b/hosted-runner.js so the E2B
// template build picks it up. Run before `e2b template build` from
// apps/worker/e2b/.
import { $ } from 'bun';

// Externalize everything the e2b template installs via npm
// (hosted-package.json). Only our own source code gets bundled into
// hosted-runner.js — keeps the file small and avoids embedding native
// optionalDependencies that bun build can't carry across platforms.
await $`bun build --target=node --bundle --external='ai' --external='@ai-sdk/*' --external='@modelcontextprotocol/*' --external='zod' src/hosted/runner.ts --outfile e2b/hosted-runner.js`;
console.log('hosted runner bundled at apps/worker/e2b/hosted-runner.js');
