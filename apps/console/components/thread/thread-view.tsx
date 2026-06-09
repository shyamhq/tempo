'use client';

import { CommentsExtension } from '@blocknote/core/comments';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionStatus } from '@tempo/contracts';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { ArrowLeft, Check, GitBranch, Loader2, RefreshCcw, Sparkles, X } from 'lucide-react';
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
import { useCommentUi } from '@/store/comment-ui';

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
  const enlargedCommentId = useCommentUi((s) => s.enlargedCommentId);
  const activeRailTab = useCommentUi((s) => s.activeRailTab);
  const setPanelMount = useCommentUi((s) => s.setPanelMount);
  const setActiveRailTab = useCommentUi((s) => s.setActiveRailTab);
  const closeEnlarged = useCommentUi((s) => s.closeEnlarged);

  // Opening the Comment tab implies the rail must be visible. Watch the
  // store for the null → set transition and flip `discussionOpen` then.
  // `setEnlarged` is the sole writer of this transition; any new caller
  // inherits the "rail comes with you" coupling automatically.
  useEffect(
    () =>
      useCommentUi.subscribe((state, prev) => {
        if (state.enlargedCommentId !== null && prev.enlargedCommentId === null) {
          setDiscussionOpen(true);
        }
      }),
    [],
  );

  // The store is module-scoped — surviving SPA navigation between Threads
  // would leave the previous Thread's enlargedCommentId set, briefly
  // showing a Comment tab with no content before the auto-close guard
  // catches up. Reset on Thread switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: threadId is the change trigger
  useEffect(() => {
    useCommentUi.getState().closeEnlarged();
  }, [threadId]);

  // `pmJsonApplied` doubles as the "first apply happened" gate. It controls
  // editor visibility (kept hidden during the two-step init to avoid an
  // empty-doc flash) and short-circuits the initial-load effect once the
  // SSE callback has already pushed content into the editor. The ref mirrors
  // the state so the initial-load effect's guard is read synchronously,
  // independent of React's render cycle — a TanStack refetch that flips the
  // `view` reference in the same batch as the apply can no longer re-enter.
  const [pmJsonApplied, setPmJsonApplied] = useState(false);
  const pmJsonAppliedRef = useRef(false);
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
      pmJsonAppliedRef.current = true;
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

  // Initial load — one-shot when the editor handle and pm_json are both
  // available. Reads from the live `view` (current cache) so the SSR-empty
  // case still works: when the Agent drafts the first Plan, the editor only
  // mounts after the refetch lands, so the SSE callback's direct apply finds
  // a null `editorHandleRef` and skips. This effect picks up the slack.
  // `pmJsonAppliedRef` gates it to one apply synchronously, so a concurrent
  // `view` cache update can't slip through before the state setter renders.
  useEffect(() => {
    if (!editorHandle || pmJsonAppliedRef.current) return;
    const pmJson = view.plan.body?.pm_json ?? null;
    if (pmJson === null) return;
    editorHandle.applyPmJson(pmJson);
    pmJsonAppliedRef.current = true;
    setPmJsonApplied(true);
  }, [editorHandle, view]);

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
    // The plan-editor transition effect clears BlockNote's selectedThreadId
    // whenever enlargedCommentId flips to null. That covers the
    // rail-closed-with-comment-enlarged path. The marker-clicked-but-never-
    // enlarged path leaves selectedThreadId set in BlockNote with
    // enlargedCommentId already null — no transition would fire — so clear
    // directly only when there was nothing to transition.
    const wasEnlarged = useCommentUi.getState().enlargedCommentId !== null;
    useCommentUi.getState().closeEnlarged();
    if (!wasEnlarged) {
      editorHandle?.editor.getExtension(CommentsExtension)?.selectThread(undefined);
    }
    setDiscussionOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }, [editorHandle]);

  const markOpened = useCallback(() => {
    if (typeof window === 'undefined') return;
    const now = new Date().toISOString();
    window.localStorage.setItem(`tempo:thread:${threadId}:discussion_seen_at`, now);
    setDiscussionSeenAt(now);
  }, [threadId]);

  const gridClass = discussionOpen ? 'grid-cols-[var(--discussion-w)_1fr]' : 'grid-cols-1';
  const gridStyle = discussionOpen
    ? ({ ['--discussion-w' as string]: `${discussionWidth}px` } as CSSProperties)
    : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setDiscussionOpen((v) => !v);
        return;
      }
      // Escape closes the rail regardless of which tab is active. Used to
      // live inside DiscussionPanel, but that panel doesn't mount while the
      // Comment tab is showing — handler has to live one level up.
      if (e.key === 'Escape' && discussionOpen) {
        e.preventDefault();
        closeDiscussion();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [discussionOpen, closeDiscussion]);

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
          <aside className="-mt-6 h-[calc(100dvh-5rem)] sticky top-14 flex flex-col min-h-0 bg-canvas border-r border-hairline">
            <RailTabStrip
              activeTab={activeRailTab}
              // Selecting Discussion fully closes the Comment tab — keeping
              // both alive while the user reads Discussion leaves
              // `enlargedCommentId` set and resurrects the tab on the next
              // gutter click. One-tab-at-a-time was the original spec.
              onSelectDiscussion={closeEnlarged}
              onSelectComment={() => setActiveRailTab('comment')}
              onCloseCommentTab={closeEnlarged}
              showCommentTab={enlargedCommentId !== null}
              sessionStatus={view.session_status}
              onCloseRail={closeDiscussion}
            />
            <div className="flex-1 min-h-0">
              {activeRailTab === 'comment' && enlargedCommentId !== null ? (
                <div ref={setPanelMount} className="h-full overflow-hidden" />
              ) : (
                <DiscussionPanel
                  threadId={threadId}
                  messages={view.discussion.messages}
                  approved={approved}
                  width={discussionWidth}
                  minWidth={MIN_DISCUSSION_WIDTH}
                  maxWidth={MAX_DISCUSSION_WIDTH}
                  onWidthChange={persistDiscussionWidth}
                  onOpened={markOpened}
                />
              )}
            </div>
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
              <div ref={planColumnRef} data-plan-column className="flex items-start">
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

