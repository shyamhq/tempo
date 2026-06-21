'use client';

// The reply / new-comment composer field, shared by the thread card and the
// floating new-comment composer. Mirrors the kit's `.creply` (Design System
// Planning Tool/ui_kits/workbench/index.html lines 225-228, 539): an inset
// textarea that lifts to the canvas surface with an accent border on focus,
// paired with a primary "Reply" button. Cmd/Ctrl+Enter submits (kit line 637).

import { CornerDownLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export function CommentReplyBox({
  sending,
  onSubmit,
  placeholder,
  submitLabel = 'Reply',
  autoFocus = false,
}: {
  sending: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  placeholder: string;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const text = value.trim();
  const canSend = text.length > 0 && !sending;

  // Focus on mount when requested (the new-comment composer): the field opens
  // in response to an explicit user action, so this is the expected next step.
  // Done via ref rather than the autoFocus attribute (a11y lint). preventScroll
  // keeps the plan from jumping when the field opens on a selection below the
  // fold — the composer is already positioned at the selection by floating-ui.
  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = () => {
    if (!canSend) return;
    void onSubmit(text);
    setValue('');
  };

  return (
    <div className="flex flex-col gap-[9px]">
      {/* Kit `.creply` (Design System Planning Tool/ui_kits/workbench/index.html
          lines 225-228): a single inset field — bg-inset + 1px border at rest;
          on focus it lifts to canvas with an accent border + the kit focus ring.
          No doubled/nested border. field-sizing lets it grow with the text. */}
      <textarea
        ref={fieldRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="min-h-7 w-full resize-none rounded-[9px] border border-border bg-inset px-[10px] py-2 font-sans text-sm leading-snug text-ink outline-none transition-colors [field-sizing:content] placeholder:text-ink-3 focus:border-primary focus:bg-canvas focus:shadow-[var(--tp-focus-ring)]"
      />
      <div className="flex items-center">
        <span className="font-mono text-2xs text-ink-3">⌘↵ to send</span>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          disabled={!canSend}
          onClick={submit}
        >
          {sending ? (
            <Loader2 className="size-[13px] animate-spin" aria-hidden />
          ) : (
            <CornerDownLeft className="size-[13px]" aria-hidden />
          )}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
