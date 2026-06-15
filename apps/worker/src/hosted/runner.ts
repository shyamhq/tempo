/// <reference types="node" />
// Hosted runner — bundled to /app/runner.js and executed inside the E2B
// Sandbox at provision time. Drains Mailbox via tempo_poll_hosted, runs
// a Claude Agent SDK Turn per batch, forwards SDK messages to Worker's
// /api/agent-events. Exits after MAX_IDLE_MS of no activity; E2B's
// wallclock timeout is the safety net if this loop misbehaves.

import { execSync } from 'node:child_process';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { HOSTED_BOOTSTRAP_PROMPT } from './prompt-hosted';

// Fail loud at startup if a required env is missing — silently proceeding
// with empty strings would produce a confusing 401 / NaN cursor downstream.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`runner: missing required env ${name}`);
  return v;
}

const env = {
  threadId: required('TEMPO_THREAD_ID'),
  workspaceId: required('TEMPO_WORKSPACE_ID'),
  hostedToken: required('TEMPO_HOSTED_TOKEN'),
  workerMcpUrl: required('WORKER_MCP_URL'),
  sessionId: required('TEMPO_SESSION_ID'),
  repoUrl: process.env.REPO_URL,
  ghToken: process.env.GITHUB_APP_TOKEN,
};

const POLL_IDLE_MS = 5_000;
const MAX_IDLE_MS = 10 * 60 * 1000;

let resumeId: string | undefined;
let turnInFlight = false;

async function postAgentEvent(event: unknown): Promise<void> {
  try {
    const res = await fetch(`${env.workerMcpUrl}/api/agent-events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.hostedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ thread_id: env.threadId, event }),
    });
    if (!res.ok) {
      console.error('runner: agent-event POST', res.status, await res.text());
    }
  } catch (err) {
    console.error('runner: agent-event post failed', err);
  }
}

async function pollMailbox(): Promise<unknown[]> {
  try {
    const res = await fetch(`${env.workerMcpUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.hostedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tempo_poll_hosted', arguments: {} },
      }),
    });
    if (!res.ok) {
      console.error('runner: pollMailbox', res.status, await res.text());
      return [];
    }
    const json = (await res.json()) as {
      result?: { content?: Array<{ text: string }> };
    };
    const text = json.result?.content?.[0]?.text ?? '{"events":[]}';
    return (JSON.parse(text) as { events: unknown[] }).events;
  } catch (err) {
    console.error('runner: pollMailbox failed', err);
    return [];
  }
}

// First-pass mapper. SDK message variants aren't exported as discriminated
// types, so we cast through `unknown` to the shapes we read. Returns at most
// ONE event per call — assistant messages with mixed content (text + tool_use)
// surface only the first match; the rest are dropped on this pass. Iterate to
// per-block emission when the activity feed needs the full transcript.
function sdkMessageToAgentEvent(msg: SDKMessage): unknown | null {
  const m = msg as unknown as {
    type?: string;
    message?: { content?: unknown[] };
  };
  if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
    for (const block of m.message.content) {
      const b = block as { type?: string; name?: string; input?: unknown; text?: string };
      if (b.type === 'tool_use' && b.name) {
        // Schema requires `summary` (≤200 chars) — stringify+truncate inputs.
        const summary = JSON.stringify(b.input ?? {}).slice(0, 200);
        return { kind: 'agent_tool_use', tool: b.name, summary };
      }
      if (b.type === 'text' && b.text) {
        return { kind: 'agent_narration', text: b.text };
      }
    }
  }
  if (m.type === 'result') {
    return { kind: 'agent_turn_ended' };
  }
  return null;
}

async function runTurn(batch: unknown[]): Promise<void> {
  turnInFlight = true;
  try {
    const prompt = JSON.stringify({ thread_id: env.threadId, batch });
    for await (const msg of query({
      prompt,
      options: {
        cwd: '/workspace',
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: HOSTED_BOOTSTRAP_PROMPT,
        },
        mcpServers: {
          tempo: {
            type: 'http',
            url: `${env.workerMcpUrl}/mcp`,
            headers: { Authorization: `Bearer ${env.hostedToken}` },
          },
        },
        ...(resumeId ? { resume: resumeId } : {}),
      },
    })) {
      const m = msg as unknown as { type?: string; session_id?: string };
      if (!resumeId && m.type === 'system' && m.session_id) {
        resumeId = m.session_id;
      }
      const evt = sdkMessageToAgentEvent(msg);
      if (evt) await postAgentEvent(evt);
    }
  } finally {
    turnInFlight = false;
  }
}

async function maybeCloneRepo(): Promise<void> {
  if (!env.repoUrl || !env.ghToken) return;
  // Embed token in clone URL; stripped immediately after so /workspace/.git/config
  // doesn't keep it. Egress allowlist denies pushes anyway, but defense in depth.
  const authedUrl = env.repoUrl.replace('https://', `https://x-access-token:${env.ghToken}@`);
  execSync(`git clone --depth 1 --filter=blob:none ${authedUrl} /workspace`, {
    stdio: 'pipe', // capture; don't leak the URL via stderr on failure
  });
  execSync(`git -C /workspace remote set-url origin ${env.repoUrl}`, { stdio: 'pipe' });
}

async function main(): Promise<void> {
  try {
    await maybeCloneRepo();
  } catch (err) {
    await postAgentEvent({ kind: 'session_failed', reason: 'repo_clone_failed' });
    throw err;
  }
  let lastActivity = Date.now();
  while (Date.now() - lastActivity < MAX_IDLE_MS) {
    if (!turnInFlight) {
      const batch = await pollMailbox();
      if (batch.length > 0) {
        await runTurn(batch);
        lastActivity = Date.now();
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('runner: fatal', err);
  process.exit(1);
});
