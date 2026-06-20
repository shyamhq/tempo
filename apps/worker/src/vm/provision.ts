import { db } from '@tempo/db/client';
import { vm_runs } from '@tempo/db/schema';
import { failVmRun, newVmRunId, publishVmSignal, reapStaleVmRun } from '@tempo/server';
import { eq } from 'drizzle-orm';
import { Sandbox } from 'e2b';
import { env } from '../env';
import { sanitizeCloneError } from '../hosted/clone';
import { logger } from '../logger';
import { issueHostedToken } from '../server/cli-auth';

export type VmRun = {
  sandbox: Sandbox;
  vm_run_id: string;
  session_id: string;
};

// Initial budget on Sandbox.create. Supervisor's touch() refreshes this on
// every real-activity signal (agent-events POST, drain returning Dev events),
// so the effective lifetime is "10 min from the last touch", not "10 min
// from spawn".
const SANDBOX_INITIAL_TIMEOUT_MS = 10 * 60 * 1000;
const TEMPLATE_NAME = 'tempo-hosted-runner';

// Egress allowlist — non-negotiable per agent-harness.md §6. Moonshot for the
// model call, Tavily for web search/fetch, GitHub for repo clone, Worker for
// MCP. Everything else denied by the absence of a wildcard.
const EGRESS_ALLOWLIST = [
  'api.moonshot.ai',
  'api.tavily.com',
  'api.github.com',
  'github.com',
  'codeload.github.com',
];

export async function provision(opts: {
  threadId: string;
  workspaceId: string;
  repos: string[];
  token?: string;
}): Promise<VmRun> {
  const { threadId, workspaceId, repos, token } = opts;
  const hosted = await issueHostedToken(threadId);

  // Close any open row whose heartbeat has lapsed BEFORE inserting the new one,
  // so the partial unique index `vm_runs(thread_id) WHERE ended_at IS NULL`
  // can't reject a fresh spawn on a corpse row. The reap is freshness-scoped in
  // @tempo/server — a live sibling's row stays open.
  await reapStaleVmRun(threadId);

  const vmRunId = newVmRunId();
  await db.insert(vm_runs).values({ id: vmRunId, thread_id: threadId });
  // The row's existence IS the "provisioning" phase (no sandbox_id yet). Push it
  // so the Console checklist lights up step 1 while the Sandbox boots.
  const startedAt = new Date().toISOString();
  await publishVmSignal(threadId, {
    sandbox_id: null,
    started_at: startedAt,
    phase: 'provisioning',
  });

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create({
      template: TEMPLATE_NAME,
      // SDK reads E2B_API_KEY from env automatically (@default per index.d.ts).
      timeoutMs: SANDBOX_INITIAL_TIMEOUT_MS,
      envs: {
        TEMPO_THREAD_ID: threadId,
        TEMPO_WORKSPACE_ID: workspaceId,
        TEMPO_HOSTED_TOKEN: hosted.token,
        TEMPO_SESSION_ID: hosted.session_id,
        // The Sandbox-side name is intentionally `WORKER_MCP_URL` (clarifies
        // what it's used for inside the runner) even though the Worker env
        // var is `WORKER_PUBLIC_URL`.
        WORKER_MCP_URL: env.WORKER_PUBLIC_URL,
        MOONSHOT_API_KEY: env.MOONSHOT_API_KEY,
        MOONSHOT_BASE_URL: env.MOONSHOT_BASE_URL,
        TAVILY_API_KEY: env.TAVILY_API_KEY,
        // Clone contract the runner (T6) reads: a JSON array of `owner/name`,
        // cloned into /workspace/<name>. Reaches here only with repos present.
        TEMPO_REPOS: JSON.stringify(repos),
        ...(token ? { GITHUB_APP_TOKEN: token } : {}),
      },
      network: {
        allowOut: [...EGRESS_ALLOWLIST, new URL(env.WORKER_PUBLIC_URL).hostname],
        // e2b v2.30 requires an explicit deny when allowOut is set. Callback
        // form is the documented canonical pattern (see e2b/internet-access).
        denyOut: ({ allTraffic }) => [allTraffic],
      },
      metadata: { tempo_thread_id: threadId, tempo_vm_run_id: vmRunId },
    });
  } catch (err) {
    // Surface the failure to the Console checklist as a `failed` frame (sanitized
    // — a Sandbox.create error can wrap a token-bearing clone URL) and close the
    // orphan row so a retry can spawn past the partial unique index.
    const reason = sanitizeCloneError(err instanceof Error ? err.message : String(err));
    await failVmRun(threadId, reason);
    throw err;
  }

  // Sandbox is up → phase advances to `cloning` (the runner clones next). Persist
  // sandbox_id first so the pushed frame and a late hydrate agree.
  await db.update(vm_runs).set({ sandbox_id: sandbox.sandboxId }).where(eq(vm_runs.id, vmRunId));
  await publishVmSignal(threadId, {
    sandbox_id: sandbox.sandboxId,
    started_at: startedAt,
    phase: 'cloning',
  });

  // background: true returns a handle, not a result — runner.js startup
  // errors are invisible here. Task 2.6 owns runner.js; surface boot
  // failures via the activity-events POST or a `/healthz` ping.
  //
  // timeoutMs override: the SDK's default RPC channel timeout is 60s, and
  // when that abort fires it SIGTERMs the detached child. Set to 24h so
  // the actual lifetime cap is the sandbox wallclock budget (managed by
  // the supervisor via sandbox.setTimeout on every NOTIFY-while-alive).
  const sandboxId = sandbox.sandboxId;
  await sandbox.commands.run('node /app/runner.js', {
    background: true,
    timeoutMs: 24 * 60 * 60 * 1000,
    onStdout: (d) => logger.info({ sandboxId, stream: 'runner.out' }, d.trimEnd()),
    // warn (not error) because many tools log info to stderr by convention
    // (npm, mcp servers, etc). Real crashes still surface as multi-line
    // stack traces — distinguishable from one-line startup banners.
    onStderr: (d) => logger.warn({ sandboxId, stream: 'runner.err' }, d.trimEnd()),
  });
  logger.info({ threadId, sandboxId, vmRunId }, 'vm: provisioned');

  return { sandbox, vm_run_id: vmRunId, session_id: hosted.session_id };
}
