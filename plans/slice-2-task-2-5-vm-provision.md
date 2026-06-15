# Task 2.5 — E2B Sandbox provisioner (Slice 2)

## Problem

Tasks 2.1–2.4 wired the Mailbox + Hosted identity. Nothing actually
spawns a Sandbox yet. Task 2.7 (supervisor) needs a single function
`provision(threadId)` that creates a per-Session E2B Sandbox with the
right env, egress rules, and bookkeeping; and a matching `teardown` that
kills the Sandbox and finalises the `vm_runs` row.

## The change

Two files in `apps/worker/src/vm/`:

### `provision.ts`

```ts
import { db } from '@tempo/db/client';
import { vm_runs } from '@tempo/db/schema';
import { newVmRunId } from '@tempo/server';
import { Sandbox } from 'e2b';
import { eq } from 'drizzle-orm';
import { env } from '../env';
import { logger } from '../logger';
import { issueHostedToken } from '../server/cli-auth'; // Worker-local

export type VmRun = {
  sandbox: Sandbox;
  vm_run_id: string;
  hosted_token: string;
  session_id: string;
};

// Initial wallclock budget. e2b's `timeoutMs` is hard-kill from create,
// NOT idle. Task 2.7 calls `sandbox.setTimeout(...)` between Turns to
// extend the budget on activity. 10 min covers a single complex Turn
// plus a generous buffer.
const SANDBOX_INITIAL_TIMEOUT_MS = 10 * 60 * 1000;
const TEMPLATE_NAME = 'tempo-hosted-runner';

// Allowlist — non-negotiable per agent-harness.md §6. Anthropic for the
// SDK call; GitHub for repo clone; Worker for MCP. Everything else denied.
const EGRESS_ALLOWLIST = [
  'api.anthropic.com',
  'api.github.com',
  'github.com',
  'codeload.github.com',
];

export async function provision(opts: {
  threadId: string;
  workspaceId: string;
  repoUrl?: string;
  ghToken?: string;
}): Promise<VmRun> {
  const { threadId, workspaceId, repoUrl, ghToken } = opts;
  const hosted = await issueHostedToken(threadId);

  const vmRunId = newVmRunId();
  await db.insert(vm_runs).values({ id: vmRunId, thread_id: threadId });

  const sandbox = await Sandbox.create({
    template: TEMPLATE_NAME,
    apiKey: env.E2B_API_KEY,
    timeoutMs: SANDBOX_INITIAL_TIMEOUT_MS,
    envs: {
      TEMPO_THREAD_ID: threadId,
      TEMPO_WORKSPACE_ID: workspaceId,
      TEMPO_HOSTED_TOKEN: hosted.token,
      TEMPO_SESSION_ID: hosted.session_id,
      WORKER_MCP_URL: env.WORKER_PUBLIC_URL,
      ...(repoUrl ? { REPO_URL: repoUrl } : {}),
      ...(ghToken ? { GITHUB_APP_TOKEN: ghToken } : {}),
    },
    network: {
      allowOut: [
        ...EGRESS_ALLOWLIST,
        new URL(env.WORKER_PUBLIC_URL).hostname,
      ],
    },
    metadata: { tempo_thread_id: threadId, tempo_vm_run_id: vmRunId },
  });

  // Backfill sandboxId for postmortem ("which E2B run was that?").
  await db.update(vm_runs).set({ sandbox_id: sandbox.sandboxId }).where(eq(vm_runs.id, vmRunId));

  await sandbox.commands.run('node /app/runner.js', { background: true });
  logger.info({ threadId, sandboxId: sandbox.sandboxId, vmRunId }, 'vm: provisioned');

  return { sandbox, vm_run_id: vmRunId, hosted_token: hosted.token, session_id: hosted.session_id };
}
```

### `teardown.ts`

```ts
import type { Sandbox } from 'e2b';
import { db } from '@tempo/db/client';
import { vm_runs } from '@tempo/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../logger';

export async function teardown(opts: {
  sandbox: Sandbox;
  vm_run_id: string;
  exit_reason: string;
}): Promise<void> {
  try {
    await opts.sandbox.kill();
  } catch (err) {
    // Already killed (e.g. idle-timeout fired) → ok. Anything else → log + continue.
    logger.warn({ err, vmRunId: opts.vm_run_id }, 'vm: kill failed (already dead?)');
  }
  await db
    .update(vm_runs)
    .set({ ended_at: sql`now()`, exit_reason: opts.exit_reason })
    .where(eq(vm_runs.id, opts.vm_run_id));
  logger.info({ vmRunId: opts.vm_run_id, reason: opts.exit_reason }, 'vm: torn down');
}
```

### Env additions

