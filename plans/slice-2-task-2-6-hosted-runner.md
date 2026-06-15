# Task 2.6 + 2.6b — Hosted runner inside the Sandbox (Slice 2) — v2

(Revised after judge CHANGES REQUESTED on v1: agent-events handler must
accept `hosted`; ANTHROPIC_API_KEY plumbing; SDK options must include
`cwd`+`systemPrompt`+`tools`; Turn continuity via `resume`; bootstrap
section of system prompt needs Hosted-flavored adaptation; in-Turn vs
between-Turn drain race; clone token strip; tempo_poll_hosted sketch
uses the closure caller, not `getCaller()`.)

## Problem

Same as v1 — bring a runner up inside the E2B sandbox that polls
Mailbox, runs Claude Agent SDK Turns, and forwards activity events to
Worker.

## The change

### 1. Widen `agentEventsHandler` to accept Hosted

`apps/worker/src/routes/agent-events/index.ts:14` currently rejects
`req.caller.kind !== 'cli'`. Hosted needs to POST activity events too
(Task 2.6b is the activity-stream wiring). One-line change:

```ts
if (req.caller.kind !== 'cli' && req.caller.kind !== 'hosted') {
  res.status(403).json({ error: 'forbidden' });
  return;
}
```

`authorizeThread` already handles `hosted` (Task 2.4).

### 2. Plumb `ANTHROPIC_API_KEY` (extends Task 2.5)

The SDK can't make calls without it. Add to `apps/worker/src/env.ts`:

```ts
ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
```

Add to `provision.ts` `envs:` block:

```ts
ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
```

Add to `.env.example`.

### 3. `tempo_poll_hosted` MCP tool

Drains Mailbox; no long-poll. Uses the existing closure-captured
`caller` (mirroring `attach.ts`), not an invented `getCaller()`.

```ts
// apps/worker/src/mcp/tools/poll-hosted.ts
import { drainPending } from '@tempo/server';
import type { Caller } from '../../auth';

export function registerPollHosted(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  caller: Caller,
): void {
  server.tool(
    'tempo_poll_hosted',
    'Hosted-only: drain pending Mailbox events for this Session. Returns immediately. Empty events array means no work pending.',
    {},
    async () => {
      if (caller.kind !== 'hosted') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'hosted_only' }) }],
        };
      }
      const events = await drainPending(caller.threadId);
      return { content: [{ type: 'text', text: JSON.stringify({ events }) }] };
    },
  );
}
```

Register in `apps/worker/src/mcp/server.ts` after `registerLoadSkill`.

### 4. `runner.ts` — the inside-Sandbox script

Critical wiring fixed vs v1: `cwd`, `systemPrompt`, `tools` are explicit
on the SDK `query`; conversation continuity via `resume`; in-Turn vs
between-Turn drain is guarded by a flag.

