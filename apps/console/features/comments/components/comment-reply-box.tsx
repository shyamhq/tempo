'use client';

// The reply / new-comment composer field, shared by the thread card and the
// floating new-comment composer. Mirrors the kit's `.creply` (Design System
// Planning Tool/ui_kits/workbench/index.html lines 225-228, 539): an inset
// field that lifts to the canvas surface with an accent border on focus, paired
// with a primary "Reply" button. Cmd/Ctrl+Enter submits (kit line 637).
//
// The field is the shared MentionableInput (features/mentions) so the Dev can
// @mention members + the Agent; it serialises to plain text + a Mention[]
// sidecar, which the caller threads through to createComment/createReply.

import { CornerDownLeft, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { MentionableInputRef, MentionDoc } from '@/features/mentions/mentionable-input';
import { MentionableInput } from '@/features/mentions/mentionable-input';
import { useMentionCandidates } from '@/features/mentions/use-mention-candidates';

export function CommentReplyBox({
  sending,
  onSubmit,
  placeholder,
  submitLabel = 'Reply',
  autoFocus = false,
}: {
  sending: boolean;
  onSubmit: (doc: MentionDoc) => void | Promise<void>;
  placeholder: string;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<MentionableInputRef>(null);
  const candidates = useMentionCandidates();
  const [hasText, setHasText] = useState(false);
  const canSend = hasText && !sending;

  const submit = () => {
    if (!canSend || !inputRef.current) return;
    const doc = inputRef.current.serialise();
    if (doc.text.length === 0) return;
    void onSubmit(doc);
    inputRef.current.clear();
    setHasText(false);
  };

  return (
    <div className="flex flex-col gap-[9px]">
      {/* Kit `.creply` (Design System Planning Tool/ui_kits/workbench/index.html
          lines 225-228): a single inset field — bg-inset + 1px border at rest;
          on focus it lifts to canvas with an accent border + the kit focus ring. */}
      <div className="rounded-[9px] border border-border bg-inset px-[10px] py-2 transition-colors focus-within:border-primary focus-within:bg-canvas focus-within:shadow-[var(--tp-focus-ring)]">
        <MentionableInput
          ref={inputRef}
          autoFocus={autoFocus}
          candidates={candidates}
          placeholder={placeholder}
          minHeight={20}
          maxHeight={160}
          onSubmit={submit}
          onChange={(doc) => setHasText(doc.text.length > 0)}
        />
      </div>
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
