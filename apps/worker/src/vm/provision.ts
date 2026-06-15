import { db } from '@tempo/db/client';
import { vm_runs } from '@tempo/db/schema';
import { newVmRunId } from '@tempo/server';
import { eq, sql } from 'drizzle-orm';
import { Sandbox } from 'e2b';
import { env } from '../env';
import { logger } from '../logger';
import { issueHostedToken } from '../server/cli-auth';

export type VmRun = {
  sandbox: Sandbox;
  vm_run_id: string;
  session_id: string;
};

// e2b's timeoutMs is a wallclock hard-kill from create — NOT idle. Task 2.7
// calls sandbox.setTimeout(...) between Turns to extend the budget on
// activity. 10 min covers one complex Turn with buffer.
const SANDBOX_INITIAL_TIMEOUT_MS = 10 * 60 * 1000;
const TEMPLATE_NAME = 'tempo-hosted-runner';

// Egress allowlist — non-negotiable per agent-harness.md §6. Anthropic for
// the SDK call, GitHub for repo clone, Worker for MCP. Everything else
// denied by the absence of a wildcard.
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

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create({
      template: TEMPLATE_NAME,
      apiKey: env.E2B_API_KEY,
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
        ...(repoUrl ? { REPO_URL: repoUrl } : {}),
        ...(ghToken ? { GITHUB_APP_TOKEN: ghToken } : {}),
      },
      network: {
        allowOut: [...EGRESS_ALLOWLIST, new URL(env.WORKER_PUBLIC_URL).hostname],
      },
      metadata: { tempo_thread_id: threadId, tempo_vm_run_id: vmRunId },
    });
  } catch (err) {
    // Close the orphan row so cost / open-runs queries don't accumulate it.
    await db
      .update(vm_runs)
      .set({ ended_at: sql`now()`, exit_reason: 'provision_failed' })
      .where(eq(vm_runs.id, vmRunId));
    throw err;
  }

  await db.update(vm_runs).set({ sandbox_id: sandbox.sandboxId }).where(eq(vm_runs.id, vmRunId));

  // background: true returns a handle, not a result — runner.js startup
  // errors are invisible here. Task 2.6 owns runner.js; surface boot
  // failures via the activity-events POST or a `/healthz` ping.
  await sandbox.commands.run('node /app/runner.js', { background: true });
  logger.info({ threadId, sandboxId: sandbox.sandboxId, vmRunId }, 'vm: provisioned');

  return { sandbox, vm_run_id: vmRunId, session_id: hosted.session_id };
}
