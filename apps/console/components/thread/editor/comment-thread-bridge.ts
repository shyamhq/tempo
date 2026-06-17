'use client';

import type { CommentBody, CommentData, ThreadData, User } from '@blocknote/core/comments';
import { DefaultThreadStoreAuth, ThreadStore } from '@blocknote/core/comments';
import type { Comment, Mention, Reply } from '@tempo/contracts';
import type { workerApi } from '@/lib/api-client';

// "Comment thread" in BlockNote's vocabulary is the annotation entity that
// holds an anchored Comment + its Replies. In Tempo's vocabulary the same
// entity is a `Comment` with a `replies[]` array. This bridge implements
// BlockNote's `ThreadStore` so the editor calls our existing REST endpoints
// instead of an in-memory Yjs map.
//
// Mapping:
//   BlockNote createThread(initialComment)    → POST /api/threads/:id/comments
//   BlockNote addComment(threadId, comment)   → POST /api/comments/:id/replies
//   BlockNote resolveThread(threadId)         → POST /api/comments/:id/resolve
//   BlockNote unresolveThread(threadId)       → POST /api/comments/:id/unresolve
//   BlockNote deleteThread(threadId)          → DELETE /api/comments/:id
//   updateComment / deleteComment (single-    → throw (Tempo does not expose
//     reply edit/delete) / addReaction /         per-reply edit/delete or
//     deleteReaction                              reactions in this phase)

export type CommentThreadBridgeOptions = {
  threadId: string;
  devUser: User;
  /** Worker API client (Bearer Clerk JWT). Passed from the React parent via
   * useWorkerApi() so the bridge does not need to call hooks directly. */
  wApi: ReturnType<typeof workerApi>;
  /** Pulled fresh on every read — we never cache; the parent already keeps
   * one authoritative snapshot via TanStack Query. */
  getCommentsSnapshot: () => Comment[];
  /** Push a post-mutation snapshot into the query cache (and the editor's
   * comments ref) before `notify`, so subscribers never read stale state. */
  onCommentsChanged: (comments: Comment[]) => void;
  /** Background reconcile after the optimistic write lands. */
  invalidate: () => void;
  /** Read the PM selection at the moment BlockNote calls `createThread` —
   * before the comment mark is stamped — so the Comment row carries a quote
   * + surrounding context for the Agent. */
  captureAnchor: () => { quote: string; context: string; blockId: string | null };
};

export class CommentThreadBridge extends ThreadStore {
  private readonly threadId: string;
  private readonly devUser: User;
  private readonly wApi: ReturnType<typeof workerApi>;
  private readonly getCommentsSnapshot: () => Comment[];
  private readonly onCommentsChanged: (comments: Comment[]) => void;
  private readonly invalidate: () => void;
  private readonly captureAnchor: () => { quote: string; context: string; blockId: string | null };
  private subscribers = new Set<(threads: Map<string, ThreadData>) => void>();

  constructor(opts: CommentThreadBridgeOptions) {
    super(new DefaultThreadStoreAuth(opts.devUser.id, 'editor'));
    this.threadId = opts.threadId;
    this.devUser = opts.devUser;
    this.wApi = opts.wApi;
    this.getCommentsSnapshot = opts.getCommentsSnapshot;
    this.onCommentsChanged = opts.onCommentsChanged;
    this.invalidate = opts.invalidate;
    this.captureAnchor = opts.captureAnchor;
  }

