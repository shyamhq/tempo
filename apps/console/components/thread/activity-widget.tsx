'use client';

import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLiveActivityGroup } from '@/hooks/use-thread-events';
import { ActivityCard } from './activity-card';

// B2 floating Activity surface. Lives only while the Agent's turn is active —
// the Stop hook flips `turnActive` false and the widget unmounts. Click
// toggles the mini-card and the expanded V2 card in the same corner;
// outside-click and Escape collapse.
export function ActivityWidget({ threadId }: { threadId: string }) {
  const { todos, entries, turnActive } = useLiveActivityGroup(threadId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!turnActive) return null;

  const active = todos?.find((t) => t.status === 'in_progress');
  const firstPending = todos?.find((t) => t.status === 'pending');
  const done = todos?.filter((t) => t.status === 'completed').length ?? 0;
  const progress = todos?.length ? `${done} of ${todos.length}` : 'Agent activity';
  const topLine =
    active?.activeForm ?? active?.content ?? firstPending?.content ?? 'Agent working…';
  const latestEntry = entries[0] ?? null;

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-10">
      {open ? (
        <div className="w-[520px] relative">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse Agent activity"
            className="absolute top-2 right-2 z-10 inline-flex items-center justify-center h-6 w-6 rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <ActivityCard todos={todos} entries={entries} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Expand Agent activity"
          className="w-[280px] text-left rounded-md border border-hairline bg-canvas px-3 pt-2.5 pb-2 shadow-[0_8px_22px_rgba(10,10,10,0.10)] hover:border-hairline-strong transition-colors"
        >
          <div className="flex items-baseline justify-between text-micro font-semibold uppercase tracking-uppercase text-ink-tertiary mb-1">
            <span>{progress}</span>
            <ChevronDown className="h-3 w-3" aria-hidden />
          </div>
          <div className="flex items-center gap-2 text-caption font-medium text-ink">
            <span
              aria-hidden
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-accent animate-pulse"
            />
            <span className="truncate">{topLine}</span>
          </div>
          {latestEntry ? (
            latestEntry.kind === 'tool' ? (
              <div className="mt-1.5 flex items-center gap-1.5 font-mono text-micro text-ink-subtle">
                <Loader2 className="h-[10px] w-[10px] shrink-0 animate-spin text-ink-tertiary" />
                <span className="text-ink font-semibold truncate">{latestEntry.tool}</span>
                {latestEntry.summary ? (
                  <span className="truncate text-ink-subtle">{latestEntry.summary}</span>
                ) : null}
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-1.5 text-micro text-ink-subtle">
                <span aria-hidden className="shrink-0 text-ink-tertiary leading-none">
                  ✎
                </span>
                <span className="truncate italic">{latestEntry.text}</span>
              </div>
            )
          ) : null}
        </button>
      )}
    </div>
  );
}
