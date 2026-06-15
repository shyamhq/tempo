# Task 2.7 — Hosted lifecycle supervisor (Slice 2)

## Problem

Tasks 2.1–2.6 wired the inputs (Mailbox writer + identity) and the
infra (provisioner + runner). Nothing actually *dispatches* a NOTIFY
into a VM provision call. The supervisor closes that loop.

## The change

One file: `apps/worker/src/hosted/supervisor.ts`. One function:
`startSupervisor()`. Called once at Worker boot from
`apps/worker/src/index.ts`.

```ts
// apps/worker/src/hosted/supervisor.ts
import { db } from '@tempo/db/client';
import { mailbox_events, threads, workspaces } from '@tempo/db/schema';
import { subscribeWakeups } from '@tempo/server';
import { eq, isNull } from 'drizzle-orm';
import { isFresh } from '../server/presence';
import { logger } from '../logger';
import { provision, type VmRun } from '../vm/provision';
import { teardown } from '../vm/teardown';

// One process-wide map. Single Worker assumption — when Worker scales
// horizontally, the registry must move to a shared store (same as the
// presence registry from slice 1d).
const live = new Map<string, { run: VmRun; expiresTimer: NodeJS.Timeout }>();

const SANDBOX_BUDGET_MS = 10 * 60 * 1000;

function armExpiresTimer(threadId: string): NodeJS.Timeout {
  const t = setTimeout(() => void reap(threadId, 'wallclock_timeout'), SANDBOX_BUDGET_MS);
  t.unref();
  return t;
}

async function dispatch(threadId: string): Promise<void> {
  const existing = live.get(threadId);
  if (existing) {
    // NOTIFY arrived while a VM is alive — extend its wallclock budget.
    // sandbox.setTimeout(N) RESETS the budget to N from now (per e2b SDK
    // 2.30.0: "extend or reduce ... from the last call to setTimeout").
    try {
      await existing.run.sandbox.setTimeout(SANDBOX_BUDGET_MS);
      clearTimeout(existing.expiresTimer);
      existing.expiresTimer = armExpiresTimer(threadId);
    } catch (err) {
      logger.warn({ err, threadId }, 'supervisor: setTimeout extend failed');
    }
    return;
  }
  if (isFresh(threadId)) return; // Local CLI handles it

  // Read the Thread's workspace + hosted_enabled in one query. Skip if
  // the Workspace toggled hosted off between enqueue and dispatch.
  const [row] = await db
    .select({ workspaceId: workspaces.id, enabled: workspaces.hosted_enabled })
    .from(workspaces)
    .innerJoin(threads, eq(threads.workspace_id, workspaces.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row?.enabled) return;

  try {
    const run = await provision({ threadId, workspaceId: row.workspaceId });
    live.set(threadId, { run, expiresTimer: armExpiresTimer(threadId) });
    logger.info({ threadId, vmRunId: run.vm_run_id }, 'supervisor: provisioned');
  } catch (err) {
    logger.error({ err, threadId }, 'supervisor: provision failed');
  }
}

async function reap(threadId: string, reason: string): Promise<void> {
  const entry = live.get(threadId);
  if (!entry) return;
  clearTimeout(entry.expiresTimer);
  live.delete(threadId);
  await teardown({
    sandbox: entry.run.sandbox,
    vm_run_id: entry.run.vm_run_id,
    exit_reason: reason,
  });
}

// Boot-time sweep: any unconsumed Mailbox rows from a prior Worker boot
// or NOTIFY drop need a fresh dispatch. Coalesce by threadId.
async function bootSweep(): Promise<void> {
  const rows = await db
    .selectDistinct({ thread_id: mailbox_events.thread_id })
    .from(mailbox_events)
    .where(isNull(mailbox_events.consumed_at));
  for (const r of rows) await dispatch(r.thread_id);
}

export async function startSupervisor(): Promise<void> {
  await subscribeWakeups({ onWake: (tid) => void dispatch(tid) });
  await bootSweep();
  logger.info('supervisor: started');
}

// Graceful shutdown — kill all live Sandboxes so vm_runs.ended_at is set.
export async function stopSupervisor(): Promise<void> {
  await Promise.all(
    Array.from(live.keys()).map((tid) => reap(tid, 'worker_shutdown')),
  );
}
```

