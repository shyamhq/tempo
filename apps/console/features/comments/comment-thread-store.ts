'use client';

// The BlockNote ThreadStore backed by Tempo's comments slice. "Thread" in
// BlockNote's vocabulary is the anchored entity holding a Comment + its Replies;
// in Tempo's vocabulary that is a `Comment` with a nested `replies[]`. This class
// implements BlockNote's abstract ThreadStore so the editor's documented comment
// UI drives Tempo's data:
//
//   READS  — getThread / getThreads / subscribe project the comments slice (the
//            gateway is the only writer of remote comment state; it applies
//            comment_added / reply_added / resolved / unresolved / deleted).
//   WRITES — createThread / addComment / resolveThread / unresolveThread /
//            deleteThread call features/comments/api.ts (Worker, Bearer Clerk
//            JWT) and apply the matching optimistic slice helper. The optimistic
//            local write and the server's echoed event reconcile to one copy:
//            every slice transition is idempotent over the entity id, so the
//            gateway's apply* collapses the echo onto the optimistic row.
//
// Per-reply edit/delete and reactions are not part of Tempo's model. Their
// capabilities are gated OFF at the auth boundary (TempoThreadStoreAuth below),
// so the stock comment UI never renders those affordances; the matching abstract
// methods stay as defensive "can't happen" guards.

import type { CommentBody, CommentData, ThreadData } from '@blocknote/core/comments';
import { DefaultThreadStoreAuth, ThreadStore } from '@blocknote/core/comments';
import type { Comment, Mention, Reply } from '@tempo/contracts';
import { useThreadStore } from '../../store';
import { createComment, createReply, deleteComment, resolveComment, unresolveComment } from './api';
import { commentText } from './comment-text';

// DefaultThreadStoreAuth('editor') would let the stock comment UI render a
// per-comment Edit (canUpdateComment), a per-comment Delete (canDeleteComment),
// and reaction buttons (canAddReaction / canDeleteReaction) — affordances whose
// ThreadStore methods Tempo does not implement (they throw). Gate exactly those
// off; create-thread, add-comment (reply), resolve/unresolve, and whole-thread
// delete (canDeleteThread, supported via deleteThread) stay enabled.
class TempoThreadStoreAuth extends DefaultThreadStoreAuth {
  override canUpdateComment(): boolean {
    return false;
  }
  override canDeleteComment(): boolean {
    return false;
  }
  override canAddReaction(): boolean {
    return false;
  }
  override canDeleteReaction(): boolean {
    return false;
  }
}

// BlockNote's CommentData.userId is a non-null string, but a Tempo Comment/Reply
// authored by the Agent carries author_user_id === null. Encode that null as a
// sentinel id so resolveUsers maps it back to "Agent" — never collapse it onto
// the Dev, or the Agent's replies render as the Dev.
export const AGENT_AUTHOR_ID = 'tempo-agent';

export type CommentThreadStoreOptions = {
  threadId: string;
  // The connected Dev's Clerk user id — the ThreadStoreAuth subject and the
  // author of optimistic resolves (the wire frame omits the actor). A getter so
  // Clerk hydrating the session (userId null → id) doesn't force the editor to
  // rebuild this store and churn BlockNote's comment subscribers.
  getDevUserId: () => string;
  getToken: () => Promise<string | null>;
  // The PM selection at the moment createThread fires (before the comment mark
  // is stamped), so the new Comment row carries a quote + surrounding context +
  // start block id for the Agent to re-anchor against.
  captureAnchor: () => { quote: string; context: string; blockId: string | null };
};

export class CommentThreadStore extends ThreadStore {
  private readonly threadId: string;
  private readonly getDevUserId: () => string;
  private readonly getToken: () => Promise<string | null>;
  private readonly captureAnchor: CommentThreadStoreOptions['captureAnchor'];

  constructor(opts: CommentThreadStoreOptions) {
    // The auth subject gates UI capability checks; the unsupported ones are
    // forced false in TempoThreadStoreAuth, so the snapshot id only feeds the
    // (also-disabled) reaction checks. Author attribution reads getDevUserId()
    // live in resolveThread and on every commentTo*/replyTo* projection.
    super(new TempoThreadStoreAuth(opts.getDevUserId(), 'editor'));
    this.threadId = opts.threadId;
    this.getDevUserId = opts.getDevUserId;
    this.getToken = opts.getToken;
    this.captureAnchor = opts.captureAnchor;
  }

