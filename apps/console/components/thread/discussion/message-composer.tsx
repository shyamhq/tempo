'use client';

import { ArrowUp, Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

const MIN_ROWS = 1;
const MAX_ROWS = 6;
const SENT_DWELL_MS = 1200;

type Phase = 'idle' | 'sending' | 'sent';

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
  const [phase, setPhase] = useState<Phase>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    return () => {
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
    };
  }, []);

  const canSend = !disabled && phase !== 'sending' && draft.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    const text = draft.trim();
    setPhase('sending');
    setSendError(null);
    try {
      await api.postDiscussionMessage(threadId, { text });
      setDraft('');
      setPhase('sent');
      ref.current?.focus();
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
      sentTimerRef.current = setTimeout(() => setPhase('idle'), SENT_DWELL_MS);
    } catch (e) {
      setSendError(humaniseSendError(e));
      setPhase('idle');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="bg-canvas px-4 pt-2 pb-3">
      <div
        className={`flex items-end gap-1.5 rounded-xl border bg-surface-1 pl-3 pr-1.5 py-1.5 transition-[border-color,box-shadow] ${
          disabled
            ? 'border-hairline'
            : 'border-hairline-strong focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15'
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
          className="block w-full resize-none bg-transparent py-1.5 text-[13.5px] leading-[1.55] text-ink placeholder:text-ink-tertiary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{ maxHeight: `${MAX_ROWS * 1.55 + 1}em` }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label={phase === 'sent' ? 'Sent' : 'Send'}
          className={`inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors ${
            phase === 'sent'
              ? 'bg-accent/10 text-[#069072]'
              : canSend
                ? 'bg-primary text-on-primary hover:bg-primary-hover'
                : 'bg-surface-3 text-ink-tertiary cursor-not-allowed'
          }`}
        >
          {phase === 'sending' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : phase === 'sent' ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {sendError ? <p className="mt-2 px-1 text-[11px] text-danger">{sendError}</p> : null}
    </div>
  );
}

function humaniseSendError(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg.includes('thread_approved')) return 'Thread is approved — reopen to continue.';
  return 'Send failed. Try again.';
}
