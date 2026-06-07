'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { ArrowLeft, Check, GitBranch, Loader2, RefreshCcw, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { z } from 'zod';
import { ActivityWidget } from '@/components/thread/activity-widget';
import { ConnectButton } from '@/components/thread/connect-button';
import { DiscussionButton } from '@/components/thread/discussion/discussion-button';
import { DiscussionPanel } from '@/components/thread/discussion/discussion-panel';
import { PlanCommentGutter } from '@/components/thread/editor/plan-comment-gutter';
import { PlanEditor, type PlanEditorHandle } from '@/components/thread/editor/plan-editor';
import { type SaveStatus, usePlanAutoSave } from '@/components/thread/editor/use-plan-auto-save';
import { HandoffBanner } from '@/components/thread/handoff-banner';
import { SessionPill } from '@/components/thread/pills';
import { RecheckPlanButton } from '@/components/thread/recheck-plan-button';
import { Button } from '@/components/ui/button';
import { useThreadEvents } from '@/hooks/use-thread-events';
import { api } from '@/lib/api-client';

type View = z.infer<typeof GetThreadResponse>;

const DEFAULT_DISCUSSION_WIDTH = 360;
const MIN_DISCUSSION_WIDTH = 320;
const MAX_DISCUSSION_WIDTH = 720;
const DISCUSSION_WIDTH_STORAGE = 'tempo:discussion_width';
const SAVED_PILL_FADE_MS = 2000;

function clampWidth(w: number): number {
  return Math.max(MIN_DISCUSSION_WIDTH, Math.min(MAX_DISCUSSION_WIDTH, Math.round(w)));
}