```ts
// apps/worker/src/hosted/runner.ts (bundled to /app/runner.js)
import { execSync } from 'node:child_process';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { HOSTED_BOOTSTRAP_PROMPT } from './prompt-hosted';

const env = {
  threadId: process.env.TEMPO_THREAD_ID!,
  workspaceId: process.env.TEMPO_WORKSPACE_ID!,
  hostedToken: process.env.TEMPO_HOSTED_TOKEN!,
  workerMcpUrl: process.env.WORKER_MCP_URL!,
  repoUrl: process.env.REPO_URL,
  ghToken: process.env.GITHUB_APP_TOKEN,
  sessionId: process.env.TEMPO_SESSION_ID!,
};

const POLL_IDLE_MS = 5_000;
const MAX_IDLE_MS = 10 * 60 * 1000;
let resumeId: string | undefined;
let turnInFlight = false;

async function postAgentEvent(payload: unknown): Promise<void> {
  await fetch(`${env.workerMcpUrl}/api/agent-events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.hostedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function pollMailbox(): Promise<unknown[]> {
  const res = await fetch(`${env.workerMcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.hostedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'tempo_poll_hosted', arguments: {} },
    }),
  });
  const json = (await res.json()) as { result?: { content?: Array<{ text: string }> } };
  const text = json.result?.content?.[0]?.text ?? '{"events":[]}';
  return (JSON.parse(text) as { events: unknown[] }).events;
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
        tools: { type: 'preset', preset: 'claude_code' },
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
      if (!resumeId && (msg as { type?: string; session_id?: string }).type === 'system') {
        resumeId = (msg as { session_id?: string }).session_id;
      }
      const evt = sdkMessageToAgentEvent(msg);
      if (evt) await postAgentEvent({ thread_id: env.threadId, event: evt });
    }
  } finally {
    turnInFlight = false;
  }
}

function sdkMessageToAgentEvent(_msg: SDKMessage): unknown | null {
  // TODO(2.6b): map SDK message → AgentEventRequest shape per
  // packages/contracts/src/events.ts. First pass: only forward `text`
  // and `tool_use` events; expand once Console activity feed is exercised.
  return null;
}

async function main(): Promise<void> {
  if (env.repoUrl && env.ghToken) {
    const authedUrl = env.repoUrl.replace(
      'https://',
      `https://x-access-token:${env.ghToken}@`,
    );
    execSync(`git clone --depth 1 --filter=blob:none ${authedUrl} /workspace`, {
      stdio: 'pipe',  // capture stderr to avoid leaking auth URL on git errors
    });
    // Strip the embedded token from .git/config so subsequent operations
    // don't carry it in plain text. Push is disallowed by egress anyway.
    execSync(`git -C /workspace remote set-url origin ${env.repoUrl}`, { stdio: 'pipe' });
  }

  let lastActivity = Date.now();
  while (Date.now() - lastActivity < MAX_IDLE_MS) {
    // Drain only when no Turn is in flight — the SDK loop can also call
    // tempo_poll_hosted mid-Turn; double-drain would lose events.
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
```

### 5. `HOSTED_BOOTSTRAP_PROMPT` — Hosted-adapted bootstrap

The Local `ATTACH_SYSTEM_PROMPT` opens with a Local-CLI-specific
"thread_id arrives in `--print`" line. Hosted needs different bootstrap
framing. For first pass, we lift only the Tempo behavioral guidance
(identity, exploration, reply tone, plan structure, etc.) and replace
the bootstrap section. The constant lives next to the runner.

```ts
// apps/worker/src/hosted/prompt-hosted.ts
export const HOSTED_BOOTSTRAP_PROMPT = `# Tempo Hosted Agent — appended instructions

## Bootstrap

You are running inside an ephemeral Sandbox. The Thread you are bound
to is in the TEMPO_THREAD_ID environment variable. Your FIRST action
MUST be: \`tempo_attach({ thread_id: process.env.TEMPO_THREAD_ID })\`.
Do not read files or call other tools before tempo_attach succeeds.

After attach, drain pending events using \`tempo_poll_hosted\` (returns
the Dev events that woke this Session). React to those events as the
Tempo behavioral guidance below describes.

${/* rest of ATTACH_SYSTEM_PROMPT — Identity, Repo exploration, Reply
   tone, Plan structure, etc. — copied verbatim from
   apps/agent/src/turn.ts. Lift to a shared package if a third emitter
   appears. */ ''}
`;
```

(Implementer copies the rest from `apps/agent/src/turn.ts`'s
`ATTACH_SYSTEM_PROMPT` constant.)

### 6. `e2b.toml` + Dockerfile.hosted + bundler

```toml
# apps/worker/e2b/e2b.toml
template_name = "tempo-hosted-runner"
dockerfile = "Dockerfile.hosted"
start_cmd = "/bin/sh"
```

```Dockerfile
# apps/worker/e2b/Dockerfile.hosted
FROM node:22-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
COPY hosted-runner.js /app/runner.js
WORKDIR /app
```

```ts
// apps/worker/scripts/build-hosted-runner.ts
import { $ } from 'bun';
await $`bun build --target=node --bundle src/hosted/runner.ts --outfile e2b/hosted-runner.js`;
console.log('hosted runner bundled at apps/worker/e2b/hosted-runner.js');
```

Add `"build:hosted-runner": "bun run scripts/build-hosted-runner.ts"`
to `apps/worker/package.json`.

## Deliberate simplifications (algorithm + ponytail)

- **No long-poll inside `tempo_poll_hosted`.** Runner's 5s sleep is
  the wake; tool just drains.
- **`sdkMessageToAgentEvent` is a TODO stub** — first pass returns
  null. Activity-feed wiring is iterative: once we see the SDK message
  shapes against the contract, we map case-by-case.
- **Two near-identical system prompts** (Local CLI + Hosted) accepted
  for MVP. Lift to a shared package when a third emitter appears.
- **No graceful SIGTERM.** Sandbox dies hard; runner is fine.
- **No retry on `pollMailbox` failures.** Next 5s tick catches up.
- **`turnInFlight` is a single boolean.** No Map per Thread — the
  runner serves exactly one Thread.

## Alternatives considered

1. **Long-poll inside `tempo_poll_hosted` via `subscribeWakeups`.**
   Subscribes per call; complicated; rejected.
2. **Bake runner as tarball uploaded at provision.** Slower per-Session
   start; template path is standard.
3. **Use `@e2b/code-interpreter`.** Adds Python kernel surface we don't
   need.

## Uncertainties

- **SDK system-prompt session_id capture.** The plan reads
  `msg.session_id` off the first system message. SDK docs imply that
  shape; implementer to verify on first run.
- **`sdkMessageToAgentEvent` implementation.** Stub for first pass.
  Will be iterated in a follow-up commit once we exercise the activity
  feed end-to-end.

## Layer assignment

- `apps/worker/src/hosted/runner.ts` — inside-VM entrypoint.
- `apps/worker/src/hosted/prompt-hosted.ts` — system prompt constant.
- `apps/worker/src/mcp/tools/poll-hosted.ts` — new MCP tool.
- `apps/worker/src/mcp/server.ts` — register the new tool.
- `apps/worker/src/routes/agent-events/index.ts` — accept Hosted.
- `apps/worker/src/vm/provision.ts` — add ANTHROPIC_API_KEY env.
- `apps/worker/src/env.ts` — add ANTHROPIC_API_KEY.
- `apps/worker/.env.example` — document.
- `apps/worker/e2b/e2b.toml`, `apps/worker/e2b/Dockerfile.hosted` —
  E2B template.
- `apps/worker/scripts/build-hosted-runner.ts` — bundler.

## Deletion test

All earn their keep. Stub `sdkMessageToAgentEvent` is the only thing
in this slice that doesn't fully exist yet; it's a named TODO with a
forward-link, not dead code.

## Execution

```bash
bun run typecheck
bun run lint
bun run --filter @tempo/worker build:hosted-runner
# Template build (deployment-time, not CI-time):
# cd apps/worker/e2b && e2b template build
```

## Acceptance

- typecheck + lint clean.
- code-simplifier + code-reviewer pass.
- Bundle script produces `apps/worker/e2b/hosted-runner.js`.

## Forward-links

- Task 2.7 (supervisor) is the sole caller of provision.
- `sdkMessageToAgentEvent` implementation is a follow-up commit in
  this same slice (Task 2.6b iteration once first Sandbox boot succeeds).
