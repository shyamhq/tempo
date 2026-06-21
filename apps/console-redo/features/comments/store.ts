'use client';

// Comments slice: the ordered Comment[] with replies nested under each comment
// (replies have no independent lifecycle — the server nests them in
// GetThreadResponse). Mirrors the proven apply() transitions from the old
// use-thread-events: every remote event dedups by entity id so an optimistic
// local write and the server's echoed event reconcile to a single copy.

import type { Comment, Reply } from '@tempo/contracts';
import type {
  CommentAddedEvent,
  CommentDeletedEvent,
  CommentResolvedEvent,
  CommentUnresolvedEvent,
  ReplyAddedEvent,
} from '@tempo/contracts/events';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

export interface CommentsSlice {
  comments: Comment[];

  setComments: (comments: Comment[]) => void;

  applyCommentAdded: (e: z.infer<typeof CommentAddedEvent>) => void;
  applyReplyAdded: (e: z.infer<typeof ReplyAddedEvent>) => void;
  applyCommentResolved: (
    e: z.infer<typeof CommentResolvedEvent>,
    resolvedBy: string | null,
  ) => void;
  applyCommentUnresolved: (e: z.infer<typeof CommentUnresolvedEvent>) => void;
  applyCommentDeleted: (e: z.infer<typeof CommentDeletedEvent>) => void;

  // Optimistic writes: the same dedup-by-id used by the apply* actions lets the
  // server's echoed event collapse onto the local copy instead of duplicating.
  // resolve/unresolve/delete are idempotent over the entity id, so the echoed
  // comment_resolved/unresolved/deleted event re-applies the same final state.
  addCommentLocal: (comment: Comment) => void;
  addReplyLocal: (commentId: Comment['id'], reply: Reply) => void;
  resolveCommentLocal: (commentId: Comment['id'], resolvedBy: string | null) => void;
  unresolveCommentLocal: (commentId: Comment['id']) => void;
  deleteCommentLocal: (commentId: Comment['id']) => void;
}

function setResolved(
  comments: Comment[],
  commentId: Comment['id'],
  resolvedBy: string | null,
): Comment[] {
  return comments.map((c) => (c.id === commentId ? { ...c, resolved_by_user_id: resolvedBy } : c));
}

function upsertComment(comments: Comment[], comment: Comment): Comment[] {
  return comments.some((c) => c.id === comment.id) ? comments : [...comments, comment];
}

function upsertReply(comments: Comment[], commentId: Comment['id'], reply: Reply): Comment[] {
  return comments.map((c) => {
    if (c.id !== commentId) return c;
    if (c.replies.some((r) => r.id === reply.id)) return c;
    return { ...c, replies: [...c.replies, reply] };
  });
}

export const createCommentsSlice: StateCreator<ThreadStore, [], [], CommentsSlice> = (set) => ({
  comments: [],

  setComments: (comments) => set({ comments }),

  applyCommentAdded: (e) => set((s) => ({ comments: upsertComment(s.comments, e.comment) })),

  applyReplyAdded: (e) =>
    set((s) => ({ comments: upsertReply(s.comments, e.comment_id, e.reply) })),

  applyCommentResolved: (e, resolvedBy) =>
    set((s) => ({ comments: setResolved(s.comments, e.comment_id, resolvedBy) })),

  applyCommentUnresolved: (e) =>
    set((s) => ({ comments: setResolved(s.comments, e.comment_id, null) })),

  applyCommentDeleted: (e) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== e.comment_id) })),

  addCommentLocal: (comment) => set((s) => ({ comments: upsertComment(s.comments, comment) })),

  addReplyLocal: (commentId, reply) =>
    set((s) => ({ comments: upsertReply(s.comments, commentId, reply) })),

  resolveCommentLocal: (commentId, resolvedBy) =>
    set((s) => ({ comments: setResolved(s.comments, commentId, resolvedBy) })),

  unresolveCommentLocal: (commentId) =>
    set((s) => ({ comments: setResolved(s.comments, commentId, null) })),

  deleteCommentLocal: (commentId) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== commentId) })),
});
