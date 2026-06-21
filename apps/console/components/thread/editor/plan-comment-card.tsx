'use client';

// Replaces BlockNote's default FloatingThread card (the popover for a focused
// comment thread). Re-skinned to match Tempo's card aesthetic. "Comment
// thread" here refers to BlockNote's annotation entity — Tempo's Comment +
// Replies. Distinct from Tempo's planning `Thread`.

import type { CommentData } from '@blocknote/core/comments';
import { CommentsExtension } from '@blocknote/core/comments';
import type { ThreadProps } from '@blocknote/react';
import { useBlockNoteEditor } from '@blocknote/react';
import { useOrganization } from '@clerk/nextjs';
import type { Mention } from '@tempo/contracts';
import { Check, CornerDownLeft, Loader2, Maximize2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { MarkdownText } from '@/components/thread/markdown-text';
import type { MentionableInputRef } from '@/components/thread/mention/mentionable-input';
import { MentionableInput } from '@/components/thread/mention/mentionable-input';
import { useMentionCandidates } from '@/components/thread/mention/use-mention-candidates';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useThreadUi } from '@/store/thread-ui';
import { AGENT_AUTHOR_ID, extractBlockNoteText } from './comment-thread-bridge';

export type PlanCommentCardVariant = 'card' | 'panel';

export function PlanCommentCard({
  thread,
  selected,
  orphaned,
  onFocus,
  onBlur,
  tabIndex,
  variant = 'card',
}: ThreadProps & { variant?: PlanCommentCardVariant }) {
  const editor = useBlockNoteEditor();
  const ext = editor.getExtension(CommentsExtension);
  const threadStore = ext?.threadStore;

  const { memberships } = useOrganization({ memberships: true });

  const [replyHasText, setReplyHasText] = useState(false);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const replyRef = useRef<MentionableInputRef>(null);
  const candidates = useMentionCandidates();

  // Stay at the top on open (read the original comment first); only auto-scroll
  // when the user posts a reply, or when a reply lands while already at bottom.
  const { scrollRef, contentRef, scrollToBottom } = useStickToBottom({
    initial: false,
    resize: 'smooth',
  });

  const canReply = replyHasText && !sending && threadStore !== undefined;

  const sendReply = async () => {
    if (!canReply || !threadStore || !replyRef.current) return;
    const doc = replyRef.current.serialise();
    if (doc.text.length === 0) return;
    setSending(true);
    try {
      await threadStore.addComment({
        threadId: thread.id,
        comment: {
          body: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: doc.text, styles: {} }],
            },
          ],
          // Carries mentions through the bridge to createReply.
          metadata: doc.mentions.length > 0 ? { mentions: doc.mentions } : undefined,
        },
      });
      replyRef.current.clear();
      setReplyHasText(false);
      scrollToBottom('smooth');
    } finally {
      setSending(false);
    }
  };

  const toggleResolve = async () => {
    if (resolving || !threadStore) return;
    setResolving(true);
    try {
      if (thread.resolved) await threadStore.unresolveThread({ threadId: thread.id });
      else await threadStore.resolveThread({ threadId: thread.id });
    } finally {
      setResolving(false);
    }
  };

  const doDelete = async () => {
    if (deleting || !threadStore) return;
    // window.confirm + window.alert are the existing destructive-action
    // pattern in this codebase (see DeleteThreadButton). Both replaced when
    // the Console grows a toast primitive — filed in AGENTS.md.
    const ok = window.confirm('Delete this comment and all replies? This cannot be undone.');
    if (!ok) return;
    setDeleting(true);
    try {
      await threadStore.deleteThread({ threadId: thread.id });
    } catch {
      // The bridge surfaces nothing; loud failure beats silent on delete.
      window.alert('Delete failed. The comment is unchanged.');
    } finally {
      setDeleting(false);
    }
  };

  const baseBorder = selected ? 'border-2 border-accent' : 'border-hairline';
  const border = `${baseBorder}${orphaned ? ' border-dashed' : ''}`;
  const shadow = selected ? ' shadow-card-elevated' : '';

  const setEnlarged = useThreadUi((s) => s.setEnlarged);
  const canEnlarge = variant === 'card';

  const outerClass =
    variant === 'panel'
      ? 'flex flex-col w-full h-full bg-surface-1'
      : `w-[360px] border bg-surface-1 ${border}${shadow} rounded-xl overflow-hidden`;
  const listClass =
    variant === 'panel'
      ? `flex flex-col flex-1 min-h-0 overflow-y-auto pt-1.5 transition-opacity ${
          thread.resolved ? 'opacity-50' : ''
        }`
      : `flex flex-col max-h-[33vh] overflow-y-auto pt-1.5 transition-opacity ${
          thread.resolved ? 'opacity-50' : ''
        }`;

  return (
    <div
      role="group"
      aria-label="Comment"
      onFocus={onFocus}
      onBlur={onBlur}
      tabIndex={tabIndex}
      className={outerClass}
    >
      {canEnlarge ? (
        <div className="flex items-center justify-end px-2 pt-1.5">
          <Tooltip content="Open in rail">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEnlarged(thread.id);
              }}
              aria-label="Enlarge comment into rail"
              className="inline-flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md p-1.5"
            >
              <Maximize2 className="size-icon-xs" aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : null}
      <div ref={scrollRef} className={listClass}>
        <div ref={contentRef} className="flex flex-col">
          {thread.comments.map((c) => (
            <PlanCommentRow
              key={c.id}
              comment={c}
              username={resolveAuthorLabel(c.userId, memberships?.data)}
            />
          ))}
        </div>
      </div>

      {thread.resolved ? (
        <div className="flex items-center justify-between gap-2.5 px-4 pt-3 pb-4">
          <span className="inline-flex items-center gap-2 text-body-sm font-medium text-accent-deep">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent/10 text-accent-deep">
              <Check className="size-icon-xs" strokeWidth={3} aria-hidden />
            </span>
            Resolved
          </span>
          <button
            type="button"
            disabled={resolving}
            onClick={(e) => {
              e.stopPropagation();
              void toggleResolve();
            }}
            className="text-body-sm font-medium text-ink-subtle hover:text-ink disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md px-1 py-0.5"
          >
            Reopen
          </button>
        </div>
      ) : (
        <>
          <div className="px-4 pt-1.5">
            <div className="relative rounded-lg border border-hairline bg-surface-2 px-3.5 py-2.5">
              <MentionableInput
                ref={replyRef}
                placeholder="Reply…"
                candidates={candidates}
                minHeight={20}
                maxHeight={160}
                className="text-body-sm"
                onSubmit={() => void sendReply()}
                onChange={(doc) => setReplyHasText(doc.text.length > 0)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-4">
            <div className="flex items-center gap-1">
              <Tooltip content={thread.resolved ? 'Reopen' : 'Resolve'}>
                <button
                  type="button"
                  disabled={resolving}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleResolve();
                  }}
                  className="inline-flex items-center gap-1.5 text-body-sm font-medium text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md px-2 py-1.5"
                >
                  {resolving ? (
                    <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-icon-sm" aria-hidden />
                  )}
                  Resolve
                </button>
              </Tooltip>
              <Tooltip content="Delete">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    void doDelete();
                  }}
                  className="inline-flex items-center justify-center text-ink-subtle hover:text-danger hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md p-1.5"
                  aria-label="Delete comment"
                >
                  {deleting ? (
                    <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-icon-sm" aria-hidden />
                  )}
                </button>
              </Tooltip>
            </div>
            <Button
              variant="accent"
              size="md"
              disabled={!canReply}
              onClick={(e) => {
                e.stopPropagation();
                void sendReply();
              }}
            >
              <CornerDownLeft className="size-icon-sm" aria-hidden />
              Reply
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type MembershipRow = NonNullable<ReturnType<typeof useOrganization>['memberships']>['data'];

