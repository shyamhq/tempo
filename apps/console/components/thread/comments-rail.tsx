'use client';

import type { Comment, Reply } from '@tempo/contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useComposerStore } from '@/lib/stores/composer-store';

export function CommentsRail({
  threadId,
  comments,
  archivedComments,
}: {
  threadId: string;
  comments: Comment[];
  archivedComments: Comment[];
}) {
  const composer = useComposerStore();
  const [showResolved, setShowResolved] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  const visible = comments.filter((c) => showResolved || c.resolved_by === null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-subtle">Comments</h2>
        <label className="flex items-center gap-2 text-xs text-ink-subtle cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="accent-accent"
          />
          Show resolved
        </label>
      </div>

      {composer.open ? <NewCommentCard threadId={threadId} /> : null}

      {visible.length === 0 && !composer.open ? (
        <p className="text-xs text-ink-tertiary py-4 text-center border border-dashed border-hairline rounded-md">
          Select Plan text to add a Comment.
        </p>
      ) : null}

      {visible.map((c) => (
        <CommentCard key={c.id} comment={c} />
      ))}

      {archivedComments.length > 0 ? (
        <div className="mt-4 border-t border-hairline pt-3">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            className="flex items-center gap-1 text-xs text-ink-subtle hover:text-ink"
          >
            {showArchive ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Archive ({archivedComments.length})
          </button>
          {showArchive ? (
            <div className="mt-2 space-y-2">
              {archivedComments.map((c) => (
                <CommentCard key={c.id} comment={c} archived />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NewCommentCard({ threadId }: { threadId: string }) {
  const { plan_quote, plan_context, draft, setDraft, cancel, setLastCreated } = useComposerStore();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const c = await api.createComment(threadId, { plan_quote, plan_context });
      if (draft.trim()) {
        await api.createReply(c.id, {
          payload: { type: 'text', text: draft.trim() },
        });
      }
      // The editor watches this to wrap the captured range with CommentMark.
      setLastCreated(c.id);
      cancel();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-md border border-accent/40 bg-surface-2 p-3">
      <p className="text-xs text-ink-tertiary mb-2 italic line-clamp-2">“{plan_quote}”</p>
      <Textarea
        autoFocus
        placeholder="Comment…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={submitting || !draft.trim()} onClick={submit}>
          {submitting ? 'Sending…' : 'Comment'}
        </Button>
      </div>
    </div>
  );
}

function CommentCard({ comment, archived = false }: { comment: Comment; archived?: boolean }) {
  const [replyDraft, setReplyDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sendReply = async () => {
    if (!replyDraft.trim()) return;
    setSubmitting(true);
    try {
      await api.createReply(comment.id, {
        payload: { type: 'text', text: replyDraft.trim() },
      });
      setReplyDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleResolve = async () => {
    if (comment.resolved_by) await api.unresolveComment(comment.id);
    else await api.resolveComment(comment.id);
  };

  return (
    <div
      data-comment-id={comment.id}
      className={`rounded-md border ${
        comment.resolved_by
          ? 'border-hairline bg-surface-1/50 opacity-70'
          : 'border-hairline bg-surface-1'
      } p-3`}
    >
      <p className="text-xs text-ink-tertiary mb-2 italic line-clamp-2">“{comment.plan_quote}”</p>
      <div className="space-y-2">
        {comment.replies.map((r) => (
          <ReplyRow key={r.id} reply={r} />
        ))}
      </div>
      {!archived && !comment.resolved_by ? (
        <div className="mt-2">
          <Textarea
            placeholder="Reply…"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            rows={2}
            className="text-xs"
          />
          <div className="mt-2 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={toggleResolve}>
              Resolve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting || !replyDraft.trim()}
              onClick={sendReply}
            >
              Reply
            </Button>
          </div>
        </div>
      ) : !archived && comment.resolved_by ? (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={toggleResolve}>
            Unresolve
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReplyRow({ reply }: { reply: Reply }) {
  const isEditProposed = reply.payload.type === 'edit_proposed';
  const isEditDone = reply.payload.type === 'edit_done';

  const decide = async (decision: 'accepted' | 'rejected') => {
    await api.decideProposal(reply.id, { decision });
  };

  const text =
    reply.payload.type === 'text'
      ? reply.payload.text
      : reply.payload.type === 'edit_done'
        ? reply.payload.text
        : reply.payload.text;

  return (
    <div className="rounded border border-hairline bg-surface-2 p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-tertiary">
          {reply.author}
        </span>
        {isEditProposed ? (
          <span className="text-[10px] text-accent-hover">proposed edit</span>
        ) : null}
        {isEditDone ? <span className="text-[10px] text-success">edit applied</span> : null}
      </div>
      <p className="text-xs text-ink whitespace-pre-wrap">{text}</p>
      {isEditProposed && reply.payload.type === 'edit_proposed' ? (
        <div className="mt-2 rounded border border-hairline bg-surface-3 p-2 text-[11px] font-mono text-ink-muted whitespace-pre-wrap">
          {reply.payload.replacement}
        </div>
      ) : null}
      {isEditProposed && reply.proposal_status === null ? (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" size="sm" onClick={() => decide('accepted')}>
            Approve edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => decide('rejected')}>
            Reject
          </Button>
        </div>
      ) : null}
      {reply.proposal_status === 'accepted' ? (
        <p className="mt-1 text-[10px] text-success">Accepted</p>
      ) : reply.proposal_status === 'rejected' ? (
        <p className="mt-1 text-[10px] text-ink-tertiary">
          Rejected{reply.rejection_reason ? `: ${reply.rejection_reason}` : ''}
        </p>
      ) : null}
    </div>
  );
}
