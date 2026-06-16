/// <reference types="node" />
// Hosted runner — bundled to /app/runner.js and executed inside the E2B
// Sandbox at provision time. Drains Mailbox via REST, runs a streamText
// Turn per batch with Vercel AI SDK + native + MCP tools, forwards SDK
// step events to Worker's /api/agent-events. Exits after MAX_IDLE_MS of
// no activity; E2B's wallclock timeout is the safety net if this loop
// misbehaves.

import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { createAnthropic } from '@ai-sdk/anthropic';
import { buildAnthropicProvider, turnPath } from './helicone';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { stepCountIs, streamText, tool } from 'ai';
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import { HOSTED_SYSTEM_PROMPT } from './prompt-hosted';

const exec = promisify(execFile);

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
  anthropicKey: required('ANTHROPIC_API_KEY'),
  heliconeKey: process.env.HELICONE_API_KEY,
  modelId: process.env.HOSTED_AGENT_MODEL ?? 'claude-haiku-4-5-20251001',
  repoUrl: process.env.REPO_URL,
  ghToken: process.env.GITHUB_APP_TOKEN,
};

const POLL_IDLE_MS = 2_000;
// Match the supervisor's inactivity budget (apps/worker/src/hosted/supervisor.ts).
// Runner self-exits at this gap; supervisor reaps slightly later as backstop.
const MAX_IDLE_MS = 10 * 60 * 1000;
const MAX_STEPS_PER_TURN = 50;

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
    const res = await fetch(`${env.workerMcpUrl}/api/hosted/drain`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.hostedToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      console.error('runner: pollMailbox', res.status, await res.text());
      return [];
    }
    const json = (await res.json()) as { events?: unknown[] };
    return json.events ?? [];
  } catch (err) {
    console.error('runner: pollMailbox failed', err);
    return [];
  }
}

// Read-only environment inspection. Egress allowlist denies mutation
// surfaces; the sandbox is ephemeral. Tool-level guard is timeout + cap.
const Bash = tool({
  description:
    'Run a bash command inside /workspace. 30s default timeout, 1MB output cap. Read-only by convention — the Plan is the only writeable output.',
  inputSchema: z.object({
    command: z.string(),
    timeout_ms: z.number().int().min(1).max(60_000).default(30_000),
  }),
  execute: async ({ command, timeout_ms }) => {
    try {
      const { stdout, stderr } = await exec('bash', ['-lc', command], {
        cwd: '/workspace',
        timeout: timeout_ms,
        maxBuffer: 1_000_000,
      });
      return { stdout, stderr, exit_code: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message,
        exit_code: typeof e.code === 'number' ? e.code : 1,
      };
    }
  },
});

const Grep = tool({
  description:
    'Recursive content search via ripgrep. Pattern is a regex. Returns up to 1MB of matches.',
  inputSchema: z.object({
    pattern: z.string(),
    path: z.string().default('/workspace'),
    glob: z.string().optional().describe('Glob filter, e.g. "**/*.ts"'),
  }),
  execute: async ({ pattern, path, glob }) => {
    const args = ['-n', '--no-heading', '--color=never'];
    if (glob) args.push('-g', glob);
    args.push(pattern, path);
    try {
      const { stdout } = await exec('rg', args, { maxBuffer: 1_000_000 });
      return { matches: stdout };
    } catch (err) {
      const e = err as { stdout?: string; code?: number };
      // rg exits 1 when no matches — surface as empty rather than error.
      return { matches: e.stdout ?? '', exit_code: e.code };
    }
  },
});

async function maybeCloneRepo(): Promise<void> {
  // /workspace is pre-created in the template (owned by `user`), so the
  // no-repo path is a no-op — the MCP filesystem server and Bash both
  // happily target an empty dir.
  if (!env.repoUrl || !env.ghToken) return;
  const authedUrl = env.repoUrl.replace(
    'https://',
    `https://x-access-token:${env.ghToken}@`,
  );
  execSync(`git clone --depth 1 --filter=blob:none ${authedUrl} /workspace`, {
    stdio: 'pipe',
  });
  execSync(`git -C /workspace remote set-url origin ${env.repoUrl}`, {
    stdio: 'pipe',
  });
}

type SafeMCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

async function buildToolset(
  anthropic: ReturnType<typeof createAnthropic>,
): Promise<{
  tools: Record<string, unknown>;
  close: () => Promise<void>;
}> {
  const fs: SafeMCPClient = await experimental_createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    }),
  });

  // Use the MCP SDK's matched client transport directly — the AI SDK's own
  // 'http' transport reimplements the protocol and was 404-ing on the
  // session-id roundtrip. Canonical pairing: @modelcontextprotocol/sdk
  // server + @modelcontextprotocol/sdk client = no impedance mismatch.
  const tempo: SafeMCPClient = await experimental_createMCPClient({
    transport: new StreamableHTTPClientTransport(new URL(`${env.workerMcpUrl}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${env.hostedToken}` },
      },
    }),
  });

  const fsTools = await fs.tools();
  const tempoTools = await tempo.tools();
  // Web search + web fetch — Anthropic-hosted server tools. Version picked
  // by model capability:
  //   Sonnet 4.6+ / Opus 4.6+ → 20260209 versions with *dynamic filtering*
  //     (Claude writes code to filter results, cutting tokens). Per
  //     platform.claude.com/docs/.../web-search-tool and .../web-fetch-tool
  //     these are the only models supported by the new versions.
  //   Everything else (Haiku) → previous 20250305 / 20250910 versions, no
  //     dynamic filtering but broad model support.
  const dynamicFilteringModels =
    env.modelId.startsWith('claude-sonnet-') || env.modelId.startsWith('claude-opus-');
  const webSearch = dynamicFilteringModels
    ? anthropic.tools.webSearch_20260209({ maxUses: 5 })
    : anthropic.tools.webSearch_20250305({ maxUses: 5 });
  const webFetch = dynamicFilteringModels
    ? anthropic.tools.webFetch_20260209({ maxUses: 5 })
    : anthropic.tools.webFetch_20250910({ maxUses: 5 });

  return {
    tools: { ...fsTools, ...tempoTools, Bash, Grep, webSearch, webFetch },
    close: async () => {
      await fs.close().catch(() => {});
      await tempo.close().catch(() => {});
    },
  };
}