export function ThreadView({ threadId, initial }: { threadId: string; initial: View }) {
  const qc = useQueryClient();
  const { data } = useQuery<View>({
    queryKey: ['thread', threadId],
    queryFn: () => api.getThread(threadId),
    initialData: initial,
    staleTime: 30_000,
  });

  const [editorHandle, setEditorHandle] = useState<PlanEditorHandle | null>(null);
  const planColumnRef = useRef<HTMLDivElement>(null);
  const [planUpdatedAt, setPlanUpdatedAt] = useState<number | null>(null);
  const [discussionOpen, setDiscussionOpen] = useState(initial.plan.body === null);
  const [discussionSeenAt, setDiscussionSeenAt] = useState<string | null>(null);
  const [discussionWidth, setDiscussionWidth] = useState(DEFAULT_DISCUSSION_WIDTH);

  // `pmJsonApplied` doubles as the "first apply happened" gate. It controls
  // editor visibility (kept hidden during the two-step init to avoid an
  // empty-doc flash) and short-circuits the initial-load effect once the
  // SSE callback has already pushed content into the editor.
  const [pmJsonApplied, setPmJsonApplied] = useState(false);
  const editorHandleRef = useRef<PlanEditorHandle | null>(null);
  editorHandleRef.current = editorHandle;

  // Agent live-reload runs imperatively: refetch the thread, then push the
  // fresh pm_json into the editor. Decoupling "apply pm_json to the editor"
  // from "pm_json reference changed in the cache" is the load-bearing fix
  // — Dev auto-saves and bridge invalidates no longer reach the live editor,
  // so they can't wipe selection mid-`setMark` from a comment-create.
  useThreadEvents(threadId, data?.last_event_id ?? initial.last_event_id, async () => {
    setPlanUpdatedAt(Date.now());
    await qc.refetchQueries({ queryKey: ['thread', threadId] });
    const fresh = qc.getQueryData<View>(['thread', threadId]);
    const pmJson = fresh?.plan.body?.pm_json;
    if (pmJson != null && editorHandleRef.current) {
      editorHandleRef.current.applyPmJson(pmJson);
      setPmJsonApplied(true);
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDiscussionSeenAt(window.localStorage.getItem(`tempo:thread:${threadId}:discussion_seen_at`));
  }, [threadId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(DISCUSSION_WIDTH_STORAGE);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    if (Number.isFinite(parsed)) setDiscussionWidth(clampWidth(parsed));
  }, []);

  const widthPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (widthPersistTimer.current) clearTimeout(widthPersistTimer.current);
    },
    [],
  );
  const persistDiscussionWidth = useCallback((w: number) => {
    const clamped = clampWidth(w);
    setDiscussionWidth(clamped);
    if (typeof window === 'undefined') return;
    if (widthPersistTimer.current) clearTimeout(widthPersistTimer.current);
    widthPersistTimer.current = setTimeout(() => {
      window.localStorage.setItem(DISCUSSION_WIDTH_STORAGE, String(clamped));
    }, 200);
  }, []);

  useEffect(() => {
    if (planUpdatedAt === null) return;
    const t = setTimeout(() => setPlanUpdatedAt(null), 3500);
    return () => clearTimeout(t);
  }, [planUpdatedAt]);

  const view = data ?? initial;
  const approved = view.status === 'approved';

  const persistPmJson = useCallback(
    async (pmJson: unknown) => {
      qc.setQueryData<View>(['thread', threadId], (prev) =>
        prev?.plan.body
          ? { ...prev, plan: { ...prev.plan, body: { ...prev.plan.body, pm_json: pmJson } } }
          : prev,
      );
      try {
        await api.writePlan(threadId, { pm_json: pmJson });
      } catch (e) {
        qc.invalidateQueries({ queryKey: ['thread', threadId] });
        throw e;
      }
    },
    [threadId, qc],
  );

  const unloadBeacon = useCallback(
    (pmJson: unknown) => {
      // keepalive=true lets the request survive page unload. 64 KB body cap
      // per origin is the trade-off — Chrome silently drops keepalive
      // requests that exceed it. PM JSON is ~50% larger than blocks JSON, so
      // check the serialised size and skip the beacon for oversized plans.
      // The regular auto-save path (no keepalive) has no cap; an in-flight
      // save may still survive unload on some browsers.
      const body = JSON.stringify({ pm_json: pmJson });
      if (body.length > 60_000) return;
      fetch(`/api/threads/${threadId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tempo-Dev': '1' },
        body,
        keepalive: true,
      }).catch(() => {});
    },
    [threadId],
  );

  // The hook reads `getPmJson` through a ref it refreshes on every render,
  // so memoising here would only add noise without adding identity stability.
  const {
    status: saveStatus,
    lastSavedAt,
    notifyEdit,
  } = usePlanAutoSave({
    getPmJson: () => editorHandle?.getPmJson() ?? null,
    persist: persistPmJson,
    unloadBeacon,
    readOnly: approved,
  });

  // Initial load — one-shot when the editor handle becomes available. Reads
  // pm_json from the server-rendered `initial` prop (stable across renders),
  // NOT from `view.plan.body.pm_json` — the latter re-evaluates on every
  // refetch and would re-fire the apply on every cache refresh. If the SSE
  // callback already applied first (the SSR-empty + Agent-drafts case),
  // `pmJsonApplied` short-circuits this so we don't double-apply.
  useEffect(() => {
    if (!editorHandle || pmJsonApplied) return;
    const pmJson = initial.plan.body?.pm_json ?? null;
    if (pmJson === null) return;
    editorHandle.applyPmJson(pmJson);
    setPmJsonApplied(true);
  }, [editorHandle, initial, pmJsonApplied]);

  const approve = async () => {
    await api.approveThread(threadId);
  };
  const reopen = async () => {
    await api.reopenThread(threadId);
  };

  const getPlanMarkdown = useCallback(async (): Promise<string> => {
    if (!editorHandle) return '';
    return editorHandle.toMarkdown();
  }, [editorHandle]);

  const unreadCount = useMemo(() => {
    if (discussionOpen) return 0;
    if (!discussionSeenAt) {
      return view.discussion.messages.filter((m) => m.author === 'agent').length;
    }
    return view.discussion.messages.filter(
      (m) => m.author === 'agent' && m.created_at > discussionSeenAt,
    ).length;
  }, [view.discussion.messages, discussionSeenAt, discussionOpen]);

  const openDiscussion = useCallback(() => setDiscussionOpen(true), []);
  const closeDiscussion = useCallback(() => {
    const y = window.scrollY;
    setDiscussionOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }, []);
  const markOpened = useCallback(() => {
    if (typeof window === 'undefined') return;
    const now = new Date().toISOString();
    window.localStorage.setItem(`tempo:thread:${threadId}:discussion_seen_at`, now);
    setDiscussionSeenAt(now);
  }, [threadId]);

  const gridClass = discussionOpen
    ? 'grid-cols-[var(--discussion-w)_1fr]'
    : 'grid-cols-1';
  const gridStyle = discussionOpen
    ? ({ ['--discussion-w' as string]: `${discussionWidth}px` } as CSSProperties)
    : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setDiscussionOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-6 h-14 flex items-center gap-3">
          <Link href="/" className="text-ink-subtle hover:text-ink" aria-label="Back to Threads">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-display text-sm font-semibold truncate">{view.thread.title}</h1>
            {approved ? null : <PlanSaveStatus status={saveStatus} lastSavedAt={lastSavedAt} />}
          </div>
          <div className="flex-1" />
          <SessionPill status={view.session_status} />
          <RepoChip remote={view.attached_repo_remote} path={view.attached_repo_path} />
          <div className="w-px h-5 bg-hairline mx-1" />
          {approved ? null : (
            <RecheckPlanButton threadId={threadId} sessionStatus={view.session_status} />
          )}
          <ConnectButton threadId={threadId} />
          {approved ? (
            <Button variant="ghost" onClick={reopen}>
              Reopen
            </Button>
          ) : (
            <Button variant="primary" onClick={approve}>
              Approve
            </Button>
          )}
        </div>
      </header>

      <div className={`mx-auto max-w-[1600px] px-6 py-6 grid gap-6 ${gridClass}`} style={gridStyle}>
        {discussionOpen ? (
          <aside className="h-[calc(100dvh-3.5rem-3rem)] sticky top-[calc(3.5rem+1.5rem)]">
            <DiscussionPanel
              threadId={threadId}
              messages={view.discussion.messages}
              approved={approved}
              sessionStatus={view.session_status}
              width={discussionWidth}
              minWidth={MIN_DISCUSSION_WIDTH}
              maxWidth={MAX_DISCUSSION_WIDTH}
              onWidthChange={persistDiscussionWidth}
              onClose={closeDiscussion}
              onOpened={markOpened}
            />
          </aside>
        ) : null}

        <section>
          {approved ? <HandoffBanner getPlanMarkdown={getPlanMarkdown} /> : null}
          {view.plan.body === null ? (
            <EmptyPlanState />
          ) : (
            <div
              className={`rounded-md transition-shadow duration-700 ${
                planUpdatedAt ? 'ring-2 ring-accent/40' : 'ring-0'
              }`}
            >
              <div ref={planColumnRef} className="flex items-start">
                {/* The editor is mounted unconditionally so onReady can fire
                    and we can call applyPmJson — but we hide it visually until
                    the initial PM JSON has been applied. Avoids the empty-doc
                    flash that would otherwise appear during the two-step init. */}
                <div className={`flex-1 min-w-0 ${pmJsonApplied ? '' : 'invisible'}`}>
                  <PlanEditor
                    threadId={threadId}
                    comments={view.comments}
                    onUserEdit={notifyEdit}
                    onReady={setEditorHandle}
                    readOnly={approved}
                  />
                </div>
                {pmJsonApplied ? (
                  <PlanCommentGutter
                    comments={view.comments}
                    editorHandle={editorHandle}
                    anchorRef={planColumnRef}
                  />
                ) : null}
              </div>
              {pmJsonApplied ? null : <EmptyPlanState />}
            </div>
          )}
        </section>

        <ActivityWidget threadId={threadId} />
      </div>

      {planUpdatedAt ? (
        <div
          key={planUpdatedAt}
          className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full border border-accent/40 bg-accent text-on-accent px-4 py-2 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <Sparkles className="h-4 w-4" />
          Plan updated by Agent
        </div>
      ) : null}

      <DiscussionButton open={discussionOpen} unreadCount={unreadCount} onClick={openDiscussion} />
    </div>
  );
}

function PlanSaveStatus({
  status,
  lastSavedAt,
}: {
  status: SaveStatus;
  lastSavedAt: number | null;
}) {
  // Briefly show "Saved" after a successful write, then fade to invisible.
  // The hook stays in 'saved' until the next edit; we add a local fade
  // timer so the pill isn't permanently visible after one save.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (status !== 'saved' || lastSavedAt === null) {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), SAVED_PILL_FADE_MS);
    return () => clearTimeout(t);
  }, [status, lastSavedAt]);

  if (status === 'idle') return null;
  if (status === 'saved' && !showSaved) return null;

  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption text-ink-subtle tabular-nums">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption text-ink-subtle tabular-nums">
        <Check className="h-3 w-3 text-success" aria-hidden />
        Saved
      </span>
    );
  }
  // error
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-danger tabular-nums">
      <RefreshCcw className="h-3 w-3 animate-spin" aria-hidden />
      Save failed — retrying
    </span>
  );
}

function EmptyPlanState() {
  return (
    <div className="border border-dashed border-hairline rounded-md p-6 text-center">
      <p className="text-sm text-ink-subtle">
        The Agent hasn't drafted a Plan yet. When it does, edits appear here live.
      </p>
    </div>
  );
}

function RepoChip({ remote, path }: { remote: string | null; path: string | null }) {
  if (!remote && !path) return null;
  const label = remote ? shortRemote(remote) : (path ?? '');
  const title = [remote, path].filter(Boolean).join(' — ');
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 text-xs text-ink-subtle px-2 py-0.5 rounded border border-hairline max-w-[16rem] truncate"
    >
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function shortRemote(remote: string): string {
  try {
    const u = new URL(remote);
    const seg = u.pathname.replace(/^\/+|\.git$/g, '');
    return seg || u.hostname;
  } catch {
    return remote;
  }
}