  // Let BlockNote handle anchor stamping itself; the inline `commentThread`
  // style on the blocks tree is the fast-path anchor and the bridge does not
  // need to interfere.
  addThreadToDocument = undefined;

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const text = extractText(options.initialComment.body);
    const anchor = this.captureAnchor();
    const meta = options.initialComment.metadata as { mentions?: Mention[] } | null | undefined;
    const mentions = meta?.mentions;
    const created = await this.wApi.createComment(this.threadId, {
      plan_quote: anchor.quote,
      plan_context: anchor.context,
      anchor_block_id: anchor.blockId,
      first_reply_text: text.length > 0 ? text : undefined,
      attachments: [],
      ...(mentions && mentions.length > 0 ? { first_reply_mentions: mentions } : {}),
    });
    const prev = this.getCommentsSnapshot();
    const next = prev.some((c) => c.id === created.id) ? prev : [...prev, created];
    this.commitComments(next);
    return commentToThread(created, this.devUser.id);
  }

  async addComment(options: {
    threadId: string;
    comment: { body: CommentBody; metadata?: unknown };
  }): Promise<CommentData> {
    const text = extractText(options.comment.body);
    // mentions are threaded from the card via comment.metadata.
    const meta = options.comment.metadata as { mentions?: Mention[] } | null | undefined;
    const mentions = meta?.mentions;
    const reply = await this.wApi.createReply(options.threadId, {
      payload: { text },
      attachments: [],
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    });
    const next = this.getCommentsSnapshot().map((c) => {
      if (c.id !== options.threadId) return c;
      if (c.replies.some((r) => r.id === reply.id)) return c;
      return { ...c, replies: [...c.replies, reply] };
    });
    this.commitComments(next);
    return replyToComment(reply, this.devUser.id);
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    await this.wApi.resolveComment(options.threadId);
    const next = this.getCommentsSnapshot().map((c) =>
      c.id === options.threadId ? { ...c, resolved_by_user_id: this.devUser.id } : c,
    );
    this.commitComments(next);
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    await this.wApi.unresolveComment(options.threadId);
    const next = this.getCommentsSnapshot().map((c) =>
      c.id === options.threadId ? { ...c, resolved_by_user_id: null } : c,
    );
    this.commitComments(next);
  }

  async updateComment(): Promise<void> {
    throw new Error('updateComment is not supported by Tempo');
  }

  async deleteComment(): Promise<void> {
    throw new Error('deleteComment is not supported by Tempo');
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    await this.wApi.deleteComment(options.threadId);
    const next = this.getCommentsSnapshot().filter((c) => c.id !== options.threadId);
    this.commitComments(next);
  }

  async addReaction(): Promise<void> {
    throw new Error('addReaction is not supported by Tempo');
  }

  async deleteReaction(): Promise<void> {
    throw new Error('deleteReaction is not supported by Tempo');
  }

  getThread(threadId: string): ThreadData {
    const comment = this.getCommentsSnapshot().find((c) => c.id === threadId);
    if (!comment) throw new Error(`unknown thread ${threadId}`);
    return commentToThread(comment, this.devUser.id);
  }

  getThreads(): Map<string, ThreadData> {
    const out = new Map<string, ThreadData>();
    for (const c of this.getCommentsSnapshot()) {
      out.set(c.id, commentToThread(c, this.devUser.id));
    }
    return out;
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Call when the comments snapshot changes (e.g. after a query invalidate
   * refetches). The parent hook wires this to query state. */
  emitChange(): void {
    this.notify();
  }

  private commitComments(next: Comment[]): void {
    this.onCommentsChanged(next);
    this.notify();
    this.invalidate();
  }

  private notify(): void {
    const snapshot = this.getThreads();
    for (const cb of this.subscribers) cb(snapshot);
  }
}

function commentToThread(comment: Comment, devUserId: string): ThreadData {
  const initial = makeInitialThreadComment(comment, devUserId);
  const replies = comment.replies.map((r) => replyToComment(r, devUserId));
  // BlockNote treats the first item of `comments[]` as the thread's anchor
  // message. Tempo doesn't model that separately — the Comment record itself
  // is just an anchor + metadata; the first Reply is the first message. We
  // synthesise the anchor as a separate `comments[0]` only when the Tempo
  // Comment has no replies, so an empty thread still renders something.
  const all = replies.length > 0 ? replies : [initial];
  return {
    type: 'thread',
    id: comment.id,
    createdAt: new Date(comment.created_at),
    updatedAt: new Date(
      comment.replies[comment.replies.length - 1]?.created_at ?? comment.created_at,
    ),
    comments: all as ThreadData['comments'],
    resolved: comment.resolved_by_user_id !== null,
    resolvedBy: comment.resolved_by_user_id ?? undefined,
    metadata: undefined,
  };
}

function makeInitialThreadComment(comment: Comment, devUserId: string): CommentData {
  return {
    type: 'comment',
    id: comment.id,
    userId: devUserId,
    createdAt: new Date(comment.created_at),
    updatedAt: new Date(comment.created_at),
    reactions: [],
    metadata: undefined,
    body: textToCommentBody(comment.plan_quote || ''),
  };
}

function replyToComment(reply: Reply, devUserId: string): CommentData {
  return {
    type: 'comment',
    id: reply.id,
    userId: reply.author_user_id ?? devUserId,
    createdAt: new Date(reply.created_at),
    updatedAt: new Date(reply.created_at),
    reactions: [],
    // PlanCommentRow reads `mentions` off metadata to colour @tokens.
    metadata: reply.mentions ? { mentions: reply.mentions } : undefined,
    body: textToCommentBody(reply.payload.text),
  };
}

function textToCommentBody(text: string): CommentBody {
  return [
    {
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
    },
  ];
}

type InlineLike = { type?: string; text?: string };
type BlockLike = { content?: InlineLike[]; children?: BlockLike[] };

// Shared by PlanCommentRow — recursively walks a BlockNote body tree and
// collects text-node contents. Exported so the card doesn't ship a duplicate.
export function extractBlockNoteText(body: BlockLike[]): string {
  const out: string[] = [];
  for (const block of body) {
    if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (typeof inline.text === 'string') out.push(inline.text);
      }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      out.push(extractBlockNoteText(block.children));
    }
    out.push('\n');
  }
  return out.join('').trim();
}

function extractText(body: CommentBody): string {
  return extractBlockNoteText(body as BlockLike[]);
}
