'use client';

// The Discussion composer. Mirrors the kit's `.composer`/`.cfield`/`.crow`
// (Design System Planning Tool/ui_kits/workbench/index.html lines 196-203,
// 482-490): a bordered field that lifts an accent border + focus ring on focus,
// an auto-growing textarea, the `⌘↵ to send` mono hint, and a primary Send
// button. Cmd/Ctrl+Enter or the button submits.
//
// Send flow mirrors apps/console's MessageComposer: the Worker mints the id, so
// there's no optimistic row — we POST and let the discussion_message_posted echo
// append the message (the slice dedups by id). The field is the shared
// MentionableInput (features/mentions) so the Dev can @mention members + the
// Agent; it serialises to plain text + a Mention[] sidecar that Send threads
// into postDiscussionMessage. Images attach via the shared uploader
// (features/attachments): files upload eagerly on add/paste/drop, and Send passes
// the resolved ids. Send accepts text-only, attachments-only, or both, and is
// blocked while any upload is in flight. The field clears on success.
//
// ponytail: the Hosted repo-context bar (apps/console's MessageComposer shows
// one) is deferred. console's /api/threads/:id/repos route is GET-only and
// the composer isn't threaded an agent_type / repos state — adding the bar means
// new wiring (agentType prop, repos query+seed, ThreadContextBar) that the
// attachments task isn't scoped for. Add it when the hosted-thread repo edit
// surface lands.

import { useAuth } from '@clerk/nextjs';
import { Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AttachmentAddButton,
  AttachmentDragOverlay,
  AttachmentThumbnails,
  useAttachmentSurface,
} from '@/features/attachments/components/attachment-tray';
import {
  skippedNotice,
  useAttachmentUploader,
} from '@/features/attachments/use-attachment-uploader';
import type { MentionableInputRef } from '@/features/mentions/mentionable-input';
import { MentionableInput } from '@/features/mentions/mentionable-input';
import { useMentionCandidates } from '@/features/mentions/use-mention-candidates';
import { postDiscussionMessage } from '../api';

export function DiscussionComposer({ threadId }: { threadId: string }) {
  const { getToken } = useAuth();
  const [hasText, setHasText] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The send chord differs by platform (⌘ on Mac, Ctrl elsewhere). navigator is
  // client-only, so resolve after mount; the hint shows the Mac glyph until then
  // (it's cosmetic — Cmd+Enter and Ctrl+Enter both submit regardless).
  const [isMac, setIsMac] = useState(true);
  useEffect(() => setIsMac(/mac/i.test(navigator.platform)), []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<MentionableInputRef>(null);
  const candidates = useMentionCandidates();
  const baseUploader = useAttachmentUploader(threadId, getToken);
  // Surface skipped files (wrong type / oversize / over the 8-file cap) inline:
  // wrap addFiles once so paste, drop, and the add button all set the notice.
  const [notice, setNotice] = useState<string | null>(null);
  const { addFiles } = baseUploader;
  const addWithNotice = useCallback(
    async (files: File[]) => {
      const res = await addFiles(files);
      setNotice(skippedNotice(res.rejected));
      return res;
    },
    [addFiles],
  );
  const uploader = useMemo(
    () => ({ ...baseUploader, addFiles: addWithNotice }),
    [baseUploader, addWithNotice],
  );
  // Paste binds to the outer card so an image pasted anywhere on the composer
  // (not only over the contenteditable) is captured — the contenteditable still
  // handles text/mention paste itself.
  const { rootProps, isDragActive } = useAttachmentSurface(uploader, wrapRef, sending);

  // Send with text OR ready attachments; never while an upload is mid-flight.
  const canSend = (hasText || uploader.readyIds.length > 0) && !sending && !uploader.hasUploading;

  const submit = async () => {
    if (!canSend || !inputRef.current) return;
    const doc = inputRef.current.serialise();
    if (doc.text.length === 0 && uploader.readyIds.length === 0) return;
    setSending(true);
    setError(null);
    try {
      await postDiscussionMessage(
        threadId,
        {
          ...(doc.text.length > 0 ? { text: doc.text } : {}),
          attachments: uploader.readyIds,
          ...(doc.mentions.length > 0 ? { mentions: doc.mentions } : {}),
        },
        getToken,
      );
      inputRef.current.clear();
      setHasText(false);
      uploader.reset();
      setNotice(null);
    } catch {
      setError('Send failed. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-panel p-[11px]">
      <div
        ref={wrapRef}
        {...rootProps}
        className="relative flex flex-col gap-2 rounded-[11px] border border-border-strong bg-canvas px-3 py-[10px] transition-colors focus-within:border-primary focus-within:shadow-[var(--tp-focus-ring)]"
      >
        <AttachmentDragOverlay active={isDragActive} />
        <AttachmentThumbnails uploader={uploader} />
        <MentionableInput
          ref={inputRef}
          candidates={candidates}
          placeholder="Ask the Agent, or describe a change to the plan…"
          minHeight={34}
          maxHeight={280}
          className="text-[12.5px] leading-[1.45]"
          onSubmit={() => void submit()}
          onChange={(doc) => setHasText(doc.text.length > 0)}
        />
        <div className="flex items-center gap-2">
          <AttachmentAddButton uploader={uploader} disabled={sending} />
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
      {notice ? <p className="mt-2 px-1 text-xs text-warning">{notice}</p> : null}
      {error ? <p className="mt-2 px-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
