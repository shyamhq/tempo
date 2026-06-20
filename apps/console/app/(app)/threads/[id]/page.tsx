import { notFound } from 'next/navigation';
import { ThreadView } from '@/components/thread/thread-view';
import { ApiError, api } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let initial;
  try {
    initial = await api.getThread(id);
  } catch (e) {
    // 404 = gone; 403 = not in your workspace (deleted threads return this too —
    // the API refuses to confirm existence). Both render as not-found rather
    // than crashing the page. A 401 (auth) still throws → middleware handles it.
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return <ThreadView threadId={id} initial={initial} />;
}
