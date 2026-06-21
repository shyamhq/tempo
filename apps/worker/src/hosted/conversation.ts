// In-process conversation runtime — the no-VM half of the repo-gated Hosted
// Agent (docs/plans/hosted-conversation-before-vm.md, "Two runtimes"). A
// repo-less Hosted Thread has nothing to clone, so the Worker runs its planning
// turn IN-PROCESS instead of provisioning a Sandbox.
//
// This runtime is STATELESS and per-wake: each call rebuilds context from the
// persisted Discussion via getTurnHydration (no kept-alive RAM history), runs
// ONE streamText turn against a small toolset that calls @tempo/server fns
// directly (no MCP, no HTTP, no filesystem/Bash), streams its UIMessageChunks to
// ingestChunks/finalizeTurn in-process, and returns. It is the no-VM analog of
// one runner.ts turn:
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
  PostReplyInput,
  PullPlanInput,
  SetThreadMetaInput,
  UpdateBlockInput,
  UpdatePlanInput,
} from '@tempo/contracts/mcp';
import {
  acquireTurnLock,
  addBlocks,
  appendEvent,
  assertConnectorEnabled,
  deleteBlock,
  finalizeTurn,
  getEventsSinceLastTurn,
  getPlanBlocks,
  getThread,
  getTurnHydration,
  githubListRepos,
  ingestChunks,
  postMessage,
  postReply,
  refreshTurnLock,
  releaseTurnLock,
  updateBlock,
  updatePlan,
  updateThread,
} from '@tempo/server';
import { type ModelMessage, stepCountIs, streamText, type ToolSet, tool } from 'ai';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { env } from '../env';
import { logger } from '../logger';
import { listSkills, loadSkill } from '../skills/loader';
import { buildModel, MODEL_ID, pumpChunks, webTools } from './agent-tools';

const log = logger.child({ module: 'conversation' });

const model = buildModel({ apiKey: env.MOONSHOT_API_KEY, baseURL: env.MOONSHOT_BASE_URL });
const MAX_STEPS_PER_TURN = 50;

// Lock-lease maintenance. Planning turns can run tens of minutes, so the lock's
// TTL can't be a fixed "max turn duration" — instead a heartbeat refreshes it
// while the turn is alive, and a stall watchdog aborts a turn whose stream has
// gone silent (a hung model would otherwise hold the now-immortal lease). Both
// run on one timer. STALL_MS sits well above any healthy inter-chunk gap (model
// reasoning, a web-search round-trip) and below the TTL; HEARTBEAT_MS gives a 5x
// refresh margin under the TTL.
const HEARTBEAT_MS = 60_000;
const STALL_MS = 120_000;

// Why the live turn was torn down. `lock-lost` means another container reclaimed
// the lease (we persist nothing — the new owner produces the turn). `stalled`
// (and, once a Stop button exists, a Dev cancel) ends the turn cleanly: persist
// what streamed and close it so the cursor advances and a hung model isn't
// retried in a loop.
type AbortReason = 'stalled' | 'lock-lost';

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

  // The live turn's controller; the heartbeat aborts it on stall or lock loss.
  // `lastChunkAt` is reset at each turn's start and bumped per chunk by the pump.
  let controller: AbortController | null = null;
  let lastChunkAt = Date.now();
  const heartbeat = setInterval(() => {
    void (async () => {
      if (Date.now() - lastChunkAt > STALL_MS) {
        log.warn({ threadId, event: 'conversation:stalled' }, 'turn stream stalled — aborting');
        controller?.abort('stalled');
        return;
      }
      // A transient Redis error is not loss of ownership — the TTL has slack and
      // the next tick retries. Only a definitive not-owner reply aborts.
      let stillOurs = true;
      try {
        stillOurs = await refreshTurnLock(threadId, nonce);
      } catch (err) {
        log.debug(
          { err, threadId, event: 'conversation:lock_refresh_failed' },
          'lock refresh errored — retrying next tick',
        );
      }
      if (!stillOurs) {
        log.warn({ threadId, event: 'conversation:lock_lost' }, 'lost turn lease — aborting');
        controller?.abort('lock-lost');
      }
    })().catch((err) => log.error({ err, threadId }, 'conversation: heartbeat tick failed'));
  }, HEARTBEAT_MS);

  try {
    const thread = await getThread(threadId);
    if (!thread) {
      log.warn({ threadId }, 'conversation: thread not found');
      return;
    }
    const tools = buildToolset(threadId, thread.workspace_id);

    // Coalescing re-drain loop: events that arrive (on any container) mid-turn
    // are visible in the DB after this turn ends, so we loop until empty.
    while (true) {
      const events = await getEventsSinceLastTurn(threadId);
      if (events.length === 0) break;

      const context = await getTurnHydration(threadId);
      controller = new AbortController();
      lastChunkAt = Date.now();
      const outcome = await runStreamTurn({
        threadId,
        events,
        context,
        tools,
        signal: controller.signal,
        onProgress: () => {
          lastChunkAt = Date.now();
        },
      });
      // Lost the lease mid-turn → another container owns the thread now; stop
      // before we re-drain against a lock we no longer hold.
      if (outcome === 'lock-lost') break;
    }
  } catch (err) {
    log.error({ err, threadId, event: 'conversation:failed' }, 'in-process turn failed');
  } finally {
    // Null first so a heartbeat tick already in-flight past clearInterval can't
    // abort a finished turn or log a spurious lock-loss after we've exited.
    controller = null;
    clearInterval(heartbeat);
    await releaseTurnLock(threadId, nonce).catch((err) =>
      log.warn({ err, threadId }, 'conversation: release lock failed'),
    );
  }
}

