'use client';

// The home: lands the Dev on their recent planning threads with a New thread CTA.
// A client surface — there is no request-less workspace resolver here, and the
// greeting reads Clerk's active org directly (the org IS the workspace, 1:1),
// matching the rail's WorkspaceSwitcher. Recent threads come from listThreads()
// (already sorted updated_at DESC); we fetch once on mount with a cancel guard,
// mirroring the thread-topbar's ConnectButton.

import { useOrganization } from '@clerk/nextjs';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listThreads } from '@/features/thread/api';

// The rich thread rows listThreads() resolves: ThreadSummary + presence + time.
type RecentThread = Awaited<ReturnType<typeof listThreads>>[number];

// How many recent threads the home surfaces. They arrive sorted recent-first, so
// this is a simple head slice — the full list lives behind the rail.
const RECENT_LIMIT = 12;

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; threads: RecentThread[] };

export default function HomePage() {
  const { organization } = useOrganization();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // Fetch once on mount. A workspace switch re-mounts this route (the rail's
  // setActive calls router.refresh), so the list re-fetches without an org dep.
  useEffect(() => {
    let cancelled = false;
    listThreads()
      .then((threads) => {
        if (!cancelled) setState({ status: 'ready', threads });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-semibold tracking-tight text-ink">
              {organization?.name ?? 'Your planning threads'}
            </h1>
            <p className="mt-1 text-base text-ink-2">
              Pick up a recent thread, or start a new one.
            </p>
          </div>
          {/* asChild makes the Link the single Slot child, so the icon lives
              inside it — Button's icon prop can't be used with Slot (one child). */}
          <Button variant="primary" size="lg" asChild>
            <Link href="/t/new">
              <Plus className="size-[15px]" aria-hidden />
              New thread
            </Link>
          </Button>
        </header>

        <RecentThreads state={state} />
      </div>
    </div>
  );
}

function RecentThreads({ state }: { state: LoadState }) {
  if (state.status === 'loading') {
    return <p className="px-1 py-16 text-center text-sm text-ink-3">Loading…</p>;
  }

  if (state.status === 'error') {
    return (
      <p className="px-1 py-16 text-center text-sm text-danger">
        Could not load your threads. Reload to try again.
      </p>
    );
  }

  if (state.threads.length === 0) {
    return <EmptyHome />;
  }

  return (
    <ul aria-label="Recent threads" className="border-t border-border">
      {state.threads.slice(0, RECENT_LIMIT).map((thread) => (
        <RecentThreadRow key={thread.id} thread={thread} />
      ))}
    </ul>
  );
}

function RecentThreadRow({ thread }: { thread: RecentThread }) {
  return (
    <li>
      <Link
        href={`/t/${thread.id}`}
        className="flex items-center gap-3 border-b border-border px-2 py-3 outline-none transition-colors hover:bg-inset focus-visible:bg-inset"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-ink">{thread.title}</div>
          {thread.description.length > 0 ? (
            <div className="mt-0.5 truncate text-sm text-ink-3">{thread.description}</div>
          ) : null}
        </div>
        {thread.agent_present ? (
          <Badge tone="success">connected</Badge>
        ) : (
          <Badge tone="neutral">idle</Badge>
        )}
        <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-ink-3">
          {formatUpdated(thread.updated_at)}
        </span>
      </Link>
    </li>
  );
}

// The empty state: adapts apps/console's EmptyHome messaging to a first-thread
// nudge, kit-styled, with the same New thread CTA.
function EmptyHome() {
  return (
    <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex flex-col gap-1.5">
        <p className="font-display text-lg font-semibold text-ink">
          Start your first planning thread
        </p>
        <p className="max-w-sm text-base text-ink-2">
          A thread is where the Agent explores your repo, asks clarifications, and drafts a plan you
          can iterate on.
        </p>
      </div>
      <Button variant="primary" size="lg" asChild>
        <Link href="/t/new">
          <Plus className="size-[15px]" aria-hidden />
          New thread
        </Link>
      </Button>
    </div>
  );
}

// Relative time via the native Intl.RelativeTimeFormat (locale-aware), with an
// absolute-date fallback past a week. Single caller, so it lives inline.
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function formatUpdated(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = (then - Date.now()) / 1000; // negative = in the past
  const mins = secs / 60;
  if (mins > -60) return RELATIVE.format(Math.round(mins), 'minute');
  const hours = mins / 60;
  if (hours > -24) return RELATIVE.format(Math.round(hours), 'hour');
  const days = hours / 24;
  if (days > -7) return RELATIVE.format(Math.round(days), 'day');
  return new Date(then).toLocaleDateString();
}
