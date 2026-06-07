'use client';

import type { CommentBody, CommentData, ThreadData, User } from '@blocknote/core/comments';
import { DefaultThreadStoreAuth, ThreadStore } from '@blocknote/core/comments';
import type { Comment, Reply } from '@tempo/contracts';
import { api } from '@/lib/api-client';

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
  /** Pulled fresh on every read — we never cache; the parent already keeps
   * one authoritative snapshot via TanStack Query. */
  getCommentsSnapshot: () => Comment[];
  /** Tells the parent to refetch after a mutation completes. */
  invalidate: () => void;
  /** Read the PM selection at the moment BlockNote calls `createThread` —
   * before the comment mark is stamped — so the Comment row carries a quote
   * + surrounding context. The Agent's only structured handle on "where was
   * this anchored?" is `plan_quote` / `plan_context`; the markdown view it
   * gets has comment marks stripped (`server/plan.ts` `stripCommentMarks`). */
  captureAnchor: () => { quote: string; context: string };
};

export class CommentThreadBridge extends ThreadStore {
  private readonly threadId: string;
  private readonly devUser: User;
  private readonly getCommentsSnapshot: () => Comment[];
  private readonly invalidate: () => void;
  private readonly captureAnchor: () => { quote: string; context: string };
  private subscribers = new Set<(threads: Map<string, ThreadData>) => void>();

  constructor(opts: CommentThreadBridgeOptions) {
    super(new DefaultThreadStoreAuth(opts.devUser.id, 'editor'));
    this.threadId = opts.threadId;
    this.devUser = opts.devUser;
    this.getCommentsSnapshot = opts.getCommentsSnapshot;
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
    const created = await api.createComment(this.threadId, {
      // Read the PM selection BEFORE the POST — BlockNote awaits this method
      // before stamping the `comment` mark on the doc (see
      // `@blocknote/core/src/comments/extension.ts` createThread), so the
      // editor's selection is still the user's pending-comment range here.
      plan_quote: anchor.quote,
      plan_context: anchor.context,
      first_reply_text: text.length > 0 ? text : undefined,
      attachments: [],
    });
    this.invalidate();
    this.notify();
    return commentToThread(created, this.devUser.id);
  }

  async addComment(options: {
    threadId: string;
    comment: { body: CommentBody; metadata?: unknown };
  }): Promise<CommentData> {
    const text = extractText(options.comment.body);
    const reply = await api.createReply(options.threadId, {
      payload: { text },
      attachments: [],
    });
    this.invalidate();
    this.notify();
    return replyToComment(reply, this.devUser.id);
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    await api.resolveComment(options.threadId);
    this.invalidate();
    this.notify();
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    await api.unresolveComment(options.threadId);
    this.invalidate();
    this.notify();
  }

  async updateComment(): Promise<void> {
    throw new Error('updateComment is not supported by Tempo');
  }

  async deleteComment(): Promise<void> {
    throw new Error('deleteComment is not supported by Tempo');
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    await api.deleteComment(options.threadId);
    this.invalidate();
    this.notify();
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
    resolved: comment.resolved_by !== null,
    resolvedBy: comment.resolved_by ?? undefined,
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
    userId: reply.author === 'dev' ? devUserId : reply.author,
    createdAt: new Date(reply.created_at),
    updatedAt: new Date(reply.created_at),
    reactions: [],
    metadata: undefined,
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

function extractText(body: CommentBody): string {
  const out: string[] = [];
  for (const block of body as BlockLike[]) {
    if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (typeof inline.text === 'string') out.push(inline.text);
      }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      out.push(extractText(block.children as CommentBody));
    }
    out.push('\n');
  }
  return out.join('').trim();
}
