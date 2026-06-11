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
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return <ThreadView threadId={id} initial={initial} />;
}
