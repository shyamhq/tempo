import { db } from '@tempo/db/client';
import { vm_runs } from '@tempo/db/schema';
import { appendEvent } from '@tempo/server';
import { isNull, sql } from 'drizzle-orm';
import { logger } from '../logger';
import { provision, type VmRun } from '../vm/provision';
import { teardown } from '../vm/teardown';

// Single-process Hosted lifecycle manager. No NOTIFY, no LISTEN, no
// auto-spawn — VMs are created by an explicit user click on the Console
// (POST /api/hosted/wake). This module only tracks live Sandboxes, arms
// the wallclock timer, and reaps on shutdown.

const log = logger.child({ module: 'supervisor' });

const live = new Map<string, { run: VmRun; expiresTimer: NodeJS.Timeout }>();
// Synchronous claim so two concurrent wake POSTs cannot both pass the
// "is anything alive?" check before either has populated `live`.
const spawning = new Set<string>();
let stopped = false;

// Inactivity, not wallclock. The Manus shape: a Dev can comment, walk away
// for a few minutes, come back. Quiet for 10 min in both directions
// (no agent-events POST, no drain returning Dev events) → reap.
const SANDBOX_INACTIVITY_MS = 10 * 60 * 1000;

function armReapTimer(threadId: string): NodeJS.Timeout {
  const t = setTimeout(() => void reap(threadId, 'inactivity_timeout'), SANDBOX_INACTIVITY_MS);
  t.unref();
  return t;
}

// Refreshed on every "real activity" signal: runner posting agent-events, or
// drain returning Dev events. Bumps e2b's wallclock kill AND our reap timer
// so neither beats the actual quiet period.
export function touch(threadId: string): void {
  const entry = live.get(threadId);
  if (!entry) return;
  entry.run.sandbox
    .setTimeout(SANDBOX_INACTIVITY_MS)
    .catch((err: unknown) => log.warn({ err, threadId }, 'touch: sandbox.setTimeout failed'));
  clearTimeout(entry.expiresTimer);
  entry.expiresTimer = armReapTimer(threadId);
}

export type WakeResult =
  | { status: 'spawned'; vm_run_id: string; sandbox_id: string }
  | { status: 'already_running'; sandbox_id: string };

// Explicit entry point — called from the wake route after auth + thread
// scope checks. Idempotent within one process: a second call while a
// sandbox is alive (or while one is mid-spawn) returns `already_running`.
export async function spawnHosted(opts: {
  threadId: string;
  workspaceId: string;
}): Promise<WakeResult> {
  const { threadId, workspaceId } = opts;
  if (stopped) throw new Error('supervisor: stopped');

  const existing = live.get(threadId);
  if (existing) {
    log.info({ threadId, event: 'wake:already_running' }, 'sandbox already alive');
    return { status: 'already_running', sandbox_id: existing.run.sandbox.sandboxId };
  }
  if (spawning.has(threadId)) {
    log.info({ threadId, event: 'wake:already_spawning' }, 'spawn already in flight');
    return { status: 'already_running', sandbox_id: 'pending' };
  }
  spawning.add(threadId);

  try {
    const run = await provision({ threadId, workspaceId });
    live.set(threadId, { run, expiresTimer: armReapTimer(threadId) });
    log.info(
      {
        threadId,
        event: 'wake:spawned',
        vmRunId: run.vm_run_id,
        sandboxId: run.sandbox.sandboxId,
      },
      'provisioned new sandbox',
    );
    return { status: 'spawned', vm_run_id: run.vm_run_id, sandbox_id: run.sandbox.sandboxId };
  } catch (err) {
    log.error({ err, threadId, event: 'wake:failed' }, 'provision failed');
    throw err;
  } finally {
    spawning.delete(threadId);
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

export async function stopSupervisor(): Promise<void> {
  stopped = true;
  await Promise.all(Array.from(live.keys()).map((tid) => reap(tid, 'worker_shutdown')));
}

// Boot-time sweep. The `live` Map only knows about Sandboxes this process
// spawned, so a hard-killed previous Worker leaves `vm_runs` rows with
// `ended_at IS NULL` plus DB session state stuck at `connected`. We can't
// touch the actual E2B Sandbox — its handle died with the previous process
// — but E2B's own wallclock will reap it within a few minutes. Closing the
// DB row + emitting `session_disconnected` keeps the Console in sync.
export async function startSupervisor(): Promise<void> {
  const orphans = await db
    .select({ id: vm_runs.id, thread_id: vm_runs.thread_id })
    .from(vm_runs)
    .where(isNull(vm_runs.ended_at));
  if (orphans.length === 0) return;
  log.info({ count: orphans.length }, 'sweeping orphaned vm_runs at boot');
  for (const row of orphans) {
    await db
      .update(vm_runs)
      .set({ ended_at: sql`now()`, exit_reason: 'orphaned_by_restart' })
      .where(sql`${vm_runs.id} = ${row.id}`);
  }
}
