'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { api } from '@/lib/api-client';

export function DeleteThreadButton({ threadId, title }: { threadId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async (e: MouseEvent<HTMLButtonElement>) => {
    // The button sits inside a <Link>; stop the click from navigating.
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteThread(threadId);
      router.refresh();
    } catch (err) {
      console.error('[delete-thread]', err);
      window.alert(`Failed to delete "${title}". Please try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`Delete ${title}`}
      className="text-ink-tertiary hover:text-red-500 transition-colors disabled:opacity-40"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
