// In-process conversation runtime — the no-VM half of the repo-gated Hosted
// Agent (docs/plans/hosted-conversation-before-vm.md, "Two runtimes"). A
// repo-less Hosted Thread has nothing to clone, so the Worker runs its planning
// turn IN-PROCESS instead of provisioning a Sandbox.
//
// This runtime is STATELESS and per-wake: each call rebuilds context from the
// persisted Discussion via getTurnHydration (no kept-alive RAM history), runs
// ONE streamText turn against a small toolset that calls @tempo/server fns
// directly (no MCP, no HTTP, no filesystem/Bash), emits agent events via
// appendEvent, and returns. It is the no-VM analog of one runner.ts turn:
//   - serialization: a Redis SET-NX-EX lock per thread (the in-process analog of
//     the supervisor's `spawning` Set) — one turn at a time, globally.
//   - coalescing: re-drain getEventsSinceLastTurn after each turn so events that
//     landed on ANY container during the turn are caught. The DB is the shared
//     source of truth, so cross-container events coalesce here.

import { TEMPO_AGENT_SYSTEM_PROMPT } from '@tempo/contracts/agent-prompt';
import type { Event as TempoEvent } from '@tempo/contracts/events';
import type { TurnHydration } from '@tempo/contracts/http';
import {
  AddBlocksInput,
  DeleteBlockInput,
  GithubListReposInput,
  PostDiscussionMessageInput,
  PullPlanInput,
  UpdateBlockInput,
  UpdatePlanInput,
} from '@tempo/contracts/mcp';
import {
  acquireTurnLock,
  addBlocks,
  appendEvent,
  assertConnectorEnabled,
  deleteBlock,
  getEventsSinceLastTurn,
  getPlanBlocks,
  getThread,
  getTurnHydration,
  githubListRepos,
  postMessage,
  releaseTurnLock,
  updateBlock,
  updatePlan,
} from '@tempo/server';
import { type ModelMessage, stepCountIs, streamText, type ToolSet, tool } from 'ai';
import { nanoid } from 'nanoid';
import { env } from '../env';
import { logger } from '../logger';
import { emitStepEvents, webToolsForModel } from './agent-tools';
import { buildAnthropicProvider, turnPath } from './helicone';

const log = logger.child({ module: 'conversation' });

// Mirror runner.ts: same default model, same per-turn step cap.
const MODEL_ID = process.env.HOSTED_AGENT_MODEL ?? 'claude-haiku-4-5-20251001';
const MAX_STEPS_PER_TURN = 50;

// Entry point for a repo-less Hosted wake. Acquires the per-thread turn lock,
// then re-drains the Discussion until no events remain — running one streamText
// turn per non-empty drain. Returns when the queue is empty (or the lock is
// held elsewhere). Never throws into the wake handler: a turn failure is logged
// and the lock released so the next wake can retry.
export async function runConversationTurn(threadId: string): Promise<void> {
  const nonce = nanoid();
  if (!(await acquireTurnLock(threadId, nonce))) {
    // Another container/turn already holds the lock; it will re-drain the events
    // that triggered this wake. No double reply.
    log.info({ threadId, event: 'conversation:lock_held' }, 'turn already running elsewhere');
    return;
  }

  try {
    const thread = await getThread(threadId);
    if (!thread) {
      log.warn({ threadId }, 'conversation: thread not found');
      return;
    }
    const tools = buildToolset(threadId, thread.workspace_id);

    let turnCounter = 0;
    // Coalescing re-drain loop: events that arrive (on any container) mid-turn
    // are visible in the DB after this turn ends, so we loop until empty.
    while (true) {
      const events = await getEventsSinceLastTurn(threadId);
      if (events.length === 0) break;

      const context = await getTurnHydration(threadId);
      turnCounter += 1;
      await runStreamTurn({
        threadId,
        workspaceId: thread.workspace_id,
        turnNumber: turnCounter,
        events,
        context,
        tools,
      });
    }
  } catch (err) {
    log.error({ err, threadId, event: 'conversation:failed' }, 'in-process turn failed');
  } finally {
    await releaseTurnLock(threadId, nonce).catch((err) =>
      log.warn({ err, threadId }, 'conversation: release lock failed'),
    );
  }
}

type StreamTurnInput = {
  threadId: string;
  workspaceId: string;
  turnNumber: number;
  events: TempoEvent[];
  context: TurnHydration | null;
  tools: ToolSet;
};