type StreamTurnInput = {
  threadId: string;
  events: TempoEvent[];
  context: TurnHydration | null;
  tools: ToolSet;
  signal: AbortSignal;
  onProgress: () => void;
};

type TurnOutcome = 'done' | 'stalled' | 'lock-lost';

// One streamText turn. Same user-message shape and emission shapes as one
// runner.ts turn; the only difference is direct appendEvent (no /agent-events
// HTTP). The caller's heartbeat may abort `signal` mid-turn — see AbortReason.
async function runStreamTurn(input: StreamTurnInput): Promise<TurnOutcome> {
  const startedAt = Date.now();
  // context is the Turn-1 snapshot; null on the coalescing re-drain turns, where
  // it's omitted from the JSON so the Agent reads state from the events deltas.
  const userMessage = JSON.stringify({
    thread_id: input.threadId,
    events: input.events,
    context: input.context ?? undefined,
  });
  const messages: ModelMessage[] = [{ role: 'user', content: userMessage }];
  const turn = `amsg_${nanoid()}`;

  const result = streamText({
    model,
    tools: { ...input.tools, ...webTools() },
    stopWhen: stepCountIs(MAX_STEPS_PER_TURN),
    system: TEMPO_AGENT_SYSTEM_PROMPT,
    messages,
    abortSignal: input.signal,
  });

  // In-process sink: call the server fns directly (no HTTP). finalize persists
  // the assembled UIMessage; agent_turn_ended below is the event-log boundary.
  try {
    await pumpChunks(
      result.toUIMessageStream({ sendSources: true, generateMessageId: () => turn }),
      (chunks) => ingestChunks(input.threadId, turn, chunks),
      input.onProgress,
    );
  } catch (err) {
    // An abort ends the UI stream rather than throwing it, so a throw here is a
    // genuine failure — re-raise it. The signal check below handles the abort.
    if (!input.signal.aborted) throw err;
  }

  // An abort ends the stream without throwing, so detect it from the signal.
  if (input.signal.aborted) {
    const reason = (input.signal.reason as AbortReason) ?? 'stalled';
    if (reason === 'lock-lost') {
      // Another container reclaimed the lease and owns the turn now. We may have
      // published+buffered live chunks already, but skip finalize so no partial
      // message is persisted — the chunk buffer reaps via its TTL.
      log.warn(
        { threadId: input.threadId, turn, event: 'conversation:turn_lock_lost' },
        'turn aborted: lock lost',
      );
      return 'lock-lost';
    }
    // Persist the partial message and close the turn so the cursor advances and
    // a hung model isn't retried in a loop.
    await finalizeTurn(input.threadId, turn).catch((err) =>
      log.warn({ err, threadId: input.threadId, turn }, 'finalize on stall failed'),
    );
    await appendEvent(input.threadId, { kind: 'agent_turn_ended' });
    log.warn(
      { threadId: input.threadId, turn, event: 'conversation:turn_stalled' },
      'turn aborted: stalled',
    );
    return 'stalled';
  }

  await finalizeTurn(input.threadId, turn);

  const usage = await result.totalUsage;
  log.info(
    {
      threadId: input.threadId,
      model: MODEL_ID,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      elapsedMs: Date.now() - startedAt,
      event: 'conversation:turn',
    },
    'in-process turn complete',
  );

  await appendEvent(input.threadId, { kind: 'agent_turn_ended' });
  return 'done';
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

  const tempo_post_reply = tool({
    description:
      'Post a reply to a Dev comment. Be direct, action-oriented, and concise — match the tone of a senior engineer responding to a code review comment. Acknowledge the concern; state what you will do or have done.',
    inputSchema: PostReplyInput,
    execute: async ({ comment_id, payload, mentions, attachments }) => {
      try {
        const reply = await postReply(
          comment_id,
          payload,
          null,
          mentions ?? null,
          attachments,
          threadId,
        );
        return { reply_id: reply.id };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'comment_not_found' || msg === 'forbidden') return { error: msg };
        throw err;
      }
    },
  });

  const tempo_set_thread_meta = tool({
    description:
      "Update the Thread title and/or description. Call once on Turn 1 if thread.title === 'Untitled thread' — derive a 3–6-word title from the first Dev Discussion Message. Never overwrite a non-placeholder title.",
    inputSchema: SetThreadMetaInput,
    execute: async ({ title, description }) => {
      try {
        const thread = await updateThread(threadId, { title, description });
        return { thread };
      } catch (err) {
        if ((err as Error).message === 'thread_not_found') return { error: 'thread_not_found' };
        throw err;
      }
    },
  });

  const skills = listSkills();
  const tempo_load_skill = tool({
    description: `Load a bundled skill guide by name. Available skills: ${skills
      .map((s) => `${s.name} — ${s.description}`)
      .join('; ')}`,
    inputSchema: z.object({ name: z.string().min(1) }),
    // Return the raw guide text (not a wrapper object) so the model sees the
    // same payload the MCP runtime delivers after its content envelope is
    // unwrapped.
    execute: async ({ name }) => {
      const body = loadSkill(name);
      if (!body)
        return `unknown skill "${name}". Available: ${skills.map((s) => s.name).join(', ')}`;
      return body;
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
    tempo_post_reply,
    tempo_set_thread_meta,
    tempo_load_skill,
    tempo_pull_plan,
    tempo_update_plan,
    tempo_add_blocks,
    tempo_update_block,
    tempo_delete_block,
    tempo_github_list_repos,
  };
}