`apps/worker/src/env.ts`:
- `E2B_API_KEY: z.string().min(1)` — required.
- `WORKER_PUBLIC_URL: z.string().url()` — the URL the Sandbox uses to
  reach Worker's MCP endpoint. Defaults to `http://localhost:3001` in
  dev; required to be a real URL in prod.

### Cost estimate — deferred

The plan calls for `vm_runs.cost_estimate_usd`. Implementing it
properly needs (started_at, ended_at, vcpu_seconds × rate) — and the
SDK doesn't surface vCPU stats per Sandbox. **Deferred:** leave the
column nullable; teardown writes NULL. A future job computes it from
E2B's billing API.

## Deliberate simplifications (algorithm + ponytail)

- **No `SandboxHandle` wrapper.** The slice-2 plan named one; the e2b
  `Sandbox` class IS the handle. Wrapping it in our own type adds nothing.
- **No retry on `Sandbox.create` failures.** First call fails →
  supervisor logs + bails; the next Mailbox NOTIFY for the same Thread
  triggers a fresh attempt. *Skipped: retry; the queue is the retry.*
- **No template build automation.** Task 2.6 owns the e2b.toml template
  + the build script; this task just references the template name.
- **No cost-estimate writer.** Column stays NULL until a real cost
  pipeline ships.
- **Single allowlist constant.** Per-Workspace allowlists are a Slice 3
  (Connectors / Gateway) concern. *Skipped: per-Workspace egress; add
  when Connectors land.*

## Alternatives considered

1. **Wrap `Sandbox` in a `SandboxHandle` type.** Rejected — one
   adapter is hypothetical (CLAUDE.md). The e2b `Sandbox` is the type.
2. **Provision in the supervisor inline rather than a separate file.**
   `provision`/`teardown` is two well-bounded concerns called from the
   supervisor; extracting reads better and lets `teardown` be called
   from multiple places (idle timeout reaper, error path, supervisor
   shutdown).
3. **Persist the sandboxId in `vm_runs` for postmortem.** Worth doing
   if it's free — but `sandbox.sandboxId` is a string and the schema's
   `vm_runs` doesn't have a column for it. Adding the column means a
   new migration. **Score: add a `sandbox_id` column to `vm_runs`** in
   this task — one column, valuable for "which E2B run was that?"
   debugging.

→ Decision: add the column. Cheap; high postmortem value.

## Schema bump (added by this task)

`vm_runs.sandbox_id` — nullable text (NULL until `provision` writes it
back; staying nullable lets the `vm_runs` row be inserted before
`Sandbox.create` returns).

## Uncertainties

- **E2B template existence.** `Sandbox.create` will reject if
  `tempo-hosted-runner` isn't built. This task doesn't build the
  template — Task 2.6 does. The implementer should land 2.5 code as
  unreachable-until-template-exists, with a comment.
- **`WORKER_PUBLIC_URL` resolution.** In dev, `http://localhost:3001`
  works only because E2B's outbound to localhost is allowed by the
  current allowOut entry. If E2B blocks loopback outbound, dev must
  use ngrok / a tunnel. Documented in the env example.

## Layer assignment

- `apps/worker/src/vm/provision.ts` — new (orchestration).
- `apps/worker/src/vm/teardown.ts` — new.
- `apps/worker/src/env.ts` — extend.
- `apps/worker/.env.example` — extend.
- `packages/db/src/schema.ts` — add `sandbox_id` column to `vm_runs`.
- `packages/db/drizzle/0006_*.sql` — generated migration.

## Deletion test

- `provision` — sole VM spawn site. **Earns its keep.**
- `teardown` — sole sandbox.kill + vm_runs finalise site. Two callers
  (supervisor idle timeout, supervisor shutdown). **Earns its keep.**
- `sandbox_id` column — for "find this run in E2B's dashboard."
  Marginal until you need it; one column. **Keep.**

## Execution

```bash
# schema
bun run --filter @tempo/db db:generate
bun run --filter @tempo/db db:migrate

# code
bun run typecheck
bun run lint

# Smoke (requires E2B_API_KEY + template built — Task 2.6):
#   - Set hosted_enabled=true on a Workspace.
#   - Call provision({ threadId, workspaceId }); see vm_runs row + sandbox.
#   - Call teardown({ sandbox, vm_run_id, exit_reason: 'manual' }); see ended_at.
```

## Acceptance

- typecheck + lint clean.
- code-simplifier + code-reviewer pass.
- (Smoke gated by Task 2.6's template build.)

## Forward-links

- **Task 2.6** owns the `tempo-hosted-runner` template (e2b.toml +
  bundled runner.js). Until that lands, `provision` will fail at
  `Sandbox.create`.
- **Task 2.7** (supervisor) is the sole caller of `provision` /
  `teardown`.