// One streamText turn. Same user-message shape and emission shapes as one
// runner.ts turn; the only differences are direct appendEvent (no /agent-events
// HTTP) and no AbortController (no mid-turn wake interrupt — a wake that lands
// during the turn is caught by the outer re-drain loop instead).
async function runStreamTurn(input: StreamTurnInput): Promise<void> {
  const startedAt = Date.now();
  // context is the Turn-1 snapshot; null on the coalescing re-drain turns, where
  // it's omitted from the JSON so the Agent reads state from the events deltas.
  const userMessage = JSON.stringify({
    thread_id: input.threadId,
    events: input.events,
    context: input.context ?? undefined,
  });
  const messages: ModelMessage[] = [{ role: 'user', content: userMessage }];

  const anthropic = buildAnthropicProvider({
    anthropicKey: env.ANTHROPIC_API_KEY,
    heliconeKey: env.HELICONE_API_KEY,
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    sessionPath: turnPath(input.turnNumber),
  });

  const result = streamText({
    model: anthropic(MODEL_ID),
    tools: { ...input.tools, ...webToolsForModel(anthropic, MODEL_ID) },
    stopWhen: stepCountIs(MAX_STEPS_PER_TURN),
    system: TEMPO_AGENT_SYSTEM_PROMPT,
    messages,
    // Anthropic ephemeral prompt cache on the static prefix (system + tool
    // defs). Per-wake turns within the 5-min TTL read the warm cache.
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    onStepFinish: (step) =>
      emitStepEvents(step, async (event) => {
        await appendEvent(input.threadId, event);
      }),
  });

  await result.consumeStream();

  const usage = await result.totalUsage;
  log.info(
    {
      threadId: input.threadId,
      model: MODEL_ID,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
      elapsedMs: Date.now() - startedAt,
      event: 'conversation:turn',
    },
    'in-process turn complete',
  );

  await appendEvent(input.threadId, { kind: 'agent_turn_ended' });
}

// --- Toolset --------------------------------------------------------------
// Thin tool() wrappers over @tempo/server fns — called in-process, no MCP/HTTP.
// Tool names + descriptions mirror the MCP tools (apps/worker/src/mcp/tools/**)
// so the shared system prompt's tool references resolve identically. Only what a
// repo-less planning conversation needs: post a Discussion message, read/write
// the Plan, and list GitHub repos to suggest attaching. No filesystem/Bash.
//
// The Agent is always the author: null author_user_id on postMessage, null
// updated_by_user_id on every Plan edit.
function buildToolset(threadId: string, workspaceId: string): ToolSet {
  const tempo_post_discussion_message = tool({
    description:
      'Post a Discussion Message to the Thread. Use for free-form prose replies to the Dev, or to post a batch of structured questions (questions array). The Dev sees question batches as a stepper card.',
    inputSchema: PostDiscussionMessageInput,
    execute: async (args) => {
      const message = await postMessage(threadId, null, args);
      return { message_id: message.id };
    },
  });

  const tempo_pull_plan = tool({
    description:
      'Fetch the current plan as a flat list of blocks with HTML content, keyed by opaque $-suffixed block IDs. Pull before each edit batch to get fresh block IDs.',
    inputSchema: PullPlanInput,
    execute: async () => getPlanBlocks(threadId),
  });

  const tempo_update_plan = tool({
    description:
      'First-time Plan write: the whole Plan as a single HTML document. Legal only when the Plan is empty; afterwards use the block-level tools so anchored Comments survive.',
    inputSchema: UpdatePlanInput,
    execute: async ({ html }) => updatePlan(threadId, html, null),
  });

  const tempo_add_blocks = tool({
    description:
      'Insert new blocks relative to an existing block (before/after) or at the document boundary (end). Returns $-suffixed IDs for the newly inserted blocks.',
    inputSchema: AddBlocksInput,
    execute: async ({ reference_id, position, blocks }) => {
      const result = await addBlocks(threadId, reference_id, position, blocks, null);
      return { ok: true, ids: result.ids };
    },
  });

  const tempo_update_block = tool({
    description:
      "Replace one block's content. The block id is preserved; surrounding blocks and their anchored Comments are untouched. Use $-suffixed IDs from tempo_pull_plan.",
    inputSchema: UpdateBlockInput,
    execute: async ({ block_id, html }) => {
      await updateBlock(threadId, block_id, html, null);
      return { ok: true };
    },
  });

  const tempo_delete_block = tool({
    description: 'Delete one block by its $-suffixed id.',
    inputSchema: DeleteBlockInput,
    execute: async ({ block_id }) => {
      await deleteBlock(threadId, block_id, null);
      return { ok: true };
    },
  });

  // Lets the Agent suggest repos for the Dev to attach. The allowlist gate runs
  // first (decision 5) so the in-process path can't bypass it.
  const tempo_github_list_repos = tool({
    description:
      'List the GitHub repositories this workspace can access, so you can suggest which one the Dev should attach to the Thread. You cannot attach a repo yourself — only the Dev can.',
    inputSchema: GithubListReposInput,
    execute: async () => {
      await assertConnectorEnabled(workspaceId, 'github');
      return githubListRepos(workspaceId);
    },
  });

  return {
    tempo_post_discussion_message,
    tempo_pull_plan,
    tempo_update_plan,
    tempo_add_blocks,
    tempo_update_block,
    tempo_delete_block,
    tempo_github_list_repos,
  };
}
