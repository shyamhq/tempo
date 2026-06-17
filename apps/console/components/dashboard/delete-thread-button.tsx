'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';

export function DeleteThreadButton({ threadId, title }: { threadId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopNav = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteThread(threadId);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete "${title}".`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={stopNav}
          aria-label={`Delete ${title}`}
          className="text-ink-tertiary hover:text-danger transition-colors disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <div onClick={stopNav} onKeyDown={(e) => e.stopPropagation()}>
          <DialogTitle>Delete this Thread?</DialogTitle>
          <DialogDescription>
            "{title}" will be permanently removed, along with its Plan, Comments, and attachments.
          </DialogDescription>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-ink-subtle hover:text-ink hover:bg-surface-2 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-danger/90 disabled:opacity-40"
            >
              {busy ? 'Deleting…' : error ? 'Retry' : 'Delete'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