function resolveAuthorLabel(userId: string, members: MembershipRow | null | undefined): string {
  if (userId === AGENT_AUTHOR_ID) return 'Agent';
  const m = members?.find((x) => x.publicUserData?.userId === userId);
  const pub = m?.publicUserData;
  if (!pub) return userId;
  const name = `${pub.firstName ?? ''} ${pub.lastName ?? ''}`.trim();
  return name || pub.identifier || userId;
}

function PlanCommentRow({ comment, username }: { comment: CommentData; username: string }) {
  const text = comment.body ? extractBlockNoteText(comment.body as never) : '';
  const mentions = ((comment.metadata as { mentions?: Mention[] } | null | undefined)?.mentions ??
    null) as Mention[] | null;
  return (
    <div className="px-4 py-2.5 border-t border-hairline-soft first:border-t-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span aria-hidden className="size-[7px] rounded-full bg-ink-subtle" />
        <span className="text-micro-uppercase uppercase font-semibold text-ink-subtle">
          {username}
        </span>
        <span className="text-caption text-ink-tertiary tabular-nums">
          {`· ${formatTime(comment.createdAt)}`}
        </span>
      </div>
      {text.length > 0 ? (
        <MarkdownText text={text} mentions={mentions} className="text-body-sm" />
      ) : (
        <span className="text-body-sm text-ink-tertiary italic">(deleted)</span>
      )}
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
