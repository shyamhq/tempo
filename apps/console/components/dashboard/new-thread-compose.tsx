'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { Space } from '@tempo/contracts';
import { Bug, Check, Copy, RefreshCcw, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttachmentAddButton,
  AttachmentDragOverlay,
  AttachmentThumbnails,
  useAttachmentSurface,
} from '@/components/thread/attachments/attachment-tray';
import type { PendingAttachment } from '@/hooks/use-attachment-uploader';
import { ApiError, api } from '@/lib/api-client';

type Phase =
  | { kind: 'compose' }
  | { kind: 'submitting' }
  | { kind: 'created'; threadId: string; connectCmd: string };

const CHIPS: { label: string; lead: string; Icon: typeof Sparkles }[] = [
  { label: 'Add a feature', lead: 'Add a new feature: ', Icon: Sparkles },
  { label: 'Fix a bug', lead: 'Fix a bug where ', Icon: Bug },
  { label: 'Refactor', lead: 'Refactor ', Icon: RefreshCcw },
  { label: 'Investigate', lead: 'Investigate why ', Icon: Search },
];

// Compose lives before any Thread exists. Bytes stay in the browser as
// blob: URLs until submit; the upload pass runs inside `submit()` after
// the Thread has been created so /init can resolve its thread_id.
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_MIMES)[number];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 8;

type Pending = {
  clientId: string;
  file: File;
  localUrl: string;
  mime: AllowedMime;
  byteLen: number;
};

function isAllowedMime(m: string): m is AllowedMime {
  return (ALLOWED_MIMES as readonly string[]).includes(m);
}

