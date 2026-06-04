import { Plus } from 'lucide-react';
import Link from 'next/link';
import { DeleteThreadButton } from '@/components/dashboard/delete-thread-button';
import { EmptyHome } from '@/components/home/empty-home';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { listSpaces } from '@/server/spaces';

export const dynamic = 'force-dynamic';

const sessionTone = (s: 'pending' | 'connected' | 'disconnected') => {
  if (s === 'connected') return 'success';
  if (s === 'pending') return 'accent';
  return 'muted';
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string }>;
}) {
  const { space: spaceId } = await searchParams;
  const spaces = await listSpaces();
  const activeSpace = spaceId ? spaces.find((s) => s.id === spaceId) : undefined;

  if (!activeSpace) {
    return (
      <main className="px-6 py-10">
        <EmptyHome hasSpaces={spaces.length > 0} />
      </main>
    );
  }

  const { threads } = await api.listThreads(spaceId);
  const sorted = [...threads].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  return (
    <main className="mx-auto max-w-4xl px-8 py-8">
      <header className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <div className="text-micro-uppercase uppercase text-ink-tertiary mb-1">Space</div>
          <h1 className="font-display text-xl font-semibold tracking-tight">{activeSpace.name}</h1>
        </div>
        <Link
          href={`/threads/new?space=${activeSpace.id}`}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-5 text-sm font-medium rounded-full bg-primary text-on-primary hover:bg-primary-hover border border-transparent transition focus-visible:outline-none focus-visible:shadow-focus-soft"
        >
          <Plus className="h-3.5 w-3.5" /> New Thread
        </Link>
      </header>

      <div className="flex items-center gap-3 px-3 h-9 border-y border-hairline bg-surface-2/40 text-micro-uppercase uppercase text-ink-tertiary">
        <span className="flex-1">Thread</span>
        <span className="w-24 text-right">Session</span>
        <span className="w-20 text-right">Status</span>
        <span className="w-28 text-right">Updated</span>
        <span className="w-6" aria-hidden />
      </div>

      {sorted.length === 0 ? (
        <div className="px-3 py-16 text-center">
          <p className="text-sm text-ink-muted">No Threads yet.</p>
          <p className="text-xs text-ink-subtle mt-1">
            Use <span className="font-medium text-ink">New Thread</span> to start a planning
            session.
          </p>
        </div>
      ) : (
        <ul>
          {sorted.map((t) => (
            <li
              key={t.id}
              className="group relative border-b border-hairline hover:bg-surface-2/60 focus-within:bg-surface-2/60"
            >
              <Link
                href={`/threads/${t.id}`}
                aria-label={t.title}
                className="absolute inset-0 focus:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <div className="relative flex items-center gap-3 px-3 py-3 pointer-events-none">
                <span
                  aria-hidden
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                    t.status === 'approved' ? 'bg-accent' : 'bg-ink-tertiary',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink font-medium truncate">{t.title}</div>
                  {t.description ? (
                    <div className="text-micro font-normal text-ink-subtle truncate mt-0.5">
                      {t.description}
                    </div>
                  ) : null}
                </div>
                <div className="w-24 text-right shrink-0">
                  <Badge tone={sessionTone(t.session_status)}>{t.session_status}</Badge>
                </div>
                <div className="w-20 text-right shrink-0">
                  <Badge tone={t.status === 'approved' ? 'success' : 'accent'}>{t.status}</Badge>
                </div>
                <span className="w-28 text-right shrink-0 text-micro font-normal text-ink-tertiary tabular-nums">
                  {formatUpdated(t.updated_at)}
                </span>
                <div className="w-6 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                  <DeleteThreadButton threadId={t.id} title={t.title} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return d.toLocaleDateString();
}
