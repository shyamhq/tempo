import { db } from '@tempo/db/client';
import { mailbox_events, threads, workspaces } from '@tempo/db/schema';
import { subscribeWakeups } from '@tempo/server';
import { eq, isNull } from 'drizzle-orm';
import { logger } from '../logger';
import { isFresh } from '../server/presence';
import { provision, type VmRun } from '../vm/provision';
import { teardown } from '../vm/teardown';

// Single-process Hosted supervisor: turns Mailbox NOTIFYs into VM
// provisions. Slice 1d's presence registry assumption (one Worker) holds
// here too — when Worker scales horizontally, this map moves alongside.
const live = new Map<string, { run: VmRun; expiresTimer: NodeJS.Timeout }>();
// In-flight set: prevents a NOTIFY-during-bootSweep from double-provisioning
// the same Thread while the first provision is still resolving.
const provisioning = new Set<string>();
let stopped = false;

const SANDBOX_BUDGET_MS = 10 * 60 * 1000;

function armExpiresTimer(threadId: string): NodeJS.Timeout {
  const t = setTimeout(() => void reap(threadId, 'wallclock_timeout'), SANDBOX_BUDGET_MS);
  t.unref();
  return t;
}

// `void` floats the promise — failures land in the swallow-log paths below.
async function dispatch(threadId: string): Promise<void> {
  if (stopped) return;
  const existing = live.get(threadId);
  if (existing) {
    // NOTIFY arrived while a VM is alive — extend its wallclock budget.
    // sandbox.setTimeout(N) resets the budget to N from now per the e2b
    // SDK 2.30.0 docs ("extend or reduce ... from the last call").
    try {
      await existing.run.sandbox.setTimeout(SANDBOX_BUDGET_MS);
      clearTimeout(existing.expiresTimer);
      existing.expiresTimer = armExpiresTimer(threadId);
      return;
    } catch (err) {
      // Sandbox is gone (e.g. self-reap on runner MAX_IDLE_MS). Drop the
      // stale entry and re-dispatch so a fresh VM picks up this NOTIFY.
      logger.warn({ err, threadId }, 'supervisor: sandbox unreachable — reaping + redispatch');
      await reap(threadId, 'sandbox_unreachable');
      // Fall through to the provision path below.
    }
  }
  if (isFresh(threadId)) return;
  if (provisioning.has(threadId)) return;

  const [row] = await db
    .select({ workspaceId: workspaces.id, enabled: workspaces.hosted_enabled })
    .from(workspaces)
    .innerJoin(threads, eq(threads.workspace_id, workspaces.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row?.enabled) return;

  provisioning.add(threadId);
  try {
    const run = await provision({ threadId, workspaceId: row.workspaceId });
    live.set(threadId, { run, expiresTimer: armExpiresTimer(threadId) });
    logger.info({ threadId, vmRunId: run.vm_run_id }, 'supervisor: provisioned');
  } catch (err) {
    logger.error({ err, threadId }, 'supervisor: provision failed');
  } finally {
    provisioning.delete(threadId);
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

// Recover any NOTIFYs lost across a Worker restart. Coalesce by threadId
// so one row per Thread dispatches even if many events queued.
async function bootSweep(): Promise<void> {
  const rows = await db
    .selectDistinct({ thread_id: mailbox_events.thread_id })
    .from(mailbox_events)
    .where(isNull(mailbox_events.consumed_at));
  for (const r of rows) await dispatch(r.thread_id);
}

let listener: { close: () => Promise<void> } | null = null;

export async function startSupervisor(): Promise<void> {
  listener = await subscribeWakeups({ onWake: (tid) => void dispatch(tid) });
  await bootSweep();
  logger.info('supervisor: started');
}

export async function stopSupervisor(): Promise<void> {
  stopped = true;
  await listener?.close(); // stop receiving NOTIFY first
  listener = null;
  await Promise.all(Array.from(live.keys()).map((tid) => reap(tid, 'worker_shutdown')));
}