Boot wiring in `apps/worker/src/index.ts` after the listen call:

```ts
import { startSupervisor, stopSupervisor } from './hosted/supervisor';
...
app.listen(env.PORT, ...);
void startSupervisor().catch((err) => logger.error({ err }, 'supervisor boot failed'));
process.once('SIGTERM', () => void stopSupervisor());
process.once('SIGINT', () => void stopSupervisor());
```

## Deliberate simplifications (algorithm + ponytail)

- **One Map, one timeout per entry.** No XState, no event bus. Five
  states (idle / provisioning / running / reaping) compress to "is
  the key in `live` or not?" plus an in-flight `provision()` promise.
- **No reconnect to live Sandboxes on Worker restart.** A reboot kills
  the supervisor; the Map is empty. The boot sweep covers any pending
  Mailbox rows; whatever Sandboxes were live before reboot will exit
  themselves at MAX_IDLE_MS. Their `vm_runs` rows stay `ended_at IS
  NULL` until a cron sweeps them — file as known gap, not a Slice 2
  blocker.
- **No idle-time tracking inside the supervisor.** The Sandbox runner
  itself exits at MAX_IDLE_MS. The supervisor's timer just guarantees
  the Map entry doesn't outlive the Sandbox indefinitely.
- **Boot sweep is unfiltered by `isFresh`.** A Local CLI could be
  reconnecting during boot; dispatching anyway is harmless because
  `dispatch` itself re-checks. Single source of truth.
- **`provision()` errors are logged and swallowed.** A failed provision
  leaves the orphan `vm_runs` row (closed via `provision`'s try/catch
  from Task 2.5). Supervisor doesn't retry — the next Mailbox NOTIFY
  for the same Thread triggers a fresh dispatch.
- **No per-Workspace concurrency limit.** Cost-cap is forward work.

## Alternatives considered

1. **State-machine library (XState, Robot).** Five states, single
   process, one boolean per Thread. Library overhead is invented
   complexity.
2. **Periodic `setInterval` reconciler that walks the Map.** Simpler
   in concept; redundant given each entry has its own timer.
3. **Track Sandbox death via a polling `sandbox.isAlive()` call.**
   Network round-trip per Thread per N seconds. Wallclock timer is
   correct enough and avoids the polling cost.

## Uncertainties

- **NOTIFY-drop during the boot sweep.** subscribeWakeups starts before
  bootSweep runs. A NOTIFY arriving for a Thread already in the sweep's
  result set could double-dispatch — but `dispatch` is idempotent
  (`live.has(threadId) → return`), so the second dispatch is a no-op.
  Safe.
- **A NOTIFY for a Thread already running but at the timer's edge.**
  If the timer is about to fire as a NOTIFY arrives, `dispatch` sees
  the entry, returns, the timer fires immediately after, reaps. The
  next NOTIFY (≤5s later from the runner's own poll) triggers a fresh
  provision. Outcome: one wasted MCP call's worth of latency. Acceptable.

## Layer assignment

- `apps/worker/src/hosted/supervisor.ts` — new (orchestration).
- `apps/worker/src/index.ts` — boot wire-up.

## Deletion test

- `supervisor.ts` — the sole NOTIFY → provision dispatch surface.
  **Earns its keep.**
- `bootSweep` — recovers any NOTIFYs lost across Worker restart. One
  query at boot; cheap. **Earns its keep.**
- `stopSupervisor` — graceful shutdown so vm_runs has ended_at. **Earns
  its keep.**

## Execution

```bash
bun run typecheck
bun run lint
# Manual smoke (requires E2B template built):
#   - Set hosted_enabled=true on a Workspace.
#   - Insert a row into mailbox_events.
#   - Worker logs "supervisor: provisioned"; vm_runs has a started_at.
#   - Wait > MAX_IDLE_MS; vm_runs.ended_at populates with wallclock_timeout.
```

## Acceptance

- typecheck + lint clean.
- code-simplifier + code-reviewer pass.
- Boot sweep query verified against a populated `mailbox_events`.

## Forward-links

- Task 2.8 is purely UI — doesn't touch the supervisor.
- "Reconnect to live Sandboxes on Worker restart" is filed as a known
  gap; cleanup cron is a Slice 3+ concern.
