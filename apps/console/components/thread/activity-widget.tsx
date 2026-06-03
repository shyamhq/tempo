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
  const { todos, toolCalls, turnActive } = useLiveActivityGroup(threadId);
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
  const latestTool = toolCalls[0] ?? null;

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-10">
      {open ? (
        <div className="w-[380px] relative">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse Agent activity"
            className="absolute top-2 right-2 z-10 inline-flex items-center justify-center h-6 w-6 rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <ActivityCard todos={todos} toolCalls={toolCalls} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Expand Agent activity"
          className="w-[280px] text-left rounded-[10px] border border-hairline bg-canvas px-3 pt-2.5 pb-2 shadow-[0_8px_22px_rgba(10,10,10,0.10)] hover:border-hairline-strong transition-colors"
        >
          <div className="flex items-baseline justify-between text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-tertiary mb-1">
            <span>{progress}</span>
            <ChevronDown className="h-3 w-3" aria-hidden />
          </div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <span
              aria-hidden
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-accent animate-pulse"
            />
            <span className="truncate">{topLine}</span>
          </div>
          {latestTool ? (
            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11.5px] text-ink-subtle">
              <Loader2 className="h-[10px] w-[10px] shrink-0 animate-spin text-ink-tertiary" />
              <span className="text-ink font-semibold truncate">{latestTool.tool}</span>
              {latestTool.summary ? (
                <span className="truncate text-ink-subtle">{latestTool.summary}</span>
              ) : null}
            </div>
          ) : null}
        </button>
      )}
    </div>
  );
}
