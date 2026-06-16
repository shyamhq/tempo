'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionStatus, Trail, TrailStep } from '@tempo/contracts';
import { ChevronDown, ChevronUp, Maximize2, Minus, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveActivityGroup } from '@/hooks/use-thread-events';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type Mode = 'chip' | 'card' | 'drawer';

type Presence = 'connected' | 'starting' | 'failed' | 'idle';

function presenceFromSession(status: SessionStatus): Presence {
  if (status === 'connected') return 'connected';
  if (status === 'initiating' || status === 'pending') return 'starting';
  if (status === 'failed') return 'failed';
  return 'idle';
}

const PRESENCE_DOT: Record<Presence, string> = {
  connected: 'bg-success animate-pulse',
  starting: 'bg-accent animate-pulse',
  failed: 'bg-danger',
  idle: 'bg-ink-tertiary',
};

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: 'Agent connected',
  starting: 'Agent starting…',
  failed: 'Agent failed',
  idle: 'Agent idle',
};

const TOOL_LABELS: Record<string, string> = {
  Bash: 'Bash',
  Read: 'Read',
  Edit: 'Edit',
  Write: 'Write',
  Grep: 'Grep',
  Glob: 'Glob',
  webSearch: 'Web search',
  webFetch: 'Web fetch',
  // Claude Code's Task tool fan-outs surface as `Agent` (CLI) or `Task` (SDK).
  // Subagents run silently — no intermediate stream — so the chip stays on
  // this label for the entire subagent run. The dedicated word "Subagent"
  // makes that visible instead of looking like the main agent is stuck.
  Agent: 'Subagent',
  Task: 'Subagent',
  tempo_attach: 'Attach',
  tempo_poll_hosted: 'Poll',
  tempo_post_discussion_message: 'Post message',
  tempo_post_reply: 'Reply',
  tempo_update_plan: 'Update plan',
  tempo_pull_plan: 'Pull plan',
  tempo_set_thread_meta: 'Set title',
  tempo_load_skill: 'Load skill',
};

const SURFACE_LABEL: Record<Trail['surface'], string> = {
  comment: 'Comment',
  plan: 'Plan',
  discussion: 'Discussion',
  unknown: 'Working',
};

export function AgentTrails({
  threadId,
  sessionStatus,
  failedReason,
}: {
  threadId: string;
  sessionStatus: SessionStatus;
  failedReason?: string | null;
}) {
  const [mode, setMode] = useState<Mode>('chip');
  const { data } = useQuery({
    queryKey: ['trails', threadId],
    queryFn: () => api.getTrails(threadId),
    staleTime: 30_000,
  });
  const trails = data?.trails ?? [];
  const live = useLiveActivityGroup(threadId);
  const liveTrail = useMemo(() => synthesizeLiveTrail(live), [live]);
  const presence = presenceFromSession(sessionStatus);
  const merged = useMemo(
    () => (liveTrail ? [liveTrail, ...trails.filter((t) => t.status !== 'live')] : trails),
    [liveTrail, trails],
  );
  const latestStep = liveTrail?.steps[liveTrail.steps.length - 1] ?? null;
  const chipStep = useReadableLatestStep(latestStep);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'card') return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMode('chip');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('chip');
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [mode]);

  if (mode === 'drawer') {
    return (
      <div className="fixed top-3 right-3 bottom-3 w-[300px] z-30 flex flex-col rounded-md border border-hairline bg-canvas shadow-card-elevated overflow-hidden">
        <TrailsHeader
          presence={presence}
          right={
            <button
              type="button"
              onClick={() => setMode('chip')}
              aria-label="Minimize"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          }
        />
        <TrailsTimeline trails={merged} />
        <TrailsFooter count={merged.length} />
      </div>
    );
  }

  if (mode === 'card') {
    return (
      <div
        ref={containerRef}
        className="fixed bottom-5 right-5 w-[360px] max-h-[60vh] z-30 flex flex-col rounded-md border border-hairline bg-canvas shadow-card-elevated overflow-hidden"
      >
        <TrailsHeader
          presence={presence}
          right={
            <>
              <button
                type="button"
                onClick={() => setMode('drawer')}
                aria-label="Expand"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMode('chip')}
                aria-label="Close"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          }
        />
        <TrailsTimeline trails={merged.slice(0, 10)} />
        {merged.length > 10 ? (
          <button
            type="button"
            onClick={() => setMode('drawer')}
            className="border-t border-hairline-soft px-4 py-2 text-caption text-ink-subtle hover:bg-surface-2 hover:text-ink text-left"
          >
            Show all {merged.length} trails
          </button>
        ) : null}
        <TrailsFooter count={merged.length} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setMode('card')}
      aria-label="Open agent activity"
      className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2.5 rounded-md border border-hairline bg-canvas px-3 py-2 shadow-card-elevated hover:border-hairline-strong transition-colors text-left min-w-[230px]"
    >
      <span
        aria-hidden
        className={cn('h-[7px] w-[7px] shrink-0 rounded-full', PRESENCE_DOT[presence])}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-micro-uppercase uppercase font-semibold text-ink-tertiary leading-tight">
          {liveTrail ? SURFACE_LABEL[liveTrail.surface] : 'Agent activity'}
        </span>
        <span className="block text-caption text-ink truncate">
          {chipStatusText(presence, chipStep, liveTrail !== null, failedReason)}
        </span>
      </span>
      <ChevronUp className="h-3.5 w-3.5 text-ink-tertiary" />
    </button>
  );
}

