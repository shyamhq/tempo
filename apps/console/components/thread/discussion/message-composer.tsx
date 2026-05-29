'use client';

import { ArrowUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

const MIN_ROWS = 1;
const MAX_ROWS = 6;

export function MessageComposer({
  threadId,
  disabled,
  disabledReason,
  autoFocus,
}: {
  threadId: string;
  disabled: boolean;
  disabledReason: string | null;
  autoFocus: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  const canSend = !disabled && !sending && draft.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    const text = draft.trim();
    setSending(true);
    setSendError(null);
    try {
      await api.postDiscussionMessage(threadId, { text });
      setDraft('');
      ref.current?.focus();
    } catch (e) {
      setSendError(humaniseSendError(e));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="bg-canvas px-4 pt-2 pb-4">
      <div
        className={`rounded-2xl border bg-surface-1 transition-colors ${
          disabled
            ? 'border-hairline'
            : 'border-hairline-strong focus-within:border-ink-subtle'
        }`}
      >
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={MIN_ROWS}
          disabled={disabled}
          placeholder={
            disabledReason ?? 'Ask about the approach — anything not tied to a line of the Plan.'
          }
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-[13.5px] leading-[1.55] text-ink placeholder:text-ink-tertiary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{ maxHeight: `${MAX_ROWS * 1.55 + 1}em` }}
        />
        <div className="flex items-center justify-end px-2 pb-2">
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="Send"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-all ${
              canSend
                ? 'bg-primary text-on-primary hover:bg-primary-hover'
                : 'bg-surface-3 text-ink-tertiary cursor-not-allowed'
            }`}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
      {sendError ? (
        <p className="mt-2 px-1 text-[11px] text-danger">{sendError}</p>
      ) : null}
    </div>
  );
}

function humaniseSendError(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg.includes('round_pending')) return 'Answer the open Clarification Round first.';
  if (msg.includes('thread_approved')) return 'Thread is approved — reopen to continue.';
  return 'Send failed. Try again.';
}
