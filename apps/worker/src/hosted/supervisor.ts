import { appendEvent } from '@tempo/server';
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
  const t = setTimeout(
    () => void reap(threadId, 'inactivity_timeout'),
    SANDBOX_INACTIVITY_MS,
  );
  t.unref();
  return t;
}

// Refreshed on every "real activity" signal: runner posting agent-events, or
// drain returning Dev events. Bumps e2b's wallclock kill AND our reap timer
// so neither beats the actual quiet period.
export function touch(threadId: string): void {
  const entry = live.get(threadId);
  if (!entry) return;
  entry.run.sandbox.setTimeout(SANDBOX_INACTIVITY_MS).catch((err: unknown) =>
    log.warn({ err, threadId }, 'touch: sandbox.setTimeout failed'),
  );
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
    await appendEvent(threadId, { kind: 'session_initiating' });
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
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    await appendEvent(threadId, {
      kind: 'session_failed',
      reason: `provision_failed: ${reason}`,
    }).catch((e) => log.warn({ err: e, threadId }, 'failed to post session_failed'));
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
  await appendEvent(threadId, { kind: 'session_disconnected' }).catch((e) =>
    log.warn({ err: e, threadId }, 'failed to post session_disconnected'),
  );
}

export async function stopSupervisor(): Promise<void> {
  stopped = true;
  await Promise.all(Array.from(live.keys()).map((tid) => reap(tid, 'worker_shutdown')));
}
