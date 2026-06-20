/// <reference types="node" />
// Hosted runner — bundled to /app/runner.js and executed inside the E2B
// Sandbox at provision time. Hydrates Turn 1 via GET /api/threads/:id/access,
// then subscribes to the Worker's Redis-backed SSE stream for subsequent
// wake events. Each turn runs streamText with an AbortController; a wake
// event arriving mid-turn aborts the current call, pushes completed-step
// messages to history, then immediately starts a new turn with the buffered
// wake events. Exits after MAX_IDLE_MS of no activity.

import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { createAnthropic } from '@ai-sdk/anthropic';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Event as TempoEvent } from '@tempo/contracts/events';
import { TEMPO_AGENT_SYSTEM_PROMPT } from '@tempo/contracts/agent-prompt';
import type { TurnHydration } from '@tempo/contracts/http';
import type { ModelMessage } from 'ai';
import { stepCountIs, streamText, tool } from 'ai';
import pino from 'pino';
import { z } from 'zod';
import { type RepoEntry, hasRepoLinked, parseRepos } from './clone';
import { runWakeSubscriber } from './event-source';
import { buildAnthropicProvider, turnPath } from './helicone';

// Sandbox-local logger. Worker captures stdout/stderr per line via E2B's
// onStdout/onStderr hooks (see vm/provision.ts) — pino's JSON lines flow
// through that pipe and get re-wrapped as Worker INFO/WARN.
const logger = pino({ level: process.env.HOSTED_LOG_LEVEL ?? 'info' });

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
  // Multi-repo: TEMPO_REPOS is a JSON array of "owner/name" strings.
  // GITHUB_APP_TOKEN is the ephemeral install token minted by provision.
  tempoRepos: process.env.TEMPO_REPOS,
  ghToken: process.env.GITHUB_APP_TOKEN,
};

// Match the supervisor's inactivity budget (apps/worker/src/hosted/supervisor.ts).
// Runner self-exits at this gap; supervisor reaps slightly later as backstop.
const MAX_IDLE_MS = 10 * 60 * 1000;
const MAX_STEPS_PER_TURN = 50;

async function postAgentEvent(event: unknown): Promise<void> {
  const res = await fetch(`${env.workerMcpUrl}/api/agent-events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.hostedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ thread_id: env.threadId, event }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`agent-event POST ${res.status}: ${body}`);
  }
}

// Turn-1 bootstrap — the SAME /access endpoint the local CLI uses. Returns the
// full snapshot (`context`) + wake events since the last turn (catch-up for a
// freshly-spawned runner). Subsequent turns arrive via the SSE stream.
async function hydrate(): Promise<{ events: unknown[]; context: TurnHydration } | null> {
  try {
    const res = await fetch(`${env.workerMcpUrl}/api/threads/${env.threadId}/access`, {
      headers: { Authorization: `Bearer ${env.hostedToken}` },
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, 'runner: hydrate');
      return null;
    }
    const json = (await res.json()) as { events: unknown[]; context: TurnHydration };
    return { events: json.events ?? [], context: json.context };
  } catch (err) {
    logger.error({ err }, 'runner: hydrate failed');
    return null;
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

async function cloneRepos(): Promise<void> {
  // /workspace is pre-created in the template (owned by `user`). An empty
  // repos list is a no-op — the MCP filesystem server and Bash both happily
  // target an empty dir; the conversation runs without code access.
  const repos = parseRepos(env.tempoRepos, env.ghToken);
  for (const repo of repos) {
    // Shallow blobless clone keeps the initial fetch fast inside the sandbox.
    execSync(`git clone --depth 1 --filter=blob:none ${repo.cloneUrl} ${repo.dir}`, {
      stdio: 'pipe',
    });
    // Scrub the ephemeral token from the remote so it doesn't linger in
    // `git remote -v` output or git's credential store.
    execSync(
      `git -C ${repo.dir} remote set-url origin https://github.com/${repo.owner}/${repo.name}.git`,
      { stdio: 'pipe' },
    );
    logger.info({ repo: `${repo.owner}/${repo.name}`, dir: repo.dir }, 'runner: cloned');
  }
}

type SafeMCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

