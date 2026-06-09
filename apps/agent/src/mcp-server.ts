import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AttachmentRef, Event, SessionId, ThreadId } from '@tempo/contracts';
import {
  AddBlocksInput,
  type AttachOutput,
  DeleteBlockInput,
  PollInput,
  type PollOutput,
  PostDiscussionMessageInput,
  PostReplyInput,
  SetThreadMetaInput,
  UpdateBlockInput,
  UpdatePlanInput,
} from '@tempo/contracts/mcp';
import type { z } from 'zod';
import { env } from './env';
import type { ConsoleClient } from './http-client';
import { fetchAttachmentAsImageBlock } from './r2-fetcher';

type AttachState = z.infer<typeof AttachOutput>;
type PollState = z.infer<typeof PollOutput>;

export async function runStdioMcpServer(args: {
  client: ConsoleClient;
  sessionId: SessionId;
  threadId: ThreadId;
}): Promise<void> {
  const { client, sessionId, threadId } = args;
  const server = new McpServer({ name: 'tempo', version: '0.1.0' });

  server.registerTool(
    'tempo_attach',
    {
      description:
        'Always call first. Returns Thread state — title, description, status — plus Plan, open Comments, Discussion messages, and the workflow guide for this session. Call again after any session resume or context compact. Images attached to the last few Discussion messages are inlined as vision content.',
      inputSchema: {},
    },
    async () => {
      const state = (await client.getSessionState(sessionId)) as AttachState;
      const images = await fetchRecentMessageImages(state, env.ATTACH_INLINE_RECENT_MESSAGES);
      return wrapWithImages(state, images);
    },
  );

  server.registerTool(
    'tempo_pull_plan',
    {
      description:
        'Read the current Plan as a flat list of blocks. Each block has an opaque id (ending in `$`) and an HTML content string. Use this when you want to inspect the Plan or before any edit.',
      inputSchema: {},
    },
    async () => wrap(await client.getPlanBlocks(threadId)),
  );

  server.registerTool(
    'tempo_update_plan',
    {
      description:
        'Write the entire Plan in one shot from a single HTML document. Use only for the first draft of a brand-new Plan — fails with `plan_not_empty` (409) if any blocks already exist. After this, switch to `tempo_update_block` / `tempo_add_blocks` / `tempo_delete_block` for incremental edits so anchored Comments survive. The HTML can be a multi-block document (headings, paragraphs, lists, code blocks, etc.) — the server splits it into BlockNote blocks and assigns ids. For Mermaid diagrams emit `<pre><code class="language-mermaid">…</code></pre>` — the Console renders these as live SVG diagrams; without the `language-mermaid` class they render as a plain code block. For callouts emit `<div class="alert alert-warning">…inline html…</div>` (or `alert-error`, `alert-info`, `alert-success`) — the Console renders these as styled callout blocks; preserve the second class on rewrites or the variant is lost. For embedded HTML pages (design-system surfaces, interactive prototypes) emit `<pre><code class="language-html-block">…html…</code></pre>` — the Console renders these as a sandboxed iframe; without the `language-html-block` class they render as a plain code block. Returns `$`-suffixed ids of the inserted top-level blocks.',
      inputSchema: UpdatePlanInput.shape,
    },
    async (args) => wrap(await client.updatePlan(threadId, args.html)),
  );

  server.registerTool(
    'tempo_update_block',
    {
      description:
        'Replace one block\'s content. Provide the block id from tempo_pull_plan and the new HTML. The editor preserves Comments anchored to blocks you do not touch; Comments anchored to text inside this block may surface in the Dev\'s Orphaned list — that is expected. For Mermaid diagrams emit `<pre><code class="language-mermaid">…</code></pre>` — the Console renders these as live SVG diagrams; without the `language-mermaid` class they render as a plain code block. For callouts emit `<div class="alert alert-warning">…inline html…</div>` (or `alert-error`, `alert-info`, `alert-success`) — the Console renders these as styled callout blocks; preserve the second class on rewrites or the variant is lost. For embedded HTML pages emit `<pre><code class="language-html-block">…html…</code></pre>` — the Console renders these as a sandboxed iframe; without the `language-html-block` class they render as a plain code block.',
      inputSchema: UpdateBlockInput.shape,
    },
    async (args) => wrap(await client.updateBlock(threadId, args.block_id, args.html)),
  );

  server.registerTool(
    'tempo_add_blocks',
    {
      description:
        "Insert one or more new blocks. `reference_id` is the id of an existing block (or null + position:'end' to append). `position` is 'before', 'after', or 'end'. `blocks` is an array of HTML strings, one per new block. For Mermaid diagrams emit `<pre><code class=\"language-mermaid\">…</code></pre>` — the Console renders these as live SVG diagrams; without the `language-mermaid` class they render as a plain code block. For callouts emit `<div class=\"alert alert-{warning|error|info|success}\">…inline html…</div>` — the Console renders these as styled callout blocks (warning / error / info / success); preserve the variant class on rewrites or the styling is lost. For embedded HTML pages (design-system surfaces, interactive prototypes) emit `<pre><code class=\"language-html-block\">…html…</code></pre>` — the Console renders these as a sandboxed iframe; without the `language-html-block` class they render as a plain code block.",
      inputSchema: AddBlocksInput.shape,
    },
    async (args) =>
      wrap(await client.addBlocks(threadId, args.reference_id, args.position, args.blocks)),
  );

  server.registerTool(
    'tempo_delete_block',
    {
      description: 'Remove one block by id.',
      inputSchema: DeleteBlockInput.shape,
    },
    async (args) => wrap(await client.deleteBlock(threadId, args.block_id)),
  );

  server.registerTool(
    'tempo_poll',
    {
      description:
        'Long-poll the event stream for new events past cursor. Images attached to new events arrive as vision content alongside the events JSON.',
      inputSchema: PollInput.shape,
    },
    async (args) => {
      const poll = (await client.poll(threadId, args.cursor)) as PollState;
      const images = await fetchEventImages(poll.events);
      return wrapWithImages(poll, images);
    },
  );

  server.registerTool(
    'tempo_post_reply',
    {
      description:
        'Post a Reply on a Comment. Chat-style markdown — one paragraph at most, the less the better. Human, conversational tone. Bold, italic, bullets, links, single-backtick inline code for filenames/identifiers, triple-backtick fenced blocks for multi-line snippets. No headings. Never put multi-line content inside single backticks; never write `\\n` as text — use a real newline. If you need to change the Plan, edit it first with the block-editing tools (`tempo_update_block`, `tempo_add_blocks`, `tempo_delete_block`), then post a Reply describing what you changed and why. If you want to suggest an edit before making it, write the suggestion in prose (e.g. "Planning to update the bullet about retries to read: *…* — confirm?") and wait for the Dev\'s text reply. No structured proposal payload; the conversation is the protocol.',
      inputSchema: PostReplyInput.shape,
    },
    async (args) => {
      const reply = await client.postReply(args.comment_id, args.payload);
      return wrap({ reply_id: reply.id });
    },
  );

  server.registerTool(
    'tempo_set_thread_meta',
    {
      description:
        'Set the Thread title (and optionally description). Only call when the title equals the literal placeholder "Untitled thread" — never rewrite a Dev-chosen title. Title: 3–6 words, no trailing punctuation. Derive from the first Dev Discussion Message.',
      inputSchema: SetThreadMetaInput.shape,
    },
    async (args) => {
      const { thread } = await client.updateThreadMeta(threadId, args);
      return wrap({ thread });
    },
  );

  server.registerTool(
    'tempo_post_discussion_message',
    {
      description:
        "Post one Message to the Thread Discussion. Two forms (use either, or both in one Message):\n\n• `text` — free-form prose. Use for approach-level talk about your reasoning, the codebase, or the Thread overall — not line-level pushback on the Plan (use tempo_post_reply for that). One paragraph at most, the less the better. Human, conversational tone. Chat-style markdown: bold, italic, bullets, links, single-backtick inline code for filenames/identifiers, triple-backtick fenced blocks for multi-line snippets. No headings. Never put multi-line content inside single backticks; never write `\\n` as text — use a real newline.\n\n• `questions` — a batch of 1–10 structured questions (`single_choice` / `multi_choice` / `open_text`) that the Console renders as a stepper at the bottom of the Discussion. Use when you want clear decisions on specific things before you continue. Choice questions can `allow_other` for a Dev-typed write-in. The Dev's reply lands as a normal Discussion Message whose `text` formats the answers as `**<prompt>**\\n→ <answer>` — read it as prose; there is no separate answers payload.\n\nIf multiple Dev Messages arrived since your last poll, send ONE Reply that addresses all of them. If a change to the Plan is the right answer, just edit the Plan with the block-editing tools (`tempo_update_block`, `tempo_add_blocks`, `tempo_delete_block`) and say so briefly here. The Plan is the artifact.",
      inputSchema: PostDiscussionMessageInput.shape,
    },
    async (args) => {
      const message = await client.postDiscussionMessage(threadId, args);
      return wrap({ message_id: message.id });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

function wrap(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

type ImageBlock = { type: 'image'; data: string; mimeType: string };

function wrapWithImages(payload: unknown, images: ImageBlock[]) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(payload) },
      ...images.map((img) => ({
        type: 'image' as const,
        data: img.data,
        mimeType: img.mimeType,
      })),
    ],
  };
}

async function fetchRecentMessageImages(state: AttachState, n: number): Promise<ImageBlock[]> {
  const messages = state.discussion.messages;
  const recent = messages.slice(-n);
  const refs: AttachmentRef[] = recent.flatMap((m) => m.attachments);
  return fetchImages(refs);
}

async function fetchEventImages(events: Event[]): Promise<ImageBlock[]> {
  const refs: AttachmentRef[] = [];
  for (const e of events) {
    if (e.kind === 'discussion_message_posted') refs.push(...e.message.attachments);
    else if (e.kind === 'reply_added') refs.push(...e.reply.attachments);
    else if (e.kind === 'comment_added') {
      for (const r of e.comment.replies) refs.push(...r.attachments);
    }
  }
  return fetchImages(refs);
}

async function fetchImages(refs: AttachmentRef[]): Promise<ImageBlock[]> {
  if (refs.length === 0) return [];
  const out = await Promise.all(refs.map(fetchAttachmentAsImageBlock));
  return out.flatMap((b) => (b ? [b] : []));
}
