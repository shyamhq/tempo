'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { ArrowLeft, GitBranch } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import type { z } from 'zod';
import { ClarificationModal } from '@/components/thread/clarification-modal';
import { CommentsRail } from '@/components/thread/comments-rail';
import { PlanEditor } from '@/components/thread/editor/editor';
import { HandoffBanner } from '@/components/thread/handoff-banner';
import { ActivityPill, SessionPill } from '@/components/thread/pills';
import { Button } from '@/components/ui/button';
import { useThreadEvents } from '@/hooks/use-thread-events';
import { api } from '@/lib/api-client';

type View = z.infer<typeof GetThreadResponse>;

export function ThreadView({ threadId, initial }: { threadId: string; initial: View }) {
  const qc = useQueryClient();
  const { data } = useQuery<View>({
    queryKey: ['thread', threadId],
    queryFn: () => api.getThread(threadId),
    initialData: initial,
    staleTime: 30_000,
  });

  useThreadEvents(threadId, data?.last_event_id ?? initial.last_event_id);

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

  const onJumpToComment = useCallback((commentId: string) => {
    const el = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-1', 'ring-accent');
      setTimeout(() => el.classList.remove('ring-1', 'ring-accent'), 1200);
    }
  }, []);

  const approve = async () => {
    await api.approveThread(threadId);
  };
  const reopen = async () => {
    await api.reopenThread(threadId);
  };

  const approved = view.status === 'approved';

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 h-14 flex items-center gap-3">
          <Link href="/" className="text-ink-subtle hover:text-ink" aria-label="Back to Threads">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-sm font-semibold truncate">{view.thread.title}</h1>
          </div>
          <SessionPill status={view.session_status} />
          <ActivityPill activity={view.activity} />
          <RepoChip remote={view.attached_repo_remote} path={view.attached_repo_path} />
          <div className="w-px h-5 bg-hairline mx-1" />
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

      <div className="mx-auto max-w-7xl px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <section>
          {approved ? <HandoffBanner planMarkdown={markdown} /> : null}
          {view.plan.body === null ? (
            <p className="text-sm text-ink-subtle border border-dashed border-hairline rounded-md p-6 text-center">
              The Agent hasn't drafted a Plan yet. When it does, edits appear here live.
            </p>
          ) : (
            <PlanEditor
              markdown={markdown}
              onSave={onSave}
              onJumpToComment={onJumpToComment}
              readOnly={approved}
            />
          )}
        </section>
        <aside>
          <CommentsRail
            threadId={threadId}
            comments={view.comments}
            archivedComments={view.archived_comments}
          />
        </aside>
      </div>

      {view.pending_round ? <ClarificationModal round={view.pending_round} /> : null}
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
