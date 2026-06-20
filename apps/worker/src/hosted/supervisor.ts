import { getInstallationToken, publishVmSignal } from '@tempo/server';
import { logger } from '../logger';
import { provision, type VmRun } from '../vm/provision';
import { teardown } from '../vm/teardown';

// Single-process Hosted lifecycle manager. No NOTIFY, no LISTEN, no
// auto-spawn — VMs are created by a wake POST (/api/hosted/wake). This module
// tracks the Sandboxes THIS process spawned, refreshes their E2B wallclock on
// activity, and reaps them on inactivity or shutdown. There is deliberately no
// boot orphan-sweep: in multi-container it would close sibling containers' live
// vm_runs on every deploy. Cross-container liveness is the DB heartbeat
// (touchVmRun) + lazy reapStaleVmRun before spawn, with E2B's wallclock as the
// backstop that actually kills the sandbox.

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
  // The attached repos, read once by the wake handler. Passing them in (rather
  // than re-reading threads.repos here) closes a race with a concurrent
  // repo_linked: the handler's gate and this spawn act on the same snapshot.
  repos: string[];
}): Promise<WakeResult> {
  const { threadId, workspaceId, repos } = opts;
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
    // Mint the GitHub App installation token right before Sandbox.create (token
    // is ~1h TTL — decision 6 / "Cloning"). Only mint when there's something to
    // clone; a repo-less Thread never reaches here (the wake handler routes it
    // to the in-process conversation).
    const token = repos.length > 0 ? (await getInstallationToken(workspaceId)).token : undefined;

    const run = await provision({ threadId, workspaceId, repos, token });
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

// Tear down the live Sandbox for a thread (if this process owns it). Public so
// the wake route can reap on a repo change before re-provisioning against the
// new repo list — a live VM's env is immutable.
export async function reap(threadId: string, reason: string): Promise<void> {
  const entry = live.get(threadId);
  if (!entry) return;
  clearTimeout(entry.expiresTimer);
  live.delete(threadId);
  await teardown({
    sandbox: entry.run.sandbox,
    vm_run_id: entry.run.vm_run_id,
    exit_reason: reason,
  });
  // Clear the Console checklist — the row is closed; no Sandbox is live. A
  // repo-change reap is immediately followed by a fresh `provisioning` push.
  await publishVmSignal(threadId, null);
}

export async function stopSupervisor(): Promise<void> {
  stopped = true;
  await Promise.all(Array.from(live.keys()).map((tid) => reap(tid, 'worker_shutdown')));
}
