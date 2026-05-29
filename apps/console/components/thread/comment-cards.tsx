'use client';

import type { Comment, Reply } from '@tempo/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useComposerStore } from '@/lib/stores/composer-store';

export function NewCommentCard({ threadId }: { threadId: string }) {
  const { plan_quote, plan_context, draft, setDraft, cancel, setLastCreated } = useComposerStore();
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      const c = await api.createComment(threadId, { plan_quote, plan_context });
      await api.createReply(c.id, { payload: { type: 'text', text: draft.trim() } });
      setLastCreated(c.id);
      cancel();
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <div className="rounded-md border border-highlight/60 bg-surface-2 p-3 shadow-md">
      <Textarea
        ref={textareaRef}
        placeholder="Comment…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
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

export function CommentCard({
  comment,
  archived = false,
  focused = false,
  onFocus,
}: {
  comment: Comment;
  archived?: boolean;
  focused?: boolean;
  onFocus?: () => void;
}) {
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

  const onReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void sendReply();
    }
  };

  const toggleResolve = async () => {
    if (comment.resolved_by) await api.unresolveComment(comment.id);
    else await api.resolveComment(comment.id);
  };

  const resolved = comment.resolved_by !== null;
  const border = focused ? 'border-2 border-accent' : 'border-hairline';

  return (
    <div
      data-comment-id={comment.id}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus?.();
        }
      }}
      role={onFocus ? 'button' : undefined}
      tabIndex={onFocus ? 0 : undefined}
      className={`rounded-md border bg-surface-1 ${border} p-3 cursor-pointer transition-colors`}
      title={comment.plan_quote ?? undefined}
    >
      {archived ? (
        <p className="text-xs text-ink-tertiary mb-2 italic line-clamp-2">“{comment.plan_quote}”</p>
      ) : null}
      <div className="space-y-2">
        {comment.replies.map((r) => (
          <ReplyRow key={r.id} reply={r} />
        ))}
      </div>
      {!archived && !resolved ? (
        <div className="mt-2">
          <Textarea
            placeholder="Reply…"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={onReplyKeyDown}
            onClick={(e) => e.stopPropagation()}
            rows={2}
            className="text-xs"
          />
          <div className="mt-2 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                void toggleResolve();
              }}
            >
              Resolve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting || !replyDraft.trim()}
              onClick={(e) => {
                e.stopPropagation();
                void sendReply();
              }}
            >
              Reply
            </Button>
          </div>
        </div>
      ) : !archived && resolved ? (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void toggleResolve();
            }}
          >
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

  const text = reply.payload.text;

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
          <Button
            variant="primary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void decide('accepted');
            }}
          >
            Approve edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void decide('rejected');
            }}
          >
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