  // Let BlockNote stamp the comment mark itself (the documented default): the
  // inline mark is the fast-path anchor and the store does not interfere.
  addThreadToDocument = undefined;

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const text = commentText(options.initialComment.body);
    const anchor = this.captureAnchor();
    const mentions = readMentions(options.initialComment.metadata);
    const created = await createComment(
      this.threadId,
      {
        plan_quote: anchor.quote,
        plan_context: anchor.context,
        anchor_block_id: anchor.blockId,
        first_reply_text: text.length > 0 ? text : undefined,
        attachments: [],
        ...(mentions && mentions.length > 0 ? { first_reply_mentions: mentions } : {}),
      },
      this.getToken,
    );
    useThreadStore.getState().addCommentLocal(created);
    return commentToThread(created);
  }

  async addComment(options: {
    threadId: string;
    comment: { body: CommentBody; metadata?: unknown };
  }): Promise<CommentData> {
    const text = commentText(options.comment.body);
    const mentions = readMentions(options.comment.metadata);
    const reply = await createReply(
      options.threadId,
      {
        payload: { text },
        attachments: [],
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
      },
      this.getToken,
    );
    useThreadStore.getState().addReplyLocal(options.threadId, reply);
    return replyToComment(reply);
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    await resolveComment(options.threadId, this.getToken);
    useThreadStore.getState().resolveCommentLocal(options.threadId, this.getDevUserId());
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    await unresolveComment(options.threadId, this.getToken);
    useThreadStore.getState().unresolveCommentLocal(options.threadId);
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    await deleteComment(options.threadId, this.getToken);
    useThreadStore.getState().deleteCommentLocal(options.threadId);
  }

  async updateComment(): Promise<void> {
    throw new Error('per-reply edit is not supported by Tempo');
  }

  async deleteComment(): Promise<void> {
    throw new Error('per-reply delete is not supported by Tempo');
  }

  async addReaction(): Promise<void> {
    throw new Error('reactions are not supported by Tempo');
  }

  async deleteReaction(): Promise<void> {
    throw new Error('reactions are not supported by Tempo');
  }

  getThread(threadId: string): ThreadData {
    const comment = useThreadStore.getState().comments.find((c) => c.id === threadId);
    if (!comment) throw new Error(`unknown thread ${threadId}`);
    return commentToThread(comment);
  }

  getThreads(): Map<string, ThreadData> {
    const out = new Map<string, ThreadData>();
    for (const c of useThreadStore.getState().comments) out.set(c.id, commentToThread(c));
    return out;
  }

  // BlockNote bridges this to React via useSyncExternalStore. Re-derive the
  // ThreadData map whenever the comments slice changes — the only mutable input
  // to getThreads — so the editor's comment UI re-renders on every optimistic
  // write and every gateway-applied remote event.
  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    return useThreadStore.subscribe((state, prev) => {
      if (state.comments !== prev.comments) cb(this.getThreads());
    });
  }
}

function commentToThread(comment: Comment): ThreadData {
  // BlockNote treats comments[0] as the thread's anchor message. Tempo does not
  // model the Comment record as a message — it is an anchor + metadata, and the
  // first Reply is the first message. Render the replies as the messages, and
  // only when there are none synthesise an anchor message from the quote so an
  // empty thread still shows something.
  const replies = comment.replies.map(replyToComment);
  const messages = replies.length > 0 ? replies : [anchorMessage(comment)];
  return {
    type: 'thread',
    id: comment.id,
    createdAt: new Date(comment.created_at),
    updatedAt: new Date(
      comment.replies[comment.replies.length - 1]?.created_at ?? comment.created_at,
    ),
    comments: messages,
    resolved: comment.resolved_by_user_id !== null,
    resolvedBy: comment.resolved_by_user_id ?? undefined,
    metadata: undefined,
  };
}

function anchorMessage(comment: Comment): CommentData {
  return {
    type: 'comment',
    id: comment.id,
    userId: comment.author_user_id ?? AGENT_AUTHOR_ID,
    createdAt: new Date(comment.created_at),
    updatedAt: new Date(comment.created_at),
    reactions: [],
    metadata: undefined,
    body: textToCommentBody(comment.plan_quote),
  };
}

function replyToComment(reply: Reply): CommentData {
  return {
    type: 'comment',
    id: reply.id,
    userId: reply.author_user_id ?? AGENT_AUTHOR_ID,
    createdAt: new Date(reply.created_at),
    updatedAt: new Date(reply.created_at),
    reactions: [],
    metadata: reply.mentions ? { mentions: reply.mentions } : undefined,
    body: textToCommentBody(reply.payload.text),
  };
}

function textToCommentBody(text: string): CommentBody {
  return [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }];
}

function readMentions(metadata: unknown): Mention[] | undefined {
  return (metadata as { mentions?: Mention[] } | null | undefined)?.mentions;
}
