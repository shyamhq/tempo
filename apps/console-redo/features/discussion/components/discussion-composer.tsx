'use client';

// The Discussion composer. Mirrors the kit's `.composer`/`.cfield`/`.crow`
// (Design System Planning Tool/ui_kits/workbench/index.html lines 196-203,
// 482-490): a bordered field that lifts an accent border + focus ring on focus,
// an auto-growing textarea, the `⌘↵ to send` mono hint, and a primary Send
// button. Cmd/Ctrl+Enter or the button submits.
//
// Send flow mirrors apps/console's MessageComposer: the Worker mints the id, so
// there's no optimistic row — we POST and let the discussion_message_posted echo
// append the message (the slice dedups by id). Send is disabled in-flight; errors
// surface inline; the field clears on success. T5.1 sends text-only (mentions /
// attachments / repos are deferred).

import { useAuth } from '@clerk/nextjs';
import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { postDiscussionMessage } from '../api';

export function DiscussionComposer({ threadId }: { threadId: string }) {
  const { getToken } = useAuth();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The send chord differs by platform (⌘ on Mac, Ctrl elsewhere). navigator is
  // client-only, so resolve after mount; the hint shows the Mac glyph until then
  // (it's cosmetic — Cmd+Enter and Ctrl+Enter both submit regardless).
  const [isMac, setIsMac] = useState(true);
  useEffect(() => setIsMac(/mac/i.test(navigator.platform)), []);
  const text = value.trim();
  const canSend = text.length > 0 && !sending;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await postDiscussionMessage(threadId, { text, attachments: [] }, getToken);
      setValue('');
    } catch {
      setError('Send failed. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-panel p-[11px]">
      <div className="rounded-[11px] border border-border-strong bg-canvas px-3 py-[10px] transition-colors focus-within:border-primary focus-within:shadow-[var(--tp-focus-ring)]">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          aria-label="Message"
          placeholder="Ask the Agent, or describe a change to the plan…"
          rows={1}
          disabled={sending}
          className="min-h-[34px] w-full resize-none border-0 bg-transparent text-[12.5px] leading-[1.45] text-ink outline-none [field-sizing:content] placeholder:text-ink-3 disabled:opacity-60"
        />
        <div className="mt-[7px] flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-3">
            {isMac ? '⌘↵' : 'Ctrl+↵'} to send
          </span>
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            disabled={!canSend}
            onClick={() => void submit()}
          >
            Send
            <Send className="size-[13px]" aria-hidden />
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 px-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
