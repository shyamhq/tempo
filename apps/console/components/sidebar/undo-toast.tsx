'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { Space, SpaceThreadLite } from '@tempo/contracts';
import { Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { type PendingDeleteInput, useSidebar } from '@/store/sidebar';

export function UndoToast() {
  const pending = useSidebar((s) => s.pendingDelete);
  const clear = useSidebar((s) => s.clearDelete);
  const registerCommit = useSidebar((s) => s.registerCommit);
  const qc = useQueryClient();
  const router = useRouter();

  const commit = useCallback(
    async (p: PendingDeleteInput) => {
      // Optimistic cache removal. When commit fires via displacement (the slot
      // moves to a new pending), the row is no longer hidden by `pendingDel`
      // and would briefly reappear until the server confirmed the delete.
      try {
        if (p.kind === 'space') {
          qc.setQueryData<Space[]>(['spaces'], (old) =>
            old ? old.filter((s) => s.id !== p.id) : old,
          );
          await api.deleteSpace(p.id);
          qc.invalidateQueries({ queryKey: ['spaces'] });
        } else {
          qc.setQueryData<{ threads: SpaceThreadLite[] }>(['space-threads', p.spaceId], (old) =>
            old ? { threads: old.threads.filter((t) => t.id !== p.id) } : old,
          );
          await api.deleteThread(p.id);
          qc.invalidateQueries({ queryKey: ['space-threads', p.spaceId] });
        }
        router.refresh();
      } catch (err) {
        // Roll back the optimistic removal by re-fetching truth from the server.
        console.error('[undo-toast] commit failed', err);
        qc.invalidateQueries({
          queryKey: p.kind === 'space' ? ['spaces'] : ['space-threads', p.spaceId],
        });
      }
    },
    [qc, router],
  );

  useEffect(() => {
    registerCommit(commit);
    return () => registerCommit(null);
  }, [commit, registerCommit]);

  useEffect(() => {
    if (!pending) return;
    const target = pending;
    const remaining = Math.max(0, target.expiresAt - Date.now());
    const timer = setTimeout(async () => {
      await commit(target);
      clear();
    }, remaining);
    return () => clearTimeout(timer);
  }, [pending, commit, clear]);

  if (!pending) return null;
  const label =
    pending.kind === 'space' ? `Deleted "${pending.name}"` : `Deleted "${pending.title}"`;

  const undo = () => {
    if (pending.kind === 'space') {
      qc.invalidateQueries({ queryKey: ['spaces'] });
    } else {
      qc.invalidateQueries({ queryKey: ['space-threads', pending.spaceId] });
    }
    clear();
    router.refresh();
  };

  return (
    <div className="fixed bottom-5 left-5 z-[95] flex items-center gap-3.5 rounded-md bg-ink px-4 py-2.5 text-caption text-on-primary shadow-toast">
      {label}
      <button
        type="button"
        onClick={undo}
        className="inline-flex items-center gap-1.5 font-semibold text-accent hover:text-accent-hover"
      >
        <Undo2 className="h-3.5 w-3.5" /> Undo
      </button>
    </div>
  );
}