function pendingClientId() {
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function NewThreadCompose({ space }: { space: Space }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'compose' });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track every blob: URL we mint so revoke runs on remove and on unmount.
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    };
  }, []);

  const addPending = useCallback(async (files: File[]): Promise<void> => {
    // Mint blob URLs and build the claim list outside `setPending` so a
    // double-invoked updater (React strict mode / concurrent rendering)
    // can't leave orphaned blob URLs that the ref never sees.
    const claim: Pending[] = [];
    for (const f of files) {
      if (!isAllowedMime(f.type)) continue;
      if (f.size > MAX_BYTES) continue;
      const clientId = pendingClientId();
      const localUrl = URL.createObjectURL(f);
      blobUrlsRef.current.set(clientId, localUrl);
      claim.push({ clientId, file: f, localUrl, mime: f.type, byteLen: f.size });
    }
    if (claim.length === 0) return;
    setPending((prev) => {
      const slotsLeft = MAX_FILES - prev.length;
      const accepted = claim.slice(0, Math.max(slotsLeft, 0));
      // Revoke anything that didn't fit so we don't leak.
      for (const c of claim.slice(accepted.length)) {
        URL.revokeObjectURL(c.localUrl);
        blobUrlsRef.current.delete(c.clientId);
      }
      return [...prev, ...accepted];
    });
  }, []);

  const removePending = useCallback((clientId: string) => {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
    const url = blobUrlsRef.current.get(clientId);
    if (url) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(clientId);
    }
  }, []);

  // Stable identity so `useAttachmentSurface`'s paste/drop listeners don't
  // re-bind every render. The shim presents the trio the sub-components
  // read; the composer reads `pending` directly for the submit gate.
  const uploaderShim = useMemo(
    () => ({
      items: pending.map(
        (p): PendingAttachment => ({
          clientId: p.clientId,
          serverId: null,
          file: p.file,
          localUrl: p.localUrl,
          mime: p.mime,
          byteLen: p.byteLen,
          status: 'ready' as const,
        }),
      ),
      addFiles: addPending,
      remove: removePending,
    }),
    [pending, addPending, removePending],
  );

  const { rootProps, isDragActive } = useAttachmentSurface(
    uploaderShim,
    textareaRef,
    phase.kind === 'submitting',
  );

  const trimmed = text.trim();
  const isSubmitting = phase.kind === 'submitting';
  const canSubmit = trimmed.length > 0 && phase.kind === 'compose';

  const submit = async () => {
    if (!canSubmit) return;
    setPhase({ kind: 'submitting' });
    setError(null);
    try {
      const res = await api.createThread({
        title: 'Untitled thread',
        description: '',
        space_id: space.id,
      });
      // Sequential init + PUT per pending file. All-or-nothing for v1:
      // a failure here surfaces as the same error toast as a failed
      // createThread, leaving an orphan Thread with no message — the
      // existing two-step orphan pattern, not worsened.
      const attachmentIds: string[] = [];
      for (const p of pending) {
        const init = await api.initAttachment(res.thread.id, {
          mime: p.mime,
          byte_len: p.byteLen,
        });
        const putRes = await fetch(init.put_url, {
          method: 'PUT',
          headers: { 'Content-Type': p.mime },
          body: p.file,
        });
        if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`);
        attachmentIds.push(init.id);
      }
      await api.postDiscussionMessage(res.thread.id, {
        text: trimmed,
        attachments: attachmentIds,
      });
      qc.invalidateQueries({ queryKey: ['space-threads', space.id] });
      qc.invalidateQueries({ queryKey: ['spaces'] });
      setPhase({
        kind: 'created',
        threadId: res.thread.id,
        connectCmd: `npx tempo-agent connect ${res.connect_token}`,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create Thread.');
      setPhase({ kind: 'compose' });
    }
  };

  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const prefill = (lead: string) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, 0);
    // execCommand is the only API that participates in the textarea's native undo
    // stack across Chromium/Firefox/WebKit, so Ctrl/Cmd+Z reverts the chip insert.
    // The synthetic input event it fires flows through onChange to update `text`.
    document.execCommand('insertText', false, lead);
  };

  const copy = async () => {
    if (phase.kind !== 'created') return;
    await navigator.clipboard.writeText(phase.connectCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col h-full bg-canvas">
      <header className="flex-none h-[53px] flex items-center justify-between px-[22px] border-b border-hairline">
        <div className="flex items-center gap-[9px] text-body-sm font-medium text-ink-muted">
          <span className="flex items-center justify-center size-icon-lg rounded-sm bg-accent/15 text-accent text-micro font-bold">
            T
          </span>
          <span>Tempo</span>
          <span className="text-hairline-strong">/</span>
          <span className="font-normal text-ink-tertiary">New thread</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-caption text-ink-tertiary">{space.name}</span>
          <Link
            href={`/?space=${space.id}`}
            className="text-caption text-ink-subtle hover:text-ink"
          >
            Cancel
          </Link>
        </div>
      </header>

      <section className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center px-6 pt-10 pb-16">
        <div className="w-full max-w-[680px] flex flex-col items-center">
          <div className="flex items-center gap-[7px] font-mono text-micro tracking-mono-display uppercase text-ink-tertiary mb-4">
            <Sparkles className="size-icon-xs text-accent-deep" strokeWidth={1.6} />
            New thread
          </div>
          <h1 className="text-[clamp(28px,4vw,40px)] font-semibold tracking-tight text-ink text-center leading-[1.08] mb-3">
            What do you want to plan?
          </h1>
          <p className="text-body-md text-ink-tertiary leading-[1.6] text-center max-w-[46ch] mb-7">
            Describe the change. The Agent reads your codebase and drafts a Plan you can edit
            together before anything runs.
          </p>

          {phase.kind === 'created' ? (
            <CreatedCard
              connectCmd={phase.connectCmd}
              copied={copied}
              onCopy={copy}
              spaceId={space.id}
              onOpen={() => router.push(`/threads/${phase.threadId}`)}
            />
          ) : (
            <>
              <div
                {...rootProps}
                className="relative w-full bg-canvas border border-hairline rounded-xl shadow-compose transition focus-within:border-accent focus-within:shadow-focus-soft overflow-hidden"
              >
                <AttachmentDragOverlay active={isDragActive} />
                {pending.length > 0 ? (
                  <div className="px-5 pt-5">
                    <AttachmentThumbnails uploader={uploaderShim} />
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onTextareaKeyDown}
                  placeholder="Describe the change you want to plan…"
                  disabled={isSubmitting}
                  className="block w-full min-h-[132px] max-h-[280px] px-5 pt-5 pb-2 text-body-md leading-[1.6] text-ink placeholder:text-ink-tertiary bg-transparent border-0 resize-none focus:outline-none disabled:cursor-not-allowed"
                />
                <div className="flex items-center justify-between px-3 pb-3">
                  <AttachmentAddButton uploader={uploaderShim} disabled={isSubmitting} />
                  <StartButton
                    state={canSubmit ? 'on' : isSubmitting ? 'submitting' : 'off'}
                    onClick={submit}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-center mt-[18px]">
                {CHIPS.map(({ label, lead, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => prefill(lead)}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-[7px] px-3 py-1.5 rounded-full border border-hairline bg-canvas text-caption text-ink-subtle hover:bg-surface-2 hover:border-hairline-strong transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon className="h-[14px] w-[14px] text-ink-tertiary" strokeWidth={1.9} />
                    {label}
                  </button>
                ))}
              </div>

              <p className="flex items-center gap-[7px] justify-center mt-[18px] text-micro font-normal text-ink-tertiary">
                <Kbd>↵</Kbd>
                <span>to start</span>
                <span className="text-hairline-strong">·</span>
                <Kbd>⇧</Kbd>
                <Kbd>↵</Kbd>
                <span>for newline</span>
              </p>

              {error ? (
                <p className="mt-4 text-xs text-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StartButton({
  state,
  onClick,
}: {
  state: 'off' | 'on' | 'submitting';
  onClick: () => void;
}) {
  const isOn = state === 'on';
  const isSubmitting = state === 'submitting';
  const base =
    'inline-flex items-center gap-[9px] h-[38px] px-3.5 rounded-md text-body-sm font-semibold transition';
  if (isSubmitting) {
    return (
      <button type="button" disabled className={`${base} bg-ink text-on-primary cursor-default`}>
        <span className="h-[14px] w-[14px] rounded-full border-2 border-on-primary/35 border-t-on-primary animate-spin" />
        Starting…
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isOn}
      className={`${base} ${
        isOn
          ? 'bg-ink text-on-primary hover:bg-ink-muted cursor-pointer'
          : 'bg-surface-2 text-ink-tertiary cursor-default'
      }`}
    >
      Start thread
      <span
        className={`font-mono text-micro leading-none px-[5px] py-[3px] rounded-xs ${
          isOn
            ? 'bg-on-primary/15 text-on-primary'
            : 'bg-canvas border border-hairline text-ink-tertiary'
        }`}
      >
        ↵
      </span>
    </button>
  );
}

function CreatedCard({
  connectCmd,
  copied,
  onCopy,
  spaceId,
  onOpen,
}: {
  connectCmd: string;
  copied: boolean;
  onCopy: () => void;
  spaceId: string;
  onOpen: () => void;
}) {
  return (
    <div className="w-full bg-canvas border border-hairline rounded-xl shadow-compose p-6 text-left">
      <h2 className="text-body-md font-semibold text-ink">
        Thread created — connect the Agent to start
      </h2>
      <p className="text-caption text-ink-tertiary mt-1">
        Run this in your repo. The Agent will pick up your first message and start drafting.
      </p>
      <div className="mt-4 rounded-md border border-hairline bg-surface-2 p-3 font-mono text-xs text-ink break-all flex items-start gap-2">
        <span className="flex-1">{connectCmd}</span>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 text-ink-subtle hover:text-ink"
          aria-label="Copy connect command"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Link
          href={`/?space=${spaceId}`}
          className="inline-flex items-center justify-center h-[38px] px-3.5 rounded-md text-body-sm font-semibold border border-hairline text-ink hover:bg-surface-2"
        >
          Close
        </Link>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center h-[38px] px-3.5 rounded-md text-body-sm font-semibold bg-ink text-on-primary hover:bg-ink-muted"
        >
          Open Thread
        </button>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center font-mono text-micro px-[5px] py-[2px] rounded-xs bg-surface-2 border border-hairline text-ink-subtle">
      {children}
    </span>
  );
}
