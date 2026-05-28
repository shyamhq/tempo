import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { ThreadView } from '@/components/thread/thread-view';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
