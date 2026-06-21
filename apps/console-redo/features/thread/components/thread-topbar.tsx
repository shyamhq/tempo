'use client';

// The thread top-bar. Matches the kit's `.toolbar` (Design System Planning Tool/
// ui_kits/workbench/index.html lines 92-118, 292-298, 413-424): Back, breadcrumb
// (space › thread title), a spacer, the light/dark theme toggle, a Discussion
// toggle, Copy plan, and the primary Execute.
//
// Presentational: it reads the thread title + space name via store selectors and
// acts via store actions / the markdown getter it's handed (composition happens
// in ThreadView — the top-bar holds no plan or fetch knowledge).

import { ArrowLeft, ChevronRight, Copy, MessageSquare, Moon, Play, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDockOpen, useThread, useThreadSpaceName, useThreadStore } from '@/store';

export function ThreadTopBar({
  threadId,
  getMarkdown,
}: {
  threadId: string;
  // Resolves the current plan as markdown for Copy plan / Execute (the handoff).
  // Null until the plan editor mounts and registers it.
  getMarkdown: () => Promise<string> | null;
}) {
  const router = useRouter();
  const thread = useThread();
  const spaceName = useThreadSpaceName(threadId);
  const dockOpen = useDockOpen();

  return (
    <div className="flex h-[46px] shrink-0 items-center gap-[10px] border-b border-border bg-canvas px-[14px]">
      <button
        type="button"
        title="Back"
        aria-label="Back"
        onClick={() => router.back()}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 outline-none transition-colors hover:bg-inset focus-visible:shadow-[var(--tp-focus-ring)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[7px] text-[13px]">
        {spaceName ? (
          <>
            <span className="text-ink-3">{spaceName}</span>
            <ChevronRight className="size-[13px] shrink-0 text-ink-3" aria-hidden />
          </>
        ) : null}
        <span className="truncate font-display font-semibold text-ink">
          {thread?.title ?? 'Untitled thread'}
        </span>
      </nav>

      <div className="flex-1" />

      <ThemeToggle />

      <ToolbarButton
        toggled={dockOpen}
        onClick={() => useThreadStore.getState().toggleDock()}
        icon={<MessageSquare className="size-[13px]" aria-hidden />}
      >
        Discussion
      </ToolbarButton>

      <CopyHandoffButton getMarkdown={getMarkdown} />
    </div>
  );
}

// The light/dark theme toggle (`.thtoggle`). next-themes owns the [data-theme]
// attribute on <html> and persists the choice to localStorage; we drive it via
// useTheme()/setTheme and read resolvedTheme for the on-state. The active state
// renders only after mount — until then resolvedTheme is undefined server-side,
// so an SSR'd on-state would mismatch the client (the standard next-themes guard).
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    // biome-ignore lint/a11y/useSemanticElements: role=group is the WAI-ARIA grouping pattern for this two-button segmented toggle; no semantic element fits.
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex shrink-0 items-center gap-[2px] rounded-full border border-border-strong bg-inset p-[2px]"
    >
      {(['light', 'dark'] as const).map((opt) => {
        const Icon = opt === 'light' ? Sun : Moon;
        const on = mounted && resolvedTheme === opt;
        return (
          <button
            key={opt}
            type="button"
            title={opt === 'light' ? 'Light' : 'Dark'}
            aria-pressed={on}
            onClick={() => setTheme(opt)}
            className={cn(
              'flex h-[22px] w-[25px] items-center justify-center rounded-full outline-none transition-colors focus-visible:shadow-[var(--tp-focus-ring)]',
              on ? 'bg-canvas text-primary shadow-sm' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <Icon className="size-[14px]" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

// Copy plan + Execute. The product has no execution backend — the real handoff
// is pasting the plan into a fresh Claude Code session — so both buttons perform
// the same copy. Execute is the primary CTA framing of that handoff with a paste
// hint; Copy plan is the plain copy.
// ponytail: Execute has no backend yet — it copies the plan markdown like Copy
// plan. Wire it to a real runner if/when one exists.
type CopyState =
  | { which: 'plan' | 'execute'; status: 'ok' | 'fail' }
  | { status: 'not-ready' }
  | null;

function CopyHandoffButton({ getMarkdown }: { getMarkdown: () => Promise<string> | null }) {
  const [feedback, setFeedback] = useState<CopyState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = (next: NonNullable<CopyState>, ms: number) => {
    setFeedback(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback(null), ms);
  };

  const copy = async (which: 'plan' | 'execute') => {
    const pending = getMarkdown();
    if (!pending) {
      flash({ status: 'not-ready' }, 1600);
      return;
    }
    try {
      const markdown = await pending;
      await navigator.clipboard.writeText(markdown);
      flash({ which, status: 'ok' }, 1600);
    } catch {
      // clipboard write rejects on a denied permission or insecure context —
      // surface it transiently rather than swallowing the failure.
      flash({ which, status: 'fail' }, 1600);
    }
  };

  const labelFor = (which: 'plan' | 'execute', base: string, ok: string) => {
    if (feedback?.status === 'not-ready') return 'Plan not ready';
    if (feedback?.status === 'fail' && feedback.which === which) return 'Copy failed';
    if (feedback?.status === 'ok' && feedback.which === which) return ok;
    return base;
  };

  return (
    <>
      <ToolbarButton
        onClick={() => void copy('plan')}
        icon={<Copy className="size-[13px]" aria-hidden />}
      >
        {labelFor('plan', 'Copy plan', 'Copied')}
      </ToolbarButton>
      <ToolbarButton
        primary
        onClick={() => void copy('execute')}
        title="Copies the plan — paste it into a fresh Claude Code session"
        icon={<Play className="size-[13px]" aria-hidden />}
      >
        {labelFor('execute', 'Execute', 'Paste into Claude Code')}
      </ToolbarButton>
    </>
  );
}

// The kit's `.btn.sm` and its `.pri` / `.toggle.on` variants (lines 107-117).
function ToolbarButton({
  children,
  icon,
  onClick,
  title,
  primary = false,
  toggled = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  title?: string;
  primary?: boolean;
  toggled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-[9px] text-[12px] font-medium outline-none transition-colors focus-visible:shadow-[var(--tp-focus-ring)]',
        '[&>svg]:size-[13px]',
        primary
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-press'
          : toggled
            ? 'border-transparent bg-primary-soft text-primary'
            : 'border-border-strong bg-canvas text-ink hover:bg-inset',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