function TrailsHeader({ presence, right }: { presence: Presence; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline-soft px-3 py-2.5">
      <div className="flex items-center gap-2 text-caption font-semibold text-ink">
        <span
          aria-hidden
          className={cn('h-[7px] w-[7px] shrink-0 rounded-full', PRESENCE_DOT[presence])}
        />
        {PRESENCE_LABEL[presence]}
      </div>
      <div className="flex items-center gap-0.5">{right}</div>
    </div>
  );
}

function TrailsFooter({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between border-t border-hairline-soft px-3 py-2 text-micro text-ink-tertiary">
      <span>
        {count} trail{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function TrailsTimeline({ trails }: { trails: Trail[] }) {
  if (trails.length === 0) {
    return (
      <div className="flex-1 px-4 py-8 text-center text-caption text-ink-tertiary">
        No agent activity yet.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative pl-7 pr-3 py-2">
        <span aria-hidden className="absolute left-3 top-2 bottom-2 w-px bg-hairline" />
        {trails.map((t, idx) => (
          <TrailRow key={t.id} trail={t} defaultOpen={idx === 0} />
        ))}
      </div>
    </div>
  );
}

function TrailRow({ trail, defaultOpen }: { trail: Trail; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const live = trail.status === 'live';
  return (
    <div className="relative py-2">
      <span
        aria-hidden
        className={cn(
          'absolute -left-[18px] top-3 h-2.5 w-2.5 rounded-full bg-canvas ring-2',
          live ? 'animate-pulse ring-accent bg-accent' : ringForSurface(trail.surface),
        )}
      />
      <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left">
        <div className="flex items-baseline gap-2">
          <span className="text-micro-uppercase uppercase font-semibold text-ink-tertiary">
            {SURFACE_LABEL[trail.surface]}
          </span>
          <span className="text-micro font-mono text-ink-tertiary">{formatDuration(trail)}</span>
          <ChevronDown
            className={cn(
              'ml-auto h-3 w-3 text-ink-tertiary transition-transform',
              open ? 'rotate-180' : '',
            )}
          />
        </div>
        <div className="mt-0.5 text-caption text-ink">{outputLabel(trail)}</div>
        {!open ? (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-micro text-ink-subtle">
            {summariseSteps(trail.steps)}
          </div>
        ) : null}
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-hairline-soft pt-2">
          {trail.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {trail.output_text ? (
            <div className="mt-2 rounded-sm border-l-2 border-accent bg-surface-2 px-2.5 py-1.5 text-caption text-ink italic">
              {trail.output_text}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StepRow({ step }: { step: TrailStep }) {
  if (step.kind === 'narration') {
    return <div className="text-caption text-ink-subtle italic leading-snug">{step.text}</div>;
  }
  if (step.kind === 'tool') {
    return (
      <div className="flex items-center gap-1.5 text-micro font-mono">
        <Wrench className="h-3 w-3 shrink-0 text-ink-tertiary" />
        <span className="font-semibold text-ink">{TOOL_LABELS[step.tool] ?? step.tool}</span>
        <span className="truncate text-ink-subtle">{compactArgs(step.summary)}</span>
      </div>
    );
  }
  const active = step.todos.find((t) => t.status === 'in_progress');
  const done = step.todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="text-micro text-ink-subtle">
      Todos: {done}/{step.todos.length} done
      {active ? ` · ${active.activeForm ?? active.content}` : ''}
    </div>
  );
}

function ringForSurface(surface: Trail['surface']): string {
  switch (surface) {
    case 'comment':
      return 'ring-brand-warn bg-canvas';
    case 'plan':
      return 'ring-accent bg-canvas';
    case 'discussion':
      return 'ring-success bg-canvas';
    default:
      return 'ring-ink-tertiary bg-canvas';
  }
}

function outputLabel(trail: Trail): string {
  if (trail.output_text) return trail.output_text.slice(0, 140);
  if (trail.surface === 'plan') return 'Edited the Plan';
  if (trail.surface === 'unknown') return 'Working…';
  return 'No output';
}

function formatDuration(trail: Trail): string {
  if (!trail.ended_at) return 'running';
  const ms = new Date(trail.ended_at).getTime() - new Date(trail.started_at).getTime();
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function summariseSteps(steps: TrailStep[]): React.ReactNode[] {
  if (steps.length === 0) return [<span key="-">no steps</span>];
  const tools = steps.filter((s) => s.kind === 'tool').length;
  const narrations = steps.filter((s) => s.kind === 'narration').length;
  const out: React.ReactNode[] = [];
  if (narrations) out.push(<span key="n">{narrations} thinking</span>);
  if (tools)
    out.push(
      <span key="t">
        {out.length ? <span className="text-ink-tertiary">·</span> : null} {tools} tool
        {tools === 1 ? '' : 's'}
      </span>,
    );
  return out;
}

function compactArgs(summary: string): string {
  if (!summary) return '';
  // Tool summaries arrive in two shapes: stringified JSON args (most MCP
  // tools) or already-extracted plain text (Read/Bash/Grep flatten to the
  // primary arg). Try JSON first, fall back to the raw string. Absolute
  // paths collapse to basename so the chip stays readable.
  let s = summary;
  try {
    const obj = JSON.parse(summary) as Record<string, unknown>;
    const pick =
      obj.text ?? obj.command ?? obj.query ?? obj.path ?? obj.file_path ?? obj.title ?? obj.name;
    if (typeof pick === 'string') s = pick;
  } catch {
    // not JSON — keep raw
  }
  if (s.startsWith('/') && !s.includes(' ')) {
    const slash = s.lastIndexOf('/');
    if (slash >= 0) s = s.slice(slash + 1);
  }
  return s.slice(0, 60);
}

function synthesizeLiveTrail(live: ReturnType<typeof useLiveActivityGroup>): Trail | null {
  if (!live.turnActive) return null;
  const steps: TrailStep[] = [];
  // entries are newest-first in the live cache; emit oldest-first so the
  // trail reads chronologically like the persisted ones.
  for (const e of [...live.entries].reverse()) {
    if (e.kind === 'tool') {
      steps.push({
        kind: 'tool',
        id: e.id,
        ts: new Date().toISOString(),
        tool: e.tool,
        summary: e.summary,
      });
    } else if (e.kind === 'narration') {
      steps.push({
        kind: 'narration',
        id: e.id,
        ts: new Date().toISOString(),
        text: e.text,
      });
    }
  }
  if (steps.length === 0 && !live.todos) return null;
  return {
    id: 'live:current',
    surface: 'unknown',
    target_id: null,
    output_text: null,
    steps,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: 'live',
  };
}

function chipStatusText(
  presence: Presence,
  step: TrailStep | null,
  isLive: boolean,
  failedReason?: string | null,
): string {
  if (isLive) {
    if (step?.kind === 'tool') {
      const label = TOOL_LABELS[step.tool] ?? step.tool;
      const arg = compactArgs(step.summary);
      return arg ? `${label} · ${arg}` : label;
    }
    if (step?.kind === 'narration') return step.text.slice(0, 80);
    return 'Working…';
  }
  if (presence === 'failed' && failedReason) return failedReason;
  return PRESENCE_LABEL[presence];
}

const NARRATION_HOLD_MS = 2000;

// Holds a narration on screen for ~2s before advancing to the next event,
// so the user has time to read it. Subsequent events queue silently; when
// the timer fires, we snap to whatever is the latest at that moment.
function useReadableLatestStep(latest: TrailStep | null): TrailStep | null {
  const [displayed, setDisplayed] = useState<TrailStep | null>(latest);
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;

  useEffect(() => {
    if (!latest) {
      setDisplayed(null);
      return;
    }
    const prev = displayedRef.current;
    if (!prev || prev.kind !== 'narration' || prev.id === latest.id) {
      setDisplayed(latest);
      return;
    }
    const t = setTimeout(() => setDisplayed(latest), NARRATION_HOLD_MS);
    return () => clearTimeout(t);
  }, [latest]);

  return displayed;
}
