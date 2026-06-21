'use client';

// The thread top-bar. Matches the kit's `.toolbar` (Design System Planning Tool/
// ui_kits/workbench/index.html lines 92-118, 292-298, 413-424): Back, breadcrumb
// (space › thread title), a spacer, the light/dark theme toggle, a Discussion
// toggle, Copy plan, and the primary Execute.
//
// Presentational: it reads the thread title + space name via store selectors and
// acts via store actions / the markdown getter it's handed (composition happens
// in ThreadView — the top-bar holds no plan or fetch knowledge).

import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  MessageSquare,
  Moon,
  Play,
  Plug,
  Sun,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getConnectToken } from '@/features/thread/api';
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

  // The new-thread compose lands Local Threads with ?connect=1 to auto-open the
  // Connect dialog (the Dev must run `npx tempo-agent connect`). Seed the dialog's
  // open state from the param, then strip it via replaceState so a refresh — or
  // closing and reopening — doesn't reopen it. replaceState (not router.replace)
  // keeps it shallow: no rerender, no re-fetch of the thread session.
  const searchParams = useSearchParams();
  const [connectOpen, setConnectOpen] = useState(() => searchParams.get('connect') === '1');
  // biome-ignore lint/correctness/useExhaustiveDependencies: strip-once on mount
  useEffect(() => {
    if (searchParams.get('connect') === '1') {
      window.history.replaceState(null, '', `/t/${threadId}`);
    }
  }, []);

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

      <ConnectButton threadId={threadId} open={connectOpen} onOpenChange={setConnectOpen} />

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

// The Connect affordance: opens a centered Radix Dialog showing the
// `npx tempo-agent connect <token>` command for attaching a local Agent. The
// token is invariant per Thread, so it's fetched once on first open and cached.
//
// No forceMount: Radix unmounts both surfaces on close. forceMount would leave a
// stale inset-0 overlay whose Radix-set inline pointer-events:auto swallows every
// page click. Centering + the scale-in keyframe both carry the -translate so the
// dialog stays centered during and after the animation — mirrors settings-modal.
function ConnectButton({
  threadId,
  open,
  onOpenChange,
}: {
  threadId: string;
  // Lifted to ThreadTopBar so the ?connect=1 deep-link (Local thread creation)
  // can auto-open the same dialog the toolbar button opens.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // ponytail: ephemeral dialog-only state with one caller — fetched inline rather
  // than via a store slice (not shared, not worth a slice). Fetch once on first
  // open; the token never changes, so subsequent opens reuse the cached value. A
  // failed fetch leaves token null, so re-opening the dialog (which clears
  // `failed`) re-attempts.
  useEffect(() => {
    if (!open || token !== null) return;
    let cancelled = false;
    getConnectToken(threadId)
      .then((r) => {
        if (!cancelled) setToken(r.connect_token);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token, threadId]);

  const cmd = token ? `npx tempo-agent connect ${token}` : null;

  const copy = async () => {
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard write rejects on a denied permission or insecure context —
      // leave the copied state off so the affordance reads as "not copied".
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Clear the prior failure on open so the fetch effect re-attempts after a
        // first-fetch failure, and clear `copied` so a reopened dialog doesn't show
        // a stale "Copied" state (the button stays mounted across open/close).
        if (next) {
          setFailed(false);
          setCopied(false);
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Trigger asChild>
        <ToolbarButton
          onClick={() => onOpenChange(true)}
          icon={<Plug className="size-[13px]" aria-hidden />}
        >
          Connect
        </ToolbarButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="tp-fade-in fixed inset-0 z-[70] bg-[var(--tp-backdrop)]" />
        <Dialog.Content className="tp-scale-in fixed left-1/2 top-1/2 z-[71] w-[460px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-canvas p-5 shadow-lg outline-none">
          <Dialog.Title className="font-display text-base font-semibold text-ink">
            Connect the Agent
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-ink-2">
            Run this in your repo to connect a local Agent to this Thread.
          </Dialog.Description>

          <div className="mt-4 flex min-h-[2.5rem] items-start gap-2 rounded-md border border-border bg-code-bg p-3 font-mono text-xs text-code-ink">
            {failed ? (
              <span className="text-danger">Failed to load connect command.</span>
            ) : cmd ? (
              <>
                <span className="flex-1 break-all">{cmd}</span>
                <button
                  type="button"
                  onClick={() => void copy()}
                  aria-label="Copy connect command"
                  className="shrink-0 text-ink-3 outline-none transition-colors hover:text-ink focus-visible:shadow-[var(--tp-focus-ring)]"
                >
                  {copied ? (
                    <Check className="size-4 text-success" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                </button>
              </>
            ) : (
              <span className="text-ink-3">Loading…</span>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">
                Close
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  let variantClass = 'border-border-strong bg-canvas text-ink hover:bg-inset';
  if (primary)
    variantClass = 'border-primary bg-primary text-primary-foreground hover:bg-primary-press';
  else if (toggled) variantClass = 'border-transparent bg-primary-soft text-primary';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-[9px] text-[12px] font-medium outline-none transition-colors focus-visible:shadow-[var(--tp-focus-ring)]',
        '[&>svg]:size-[13px]',
        variantClass,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