async function buildToolset(anthropic: ReturnType<typeof createAnthropic>): Promise<{
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

type TurnInput = {
  events: unknown[];
  context?: TurnHydration | null;
};

// Runs one streamText turn. A wake event mid-turn aborts it; onAbort preserves
// completed-step history either way.
async function runTurn(
  input: TurnInput,
  tools: Record<string, unknown>,
  anthropic: ReturnType<typeof createAnthropic>,
  // abortController is created per turn by the main loop and shared with the
  // SSE listener — the listener calls controller.abort() on a wake event.
  abortController: AbortController,
): Promise<void> {
  const startedAt = Date.now();
  // context is set by the server on Turn 1 only; absent on Turn 2+ so the
  // agent reads state from its own message history + events deltas instead.
  const userMessage = JSON.stringify({
    thread_id: env.threadId,
    events: input.events,
    context: input.context ?? undefined,
  });
  history.push({ role: 'user', content: userMessage });

  const signal = abortController.signal;

  const result = streamText({
    model: anthropic(env.modelId),
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    stopWhen: stepCountIs(MAX_STEPS_PER_TURN),
    system: TEMPO_AGENT_SYSTEM_PROMPT,
    messages: history,
    // Per-step decision point. No-op today (every tool allowed).
    prepareStep: async () => ({}),
    // Anthropic ephemeral prompt cache: 5-min TTL on system prompt + tool
    // defs (the static, big chunk). First step of a Turn writes the cache
    // (~25% premium), every subsequent step inside the Turn AND any Turn
    // that fires within 5 min reads it (~10% of normal). Big net win for
    // multi-step Turns and back-and-forth sessions.
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    abortSignal: signal,
    onAbort: ({ steps }) => {
      // Only fully-completed steps are available here; the in-progress step's
      // messages are lost (the SDK doesn't surface them on abort). The next
      // turn continues from the completed steps + the new wake event — fine for
      // read-only tools, which are safe to re-issue.
      history.push(...steps.flatMap((s) => s.response.messages as ModelMessage[]));
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

  // consumeStream() resolves cleanly whether the turn completes normally or
  // is aborted — the stream just closes. Do not await result.response or
  // result.steps after an abort: they reject when zero steps completed.
  await result.consumeStream();

  if (signal.aborted) {
    // onAbort already pushed completed-step messages. Still emit turn-ended so
    // the Console closes the activity indicator — a new turn starts right after.
    await postAgentEvent({ kind: 'agent_turn_ended' });
    return;
  }

  // Normal completion — push the full response messages to history.
  const response = await result.response;
  history.push(...response.messages);

  // Token / cost line. stdout → onStdout → worker INFO log. Cost numbers
  // are Anthropic's published Haiku 4.5 rates ($1/$5 per MTok) and won't
  // be right if HOSTED_AGENT_MODEL is overridden — switch to a model
  // factory once we add a second provider.
  const u = await result.totalUsage;
  const ms = Date.now() - startedAt;
  const cost = ((u.inputTokens ?? 0) * 1 + (u.outputTokens ?? 0) * 5) / 1_000_000;
  logger.info(
    {
      model: env.modelId,
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      cacheReadTokens: u.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: u.inputTokenDetails.cacheWriteTokens ?? 0,
      cost: Number(cost.toFixed(4)),
      elapsedMs: ms,
    },
    'runner: usage',
  );

  await postAgentEvent({ kind: 'agent_turn_ended' });
}

async function main(): Promise<void> {
  try {
    await cloneRepos();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, threadId: env.threadId }, 'runner: repo_clone_failed');
    await postAgentEvent({ kind: 'vm_progress', step: 'failed', reason }).catch(() => {});
    process.exit(1);
  }

  await postAgentEvent({ kind: 'vm_progress', step: 'repos_cloned' });

  // Initial provider (path: /init) — only used for buildToolset, which reads
  // tool definitions and doesn't actually make a request. Every Turn rebuilds
  // its own provider with a fresh `/turn/<n>` path so Helicone groups the
  // Turn's requests into their own sub-trace.
  if (env.heliconeKey) logger.info('runner: routing Anthropic via Helicone');
  const initialAnthropic = buildAnthropicProvider({
    anthropicKey: env.anthropicKey,
    heliconeKey: env.heliconeKey,
    threadId: env.threadId,
    workspaceId: env.workspaceId,
    sessionPath: '/init',
  });
  const toolset = await buildToolset(initialAnthropic);

  // One AbortController for the whole SSE connection lifetime. Aborted when the
  // runner exits so the open fetch is cleaned up.
  const sseController = new AbortController();

  // A wake that interrupts a turn (or arrives while idle) is buffered here and
  // becomes the next turn's user message.
  const bufferedWakeEvents: TempoEvent[] = [];

  // The current turn's abort controller, replaced each turn. A wake aborts it
  // to interrupt the turn; aborting a settled one (between turns) is a no-op, so
  // there's no null to handle. Plus a resolver to wake the idle loop.
  let turnController = new AbortController();
  let wakeNotify: (() => void) | null = null;
  const notify = (): void => {
    const resolve = wakeNotify;
    wakeNotify = null;
    resolve?.();
  };

  // ONE consumer of the SSE feed for the runner's lifetime. It IS the interrupt
  // mechanism: a wake aborts the running turn (the loop re-prompts with it) or
  // wakes the idle loop. Same shape as the local CLI's connect loop.
  const consume = runWakeSubscriber({
    workerUrl: env.workerMcpUrl,
    threadId: env.threadId,
    token: env.hostedToken,
    signal: sseController.signal,
    onWake: (ev) => {
      bufferedWakeEvents.push(ev);
      // Both no-ops in the off case: abort() does nothing on a settled
      // controller (between turns); notify() does nothing mid-turn (no waiter).
      turnController.abort();
      notify();
    },
  });

  let turnCounter = 0;
  let lastActivity = Date.now();

  const runTurnOnce = async (input: TurnInput): Promise<void> => {
    turnCounter += 1;
    turnController = new AbortController();
    const turnAnthropic = buildAnthropicProvider({
      anthropicKey: env.anthropicKey,
      heliconeKey: env.heliconeKey,
      threadId: env.threadId,
      workspaceId: env.workspaceId,
      sessionPath: turnPath(turnCounter),
    });
    await runTurn(input, toolset.tools, turnAnthropic, turnController);
    lastActivity = Date.now();
  };

  try {
    // Turn 1: hydrate via /access (full snapshot + catch-up wake events).
    const first = await hydrate();
    if (!first) {
      logger.warn('runner: turn-1 hydrate failed; exiting');
      return;
    }

    // Check for a repo_linked in the Turn-1 catch-up events BEFORE running any
    // turn. A repo was attached while this sandbox was booting; its env is
    // immutable, so self-exit so the next wake re-provisions with the full list.
    if (hasRepoLinked(first.events as TempoEvent[])) {
      logger.info('runner: repo_linked in turn-1 catch-up; self-exiting for re-provision');
      return;
    }

    await postAgentEvent({ kind: 'vm_progress', step: 'agent_started' });
    await runTurnOnce(first);

    // Subsequent turns: process buffered wakes; self-exit after MAX_IDLE_MS idle.
    while (true) {
      if (bufferedWakeEvents.length === 0) {
        const idleRemaining = MAX_IDLE_MS - (Date.now() - lastActivity);
        if (idleRemaining <= 0) break;
        await new Promise<void>((resolve) => {
          if (bufferedWakeEvents.length > 0) {
            resolve();
            return;
          }
          const timer = setTimeout(resolve, idleRemaining);
          wakeNotify = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wakeNotify = null;
        if (bufferedWakeEvents.length === 0) continue; // idle timeout — re-check deadline
      }

      // A repo_linked in the buffered events means the Dev attached a new repo
      // while this VM was live. Env is immutable — self-exit cleanly so the
      // next wake provisions a fresh sandbox with the complete repo list.
      if (hasRepoLinked(bufferedWakeEvents)) {
        logger.info('runner: repo_linked received; self-exiting for re-provision');
        return;
      }

      await runTurnOnce({ events: bufferedWakeEvents.splice(0) });
    }
  } finally {
    sseController.abort();
    await consume.catch(() => {}); // let the SSE consumer unwind cleanly
    await toolset.close();
  }
  process.exit(0);
}

main().catch(async (err) => {
  logger.error({ err }, 'runner: fatal');
  const reason = err instanceof Error ? err.message : String(err);
  // Best-effort: if the Worker is reachable, surface the failure in the UI.
  await postAgentEvent({ kind: 'vm_progress', step: 'failed', reason }).catch(() => {});
  process.exit(1);
});
