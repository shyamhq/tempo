'use client';

import { useQuery } from '@tanstack/react-query';
import type { AgentType } from '@tempo/contracts';
import { ArrowUp, Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AttachmentAddButton,
  AttachmentDragOverlay,
  AttachmentThumbnails,
  useAttachmentSurface,
} from '@/components/thread/attachments/attachment-tray';
import type { MentionableInputRef } from '@/components/thread/mention/mentionable-input';
import { MentionableInput } from '@/components/thread/mention/mentionable-input';
import { useMentionCandidates } from '@/components/thread/mention/use-mention-candidates';
import { ThreadContextBar } from '@/components/thread/thread-context-bar';
import { useAttachmentUploader } from '@/hooks/use-attachment-uploader';
import { useWorkerApi } from '@/hooks/use-worker-api';
import { api } from '@/lib/api-client';

const SENT_DWELL_MS = 1200;

type Phase = 'idle' | 'sending' | 'sent';

export function MessageComposer({
  threadId,
  agentType,
  autoFocus,
}: {
  threadId: string;
  agentType: AgentType;
  autoFocus: boolean;
}) {
  const wApi = useWorkerApi();
  const [phase, setPhase] = useState<Phase>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [hasText, setHasText] = useState(false);

  // Repos are a Hosted-only concern (they gate the VM). Local threads never show
  // the context bar and always send an empty list.
  const isHosted = agentType === 'hosted';
  // Thread repos — fetched from the dedicated thin route; invalidated by
  // repo_linked SSE events via useThreadEvents. Starts empty while loading.
  const threadRepos = useQuery({
    queryKey: ['thread-repos', threadId],
    queryFn: () => api.getThreadRepos(threadId),
    staleTime: 30_000,
    enabled: isHosted,
  });
  // Draft repo list the composer will send. Seeded from the server value and
  // re-seeded whenever it changes (initial load, or a repo_linked invalidation
  // refetch) by adjusting state during render — the canonical alternative to a
  // sync-on-effect (react.dev "You Might Not Need an Effect"). Keyed by the
  // serialized server list so an external change wins while a local edit between
  // refetches is preserved.
  const serverRepos = threadRepos.data?.repos ?? [];
  const serverReposKey = serverRepos.join('\n');
  const [repos, setRepos] = useState<string[]>(serverRepos);
  const [seenServerKey, setSeenServerKey] = useState(serverReposKey);
  if (serverReposKey !== seenServerKey) {
    setSeenServerKey(serverReposKey);
    setRepos(serverRepos);
  }

  // inputRef gives imperative access (focus / clear / serialise) to the
  // contenteditable inside MentionableInput.
  const inputRef = useRef<MentionableInputRef>(null);
  // wrapRef is the outer card div; useAttachmentSurface attaches paste + drag
  // listeners to it so images pasted anywhere on the card are captured.
  const wrapRef = useRef<HTMLDivElement>(null);

  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploader = useAttachmentUploader(threadId);
  const candidates = useMentionCandidates();
  const { rootProps, isDragActive } = useAttachmentSurface(uploader, wrapRef);

  useEffect(() => {
    return () => {
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
    };
  }, []);

  const canSend =
    phase !== 'sending' && (hasText || uploader.readyIds.length > 0) && !uploader.hasUploading;

  const send = async () => {
    if (!canSend || !inputRef.current) return;
    const doc = inputRef.current.serialise();
    if (doc.text.length === 0 && uploader.readyIds.length === 0) return;
    setPhase('sending');
    setSendError(null);
    try {
      await wApi.postDiscussionMessage(threadId, {
        ...(doc.text.length > 0 ? { text: doc.text } : {}),
        attachments: uploader.readyIds,
        ...(doc.mentions.length > 0 ? { mentions: doc.mentions } : {}),
        // Hosted only: always include repos so the server can diff against
        // threads.repos and emit repo_linked even when the Dev removes all repos
        // (empty array). Local threads never attach repos.
        ...(isHosted ? { repos } : {}),
      });
      inputRef.current.clear();
      setHasText(false);
      uploader.reset();
      setPhase('sent');
      inputRef.current.focus();
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
      sentTimerRef.current = setTimeout(() => setPhase('idle'), SENT_DWELL_MS);
    } catch {
      setSendError('Send failed. Try again.');
      setPhase('idle');
    }
  };

  return (
    <div className="bg-canvas px-4 pt-2 pb-3">
      <div
        ref={wrapRef}
        {...rootProps}
        className="relative flex flex-col gap-2 rounded-t-xl border border-b-0 border-hairline-strong bg-surface-1 px-3 pt-2 pb-1.5 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15"
      >
        <AttachmentDragOverlay active={isDragActive} />
        <AttachmentThumbnails uploader={uploader} />
        <MentionableInput
          ref={inputRef}
          placeholder="Ask about the approach — anything not tied to a line of the Plan."
          autoFocus={autoFocus}
          candidates={candidates}
          minHeight={66}
          maxHeight={280}
          onSubmit={() => void send()}
          onChange={(doc) => setHasText(doc.text.length > 0)}
        />
        <div className="flex items-center justify-between">
          <AttachmentAddButton uploader={uploader} />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={phase === 'sent' ? 'Sent' : 'Send'}
            className={`inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors ${
              phase === 'sent'
                ? 'bg-accent/10 text-accent-deep'
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
      </div>

      {/* Thread-context bar — Hosted only (repos gate the VM); below the
          composer, thread-scoped. */}
      {isHosted ? (
        <ThreadContextBar repos={repos} onReposChange={setRepos} disabled={phase === 'sending'} />
      ) : null}

      {sendError ? (
        <p className="mt-2 px-1 text-micro font-normal text-danger">{sendError}</p>
      ) : null}
    </div>
  );
}
