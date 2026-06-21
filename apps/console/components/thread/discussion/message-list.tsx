'use client';

import { useOrganization, useUser } from '@clerk/nextjs';
import type { DiscussionMessage } from '@tempo/contracts';
import { Sparkles } from 'lucide-react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { AttachmentStrip } from '../attachments/attachment-strip';
import { MarkdownText } from '../markdown-text';
import { LiveQuestionCard, MinimizedQuestionCard } from './question-card';

export function MessageList({
  messages,
  threadId,
  endSlot,
  emptyState,
}: {
  messages: DiscussionMessage[];
  threadId: string;
  endSlot?: React.ReactNode;
  emptyState?: React.ReactNode;
}) {
  const { user } = useUser();
  const { memberships } = useOrganization({ memberships: true });
  const currentUserId = user?.id ?? null;

  // Snap to bottom on mount, smooth-stick on new messages, and release the lock
  // when the user scrolls up — all handled by use-stick-to-bottom.
  const { scrollRef, contentRef } = useStickToBottom({ initial: 'instant', resize: 'smooth' });

  if (messages.length === 0 && !endSlot && emptyState) {
    return <div className="flex-1 flex items-center justify-center px-6">{emptyState}</div>;
  }

  let lastDayKey: string | null = null;
  let lastAuthorUserId: string | null | undefined;
  const lastIdx = messages.length - 1;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div ref={contentRef} className="flex flex-col">
        {messages.map((m, i) => {
          const dayKey = dayKeyOf(m.created_at);
          const showDay = dayKey !== lastDayKey;
          const isQuestion = m.questions !== null;
          const sameAuthor =
            !showDay &&
            !isQuestion &&
            lastAuthorUserId !== undefined &&
            lastAuthorUserId === m.author_user_id;
          lastDayKey = dayKey;
          lastAuthorUserId = isQuestion ? undefined : m.author_user_id;
          const isLive = isQuestion && i === lastIdx;
          const marginClass = isQuestion
            ? 'mt-6'
            : sameAuthor
              ? 'mt-3 first:mt-0'
              : 'mt-6 first:mt-0';
          return (
            <div key={m.id} className={marginClass}>
              {showDay ? <DayDivider iso={m.created_at} /> : null}
              {isLive ? (
                <LiveQuestionCard message={m} threadId={threadId} />
              ) : m.questions !== null ? (
                <MinimizedQuestionCard message={m} />
              ) : (
                <MessageRow
                  message={m}
                  currentUserId={currentUserId}
                  membershipItems={memberships?.data ?? null}
                />
              )}
            </div>
          );
        })}
        {endSlot ? <div className="mt-[18px]">{endSlot}</div> : null}
      </div>
    </div>
  );
}

const ENTER_ANIM = {
  animation: 'discussion-message-enter 140ms cubic-bezier(0.22, 1, 0.36, 1) both',
};

type MembershipItem = {
  publicUserData?: {
    userId?: string;
    firstName: string | null;
    lastName: string | null;
    identifier: string;
  };
};

function resolveAuthor(
  authorUserId: string | null,
  currentUserId: string | null,
  membershipItems: MembershipItem[] | null,
): { name: string; initials: string } {
  if (authorUserId === null) return { name: 'Agent', initials: '' };
  if (authorUserId === currentUserId) return { name: 'You', initials: 'Y' };
  const pub = membershipItems?.find(
    (m) => m.publicUserData?.userId === authorUserId,
  )?.publicUserData;
  if (!pub) return { name: 'Member', initials: 'M' };
  const { firstName, lastName, identifier } = pub;
  const f = firstName?.[0] ?? '';
  const l = lastName?.[0] ?? '';
  const initials = f || l ? `${f}${l}`.toUpperCase() : (identifier[0]?.toUpperCase() ?? 'M');
  const full = [firstName, lastName].filter(Boolean).join(' ');
  return { name: full.length > 0 ? full : identifier, initials };
}

function MessageRow({
  message,
  currentUserId,
  membershipItems,
}: {
  message: DiscussionMessage;
  currentUserId: string | null;
  membershipItems: MembershipItem[] | null;
}) {
  const isAgent = message.author_user_id === null;
  // Question-carrying messages render via LiveQuestionCard / MinimizedQuestionCard;
  // this row only handles text-only messages, so `text` is non-null here.
  const text = message.text ?? '';
  const { name: displayName, initials } = resolveAuthor(
    message.author_user_id,
    currentUserId,
    membershipItems,
  );

  return (
    <div style={ENTER_ANIM}>
      <div className="flex items-center gap-2 mb-1.5">
        <div
          aria-hidden
          className={`size-6 rounded-full flex-shrink-0 flex items-center justify-center ${
            isAgent ? 'bg-accent/15 text-accent-deep' : 'bg-surface-3 text-ink-subtle'
          }`}
        >
          {isAgent ? (
            <Sparkles className="size-3" />
          ) : (
            <span className="text-[10px] font-bold leading-none">{initials}</span>
          )}
        </div>
        <span className={`text-caption font-semibold ${isAgent ? 'text-accent-deep' : 'text-ink'}`}>
          {displayName}
        </span>
        <time
          dateTime={message.created_at}
          className="text-micro font-normal text-ink-tertiary tabular-nums"
          suppressHydrationWarning // locale-dependent time differs server vs client
        >
          {formatTime(message.created_at)}
        </time>
      </div>
      <div
        className={`text-body-sm leading-[1.65] text-ink [overflow-wrap:anywhere] ${
          isAgent ? '' : 'bg-stone-100 rounded-lg px-3.5 py-2.5'
        }`}
      >
        {text.length > 0 ? (
          <MarkdownText text={text} mentions={message.mentions} className="text-body-sm" />
        ) : null}
        <AttachmentStrip attachments={message.attachments} />
      </div>
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center justify-center my-4">
      <span className="text-micro font-normal text-ink-tertiary tabular-nums">
        {formatDay(iso)}
      </span>
    </div>
  );
}

function dayKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDay(iso: string): string {
  const d = new Date(iso).toDateString();
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d === today.toDateString()) return 'Today';
  if (d === yest.toDateString()) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
