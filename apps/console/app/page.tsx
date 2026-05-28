import Link from 'next/link';
import { NewThreadDialog } from '@/components/dashboard/new-thread-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { api } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

const sessionTone = (s: 'pending' | 'connected' | 'disconnected') =>
  s === 'connected' ? 'success' : s === 'pending' ? 'accent' : 'muted';

export default async function DashboardPage() {
  const { threads } = await api.listThreads();
  const sorted = [...threads].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Threads</h1>
          <p className="text-sm text-ink-subtle mt-1">Planning conversations with the Agent.</p>
        </div>
        <NewThreadDialog />
      </header>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-hairline border-dashed bg-surface-1 p-10 text-center">
          <p className="text-ink-muted">No Threads yet.</p>
          <p className="text-xs text-ink-subtle mt-1">Create one to start a planning session.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((t) => (
            <li key={t.id}>
              <Link href={`/threads/${t.id}`} className="block focus:outline-none">
                <Card className="h-full">
                  <CardBody>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-medium text-ink truncate">{t.title}</h2>
                      <Badge tone={t.status === 'approved' ? 'success' : 'accent'}>
                        {t.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-ink-subtle mt-1 line-clamp-2 min-h-[2.5rem]">
                      {t.description || 'No description.'}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge tone={sessionTone(t.session_status)}>{t.session_status}</Badge>
                      <span className="text-xs text-ink-tertiary ml-auto">
                        {new Date(t.updated_at).toLocaleString()}
                      </span>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
