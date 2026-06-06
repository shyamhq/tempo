'use client';

import type { DiscussionMessage } from '@tempo/contracts';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { AttachmentStrip } from '../attachments/attachment-strip';
import { MarkdownText } from '../markdown-text';
import { AgentIdentity } from './agent-identity';
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(messages.length);
  // Tracks bottom-proximity captured on the user's last scroll. Must be sampled
  // before a new message lands — measuring after-the-fact uses the already-grown
  // scrollHeight and a tall message would push the threshold past any tolerance.
  const wasNearBottomRef = useRef(true);

  useLayoutEffect(() => {
    // Snap to bottom on mount so a panel opening with prior messages shows the
    // newest first. `wasNearBottomRef` defaults to true so subsequent arrivals
    // also auto-scroll until the user manually scrolls up.
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const prevCount = lastCountRef.current;
    lastCountRef.current = messages.length;
    if (messages.length <= prevCount) return;
    if (wasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  if (messages.length === 0 && !endSlot && emptyState) {
    return <div className="flex-1 flex items-center justify-center px-6">{emptyState}</div>;
  }

  let lastDayKey: string | null = null;
  let lastAuthor: DiscussionMessage['author'] | null = null;
  const lastIdx = messages.length - 1;

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="flex flex-col">
        {messages.map((m, i) => {
          const dayKey = dayKeyOf(m.created_at);
          const showDay = dayKey !== lastDayKey;
          const isQuestion = m.questions !== null;
          // Question carriers stand on their own — never share author-grouping
          // margins with neighbouring bubbles, in either direction.
          const sameAuthor = !showDay && !isQuestion && lastAuthor === m.author;
          lastDayKey = dayKey;
          lastAuthor = isQuestion ? null : m.author;
          const isLive = isQuestion && i === lastIdx;
          const marginClass = isQuestion
            ? 'mt-[18px]'
            : sameAuthor
              ? 'mt-1.5'
              : 'mt-[18px] first:mt-0';
          return (
            <div key={m.id} className={marginClass}>
              {showDay ? <DayDivider iso={m.created_at} /> : null}
              {isLive ? (
                <LiveQuestionCard message={m} threadId={threadId} />
              ) : m.questions !== null ? (
                <MinimizedQuestionCard message={m} />
              ) : (
                <MessageRow message={m} showIdentity={!sameAuthor} />
              )}
            </div>
          );
        })}
        {endSlot ? <div className="mt-[18px]">{endSlot}</div> : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const ENTER_ANIM = {
  animation: 'discussion-message-enter 140ms cubic-bezier(0.22, 1, 0.36, 1) both',
};

function MessageRow({
  message,
  showIdentity,
}: {
  message: DiscussionMessage;
  showIdentity: boolean;
}) {
  const timeLabel = formatTime(message.created_at);
  // Question-carrying messages render via LiveQuestionCard / MinimizedQuestionCard;
  // this row only handles text-only messages, so `text` is non-null here.
  const text = message.text ?? '';

  if (message.author === 'agent') {
    return (
      <div style={ENTER_ANIM}>
        {showIdentity ? (
          <AgentIdentity created_at={message.created_at} />
        ) : (
          <time dateTime={message.created_at} className="sr-only">
            {timeLabel}
          </time>
        )}
        <div className="text-body-sm leading-[1.6] text-ink">
          {text.length > 0 ? <MarkdownText text={text} className="[&_p]:text-body-sm" /> : null}
          <AttachmentStrip attachments={message.attachments} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end" style={ENTER_ANIM}>
      {showIdentity ? (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-micro-uppercase uppercase text-ink-subtle">You</span>
          <span aria-hidden className="text-micro font-normal text-ink-tertiary tabular-nums">
            ·
          </span>
          <time
            dateTime={message.created_at}
            className="text-micro font-normal text-ink-tertiary tabular-nums"
          >
            {timeLabel}
          </time>
        </div>
      ) : (
        <time dateTime={message.created_at} className="sr-only">
          {timeLabel}
        </time>
      )}
      <div className="max-w-[85%] rounded-lg rounded-br-xs bg-surface-2 px-3.5 py-2 text-body-sm leading-[1.55] text-ink">
        {text.length > 0 ? <MarkdownText text={text} className="[&_p]:text-body-sm" /> : null}
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

function formatTime(iso: string): string {
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
