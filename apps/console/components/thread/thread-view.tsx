'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetThreadResponse } from '@tempo/contracts/http';
import type { Editor } from '@tiptap/core';
import { ArrowLeft, GitBranch, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { z } from 'zod';
import { CommentsRail } from '@/components/thread/comments-rail';
import { ConnectButton } from '@/components/thread/connect-button';
import { DiscussionButton } from '@/components/thread/discussion/discussion-button';
import { DiscussionPanel } from '@/components/thread/discussion/discussion-panel';
import { PlanEditor } from '@/components/thread/editor/editor';
import { HandoffBanner } from '@/components/thread/handoff-banner';
import { SessionPill } from '@/components/thread/pills';
import { Button } from '@/components/ui/button';
import { useLatestToolFeed, useThreadEvents } from '@/hooks/use-thread-events';
import { api } from '@/lib/api-client';

type View = z.infer<typeof GetThreadResponse>;

const DEFAULT_DISCUSSION_WIDTH = 360;
const MIN_DISCUSSION_WIDTH = 320;
const MAX_DISCUSSION_WIDTH = 720;
const DISCUSSION_WIDTH_STORAGE = 'tempo:discussion_width';

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

  const [editor, setEditor] = useState<Editor | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [planUpdatedAt, setPlanUpdatedAt] = useState<number | null>(null);
  const [userOpenedDiscussion, setUserOpenedDiscussion] = useState(false);
  const [discussionSeenAt, setDiscussionSeenAt] = useState<string | null>(null);
  const [discussionWidth, setDiscussionWidth] = useState(DEFAULT_DISCUSSION_WIDTH);

  useThreadEvents(threadId, data?.last_event_id ?? initial.last_event_id, () =>
    setPlanUpdatedAt(Date.now()),
  );

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

  // Debounce the localStorage write — pointermove fires ~60×/s during a drag;
  // committing the final value at ~5Hz keeps state live while sparing the disk.
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
  const markdown = view.plan.body?.markdown ?? '';

  const onSave = useCallback(
    async (md: string) => {
      // Optimistic local update — server will emit plan_edited_by_dev and the
      // SSE hook reconciles by invalidating (D6 last-write-wins).
      qc.setQueryData<View>(['thread', threadId], (prev) =>
        prev && prev.plan.body
          ? {
              ...prev,
              plan: {
                ...prev.plan,
                body: { ...prev.plan.body, markdown: md },
              },
            }
          : prev,
      );
      try {
        await api.writePlan(threadId, { markdown: md });
      } catch {
        qc.invalidateQueries({ queryKey: ['thread', threadId] });
      }
    },
    [threadId, qc],
  );

  const approve = async () => {
    await api.approveThread(threadId);
  };
  const reopen = async () => {
    await api.reopenThread(threadId);
  };

  const approved = view.status === 'approved';

  const discussionOpen = userOpenedDiscussion;

  const unreadCount = useMemo(() => {
    if (discussionOpen) return 0;
    if (!discussionSeenAt) {
      return view.discussion.messages.filter((m) => m.author === 'agent').length;
    }
    return view.discussion.messages.filter(
      (m) => m.author === 'agent' && m.created_at > discussionSeenAt,
    ).length;
  }, [view.discussion.messages, discussionSeenAt, discussionOpen]);

  const openDiscussion = useCallback(() => setUserOpenedDiscussion(true), []);
  const closeDiscussion = useCallback(() => setUserOpenedDiscussion(false), []);
  const markOpened = useCallback(() => {
    if (typeof window === 'undefined') return;
    const now = new Date().toISOString();
    window.localStorage.setItem(`tempo:thread:${threadId}:discussion_seen_at`, now);
    setDiscussionSeenAt(now);
  }, [threadId]);

  const gridClass = discussionOpen
    ? 'grid-cols-[var(--discussion-w)_1fr] 2xl:grid-cols-[var(--discussion-w)_1fr_360px]'
    : 'grid-cols-1 lg:grid-cols-[1fr_360px]';
  const gridStyle = discussionOpen
    ? ({ ['--discussion-w' as string]: `${discussionWidth}px` } as CSSProperties)
    : undefined;

  // ⌘/ toggles the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setUserOpenedDiscussion((v) => !v);
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
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-sm font-semibold truncate">{view.thread.title}</h1>
          </div>
          <SessionPill status={view.session_status} />
          <RepoChip remote={view.attached_repo_remote} path={view.attached_repo_path} />
          <div className="w-px h-5 bg-hairline mx-1" />
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
          {approved ? <HandoffBanner planMarkdown={markdown} /> : null}
          {view.plan.body === null ? (
            <EmptyPlanState threadId={threadId} />
          ) : (
            <div
              className={`rounded-md transition-shadow duration-700 ${
                planUpdatedAt ? 'ring-2 ring-accent/40' : 'ring-0'
              }`}
            >
              <PlanEditor
                markdown={markdown}
                comments={view.comments}
                showResolved={showResolved}
                focusedCommentId={focusedCommentId}
                onSave={onSave}
                onFocusComment={setFocusedCommentId}
                onEditorReady={setEditor}
                readOnly={approved}
              />
            </div>
          )}
        </section>

        {/* Comments rail visible at all viewports when Discussion is closed; on
            ≥1600px it stays visible alongside an open Discussion. */}
        <aside className={`self-start ${discussionOpen ? 'hidden 2xl:block' : ''}`}>
          <CommentsRail
            threadId={threadId}
            comments={view.comments}
            editor={editor}
            showResolved={showResolved}
            onShowResolvedChange={setShowResolved}
            focusedCommentId={focusedCommentId}
            onFocusChange={setFocusedCommentId}
          />
        </aside>
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

function EmptyPlanState({ threadId }: { threadId: string }) {
  const latest = useLatestToolFeed(threadId);
  return (
    <div className="border border-dashed border-hairline rounded-md p-6 text-center">
      <p className="text-sm text-ink-subtle">
        The Agent hasn't drafted a Plan yet. When it does, edits appear here live.
      </p>
      {latest ? (
        <p className="mt-3 text-sm text-ink-subtle flex gap-2 items-center justify-center">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span className="text-ink font-medium shrink-0">{latest.tool}</span>
          {latest.summary ? <span className="truncate max-w-[28rem]">{latest.summary}</span> : null}
        </p>
      ) : null}
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
