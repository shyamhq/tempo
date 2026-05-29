'use client';

import type { DiscussionMessage } from '@tempo/contracts';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { MarkdownText } from '../markdown-text';

export function MessageList({
  messages,
  endSlot,
  emptyState,
}: {
  messages: DiscussionMessage[];
  endSlot?: React.ReactNode;
  emptyState?: React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(messages.length);

  useLayoutEffect(() => {
    // Snap to bottom on first mount. Load-bearing: the post-mount effect below
    // only auto-scrolls when the user is already within 80px of the bottom, so
    // opening a panel with prior messages would otherwise show the oldest first.
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const prevCount = lastCountRef.current;
    lastCountRef.current = messages.length;
    if (messages.length <= prevCount) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only auto-scroll if the user was already near the bottom (80px tolerance).
    if (distanceFromBottom < 80) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  if (messages.length === 0 && !endSlot && emptyState) {
    return <div className="flex-1 flex items-center justify-center px-6">{emptyState}</div>;
  }

  let lastDayKey: string | null = null;
  let lastAuthor: DiscussionMessage['author'] | null = null;

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-4">
      <div className="flex flex-col">
        {messages.map((m) => {
          const dayKey = dayKeyOf(m.created_at);
          const showDay = dayKey !== lastDayKey;
          const sameAuthor = !showDay && lastAuthor === m.author;
          lastDayKey = dayKey;
          lastAuthor = m.author;
          return (
            <div key={m.id} className={sameAuthor ? 'mt-1.5' : 'mt-5 first:mt-0'}>
              {showDay ? <DayDivider iso={m.created_at} /> : null}
              <MessageRow message={m} />
            </div>
          );
        })}
        {endSlot ? <div className="mt-5">{endSlot}</div> : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const ENTER_ANIM = {
  animation: 'discussion-message-enter 140ms cubic-bezier(0.22, 1, 0.36, 1) both',
};

function MessageRow({ message }: { message: DiscussionMessage }) {
  const timeLabel = formatTime(message.created_at);
  const body = (
    <>
      <time dateTime={message.created_at} className="sr-only">
        {timeLabel}
      </time>
      <MarkdownText text={message.text} />
    </>
  );

  if (message.author === 'agent') {
    return (
      <div
        className="text-[13.5px] leading-[1.6] text-ink"
        title={timeLabel}
        style={ENTER_ANIM}
      >
        {body}
      </div>
    );
  }

  return (
    <div className="flex justify-end" style={ENTER_ANIM}>
      <div
        className="max-w-[85%] rounded-2xl bg-surface-3 px-3.5 py-2 text-[13.5px] leading-[1.55] text-ink"
        title={timeLabel}
      >
        {body}
      </div>
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center justify-center my-4">
      <span className="text-[10.5px] text-ink-tertiary tabular-nums">{formatDay(iso)}</span>
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
