'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSidebar } from '@/hooks/use-sidebar-state';
import { api } from '@/lib/api-client';

export function UndoToast() {
  const pending = useSidebar((s) => s.pendingDelete);
  const clear = useSidebar((s) => s.clearDelete);
  const qc = useQueryClient();
  const router = useRouter();
  // Once the network call fires, undo becomes a no-op — otherwise a click that
  // lands between setTimeout firing and the await resolving would re-fetch the
  // (now actually deleted) item and silently restore an empty row.
  const cancelled = useRef(false);

  useEffect(() => {
    if (!pending) return;
    cancelled.current = false;
    const remaining = Math.max(0, pending.expiresAt - Date.now());
    const timer = setTimeout(async () => {
      if (cancelled.current) return;
      if (pending.kind === 'space') {
        await api.deleteSpace(pending.id);
        qc.invalidateQueries({ queryKey: ['spaces'] });
      } else {
        await api.deleteThread(pending.id);
        qc.invalidateQueries({ queryKey: ['space-threads', pending.spaceId] });
      }
      router.refresh();
      clear();
    }, remaining);
    return () => clearTimeout(timer);
  }, [pending, qc, router, clear]);

  if (!pending) return null;
  const label =
    pending.kind === 'space' ? `Deleted "${pending.name}"` : `Deleted "${pending.title}"`;

  const undo = () => {
    if (!pending) return;
    cancelled.current = true;
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