function RailTabStrip({
  activeTab,
  onSelectDiscussion,
  onSelectComment,
  onCloseCommentTab,
  showCommentTab,
  sessionStatus,
  onCloseRail,
}: {
  activeTab: 'discussion' | 'comment';
  onSelectDiscussion: () => void;
  onSelectComment: () => void;
  onCloseCommentTab: () => void;
  showCommentTab: boolean;
  sessionStatus: SessionStatus;
  onCloseRail: () => void;
}) {
  const baseTab =
    'inline-flex items-center gap-1.5 h-8 px-3 rounded-t-md text-caption font-medium border border-b-0 transition-colors';
  const inactive = 'border-transparent text-ink-subtle hover:text-ink';
  const active = 'border-hairline bg-canvas text-ink';
  const connected = sessionStatus === 'connected';
  return (
    <div className="flex items-end gap-1 px-2 pt-1 bg-surface-2 border-b border-hairline h-12">
      <button
        type="button"
        onClick={onSelectDiscussion}
        className={`${baseTab} ${activeTab === 'discussion' ? active : inactive}`}
      >
        Discussion
      </button>
      {showCommentTab ? (
        <div className={`${baseTab} ${activeTab === 'comment' ? active : inactive} pr-1`}>
          <button
            type="button"
            onClick={onSelectComment}
            className="inline-flex items-center gap-1.5"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(0,212,164,0.18)]"
            />
            Comment
          </button>
          <button
            type="button"
            onClick={onCloseCommentTab}
            aria-label="Close Comment tab"
            className="inline-flex items-center justify-center text-ink-tertiary hover:text-ink hover:bg-surface-3 rounded p-0.5 ml-1"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-2 pb-1.5 pr-1">
        <span
          className="inline-flex items-center gap-1.5 text-micro font-normal text-ink-subtle shrink-0"
          title={
            connected ? 'Agent connected' : 'Agent disconnected — messages deliver on reconnect'
          }
        >
          <span
            aria-hidden
            className={`inline-block h-[7px] w-[7px] rounded-full ${
              connected ? 'bg-accent shadow-[0_0_0_3px_rgba(0,212,164,0.16)]' : 'bg-ink-tertiary'
            }`}
          />
          {connected ? 'connected' : 'offline'}
        </span>
        <button
          type="button"
          onClick={onCloseRail}
          aria-label="Close rail"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-ink-subtle hover:text-ink hover:bg-surface-3 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
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