const history: ModelMessage[] = [];

async function runTurn(
  batch: unknown[],
  tools: Record<string, unknown>,
  anthropic: ReturnType<typeof createAnthropic>,
): Promise<void> {
  const startedAt = Date.now();
  const userMessage = JSON.stringify({ thread_id: env.threadId, batch });
  history.push({ role: 'user', content: userMessage });

  const result = streamText({
    model: anthropic(env.modelId),
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    stopWhen: stepCountIs(MAX_STEPS_PER_TURN),
    system: HOSTED_SYSTEM_PROMPT,
    messages: history,
    // Anthropic ephemeral prompt cache: 5-min TTL on system prompt + tool
    // defs (the static, big chunk). First step of a Turn writes the cache
    // (~25% premium), every subsequent step inside the Turn AND any Turn
    // that fires within 5 min reads it (~10% of normal). Big net win for
    // multi-step Turns and back-and-forth sessions.
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    onStepFinish: async ({ text, toolCalls, reasoning }) => {
      // Reasoning (Anthropic extended-thinking) is captured here too —
      // emitted under agent_narration for now. Follow-up: introduce
      // dedicated agent_thinking event kind via judge gate.
      const reasoningText = Array.isArray(reasoning)
        ? reasoning.map((r) => (r as { text?: string }).text ?? '').join('')
        : '';
      if (reasoningText) {
        await postAgentEvent({
          kind: 'agent_narration',
          text: `[thinking] ${reasoningText}`,
        });
      }
      if (text) {
        await postAgentEvent({ kind: 'agent_narration', text });
      }
      for (const c of toolCalls) {
        const summary = JSON.stringify((c as { input?: unknown }).input ?? {}).slice(0, 200);
        await postAgentEvent({
          kind: 'agent_tool_use',
          tool: (c as { toolName: string }).toolName,
          summary,
        });
      }
    },
  });

  // Drain the stream; result.response resolves with assistant + tool
  // messages we append to history for the next Turn.
  await result.consumeStream();
  const response = await result.response;
  history.push(...response.messages);

  // Token / cost line. stdout → onStdout → worker INFO log. Cost numbers
  // are Anthropic's published Haiku 4.5 rates ($1/$5 per MTok) and won't
  // be right if HOSTED_AGENT_MODEL is overridden — switch to a model
  // factory once we add a second provider.
  const u = await result.totalUsage;
  const ms = Date.now() - startedAt;
  const cost =
    ((u.inputTokens ?? 0) * 1 + (u.outputTokens ?? 0) * 5) / 1_000_000;
  console.log(
    `[usage] model=${env.modelId} in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` +
      ` cacheR=${u.inputTokenDetails.cacheReadTokens ?? 0} cacheW=${u.inputTokenDetails.cacheWriteTokens ?? 0}` +
      ` cost~=$${cost.toFixed(4)} elapsedMs=${ms}`,
  );

  await postAgentEvent({ kind: 'agent_turn_ended' });
}

async function main(): Promise<void> {
  try {
    await maybeCloneRepo();
  } catch (err) {
    await postAgentEvent({ kind: 'session_failed', reason: 'repo_clone_failed' });
    throw err;
  }

  // Initial provider (path: /init) — only used for buildToolset, which reads
  // tool definitions and doesn't actually make a request. Every Turn rebuilds
  // its own provider with a fresh `/turn/<n>` path so Helicone groups the
  // Turn's requests into their own sub-trace.
  if (env.heliconeKey) console.log('runner: routing Anthropic via Helicone');
  const initialAnthropic = buildAnthropicProvider({
    anthropicKey: env.anthropicKey,
    heliconeKey: env.heliconeKey,
    threadId: env.threadId,
    workspaceId: env.workspaceId,
    sessionPath: '/init',
  });
  const toolset = await buildToolset(initialAnthropic);

  let lastActivity = Date.now();
  let turnCounter = 0;
  try {
    while (Date.now() - lastActivity < MAX_IDLE_MS) {
      const batch = await pollMailbox();
      if (batch.length > 0) {
        turnCounter += 1;
        const turnAnthropic = buildAnthropicProvider({
          anthropicKey: env.anthropicKey,
          heliconeKey: env.heliconeKey,
          threadId: env.threadId,
          workspaceId: env.workspaceId,
          sessionPath: turnPath(turnCounter),
        });
        await runTurn(batch, toolset.tools, turnAnthropic);
        lastActivity = Date.now();
        continue;
      }
      await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
    }
  } finally {
    await toolset.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('runner: fatal', err);
  process.exit(1);
});
