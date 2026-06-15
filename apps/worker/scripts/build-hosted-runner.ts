#!/usr/bin/env bun
// Bundles src/hosted/runner.ts into e2b/hosted-runner.js so the E2B
// template build picks it up. Run before `e2b template build` from
// apps/worker/e2b/.
import { $ } from 'bun';

await $`bun build --target=node --bundle src/hosted/runner.ts --outfile e2b/hosted-runner.js`;
console.log('hosted runner bundled at apps/worker/e2b/hosted-runner.js');
