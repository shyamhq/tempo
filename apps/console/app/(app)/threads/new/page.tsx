import { redirect } from 'next/navigation';
import { NewThreadCompose } from '@/components/dashboard/new-thread-compose';
import { currentWorkspaceId } from '@/server/actor';
import { listSpaces } from '@/server/spaces';

export const dynamic = 'force-dynamic';

export default async function NewThreadPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string }>;
}) {
  const { space: spaceId } = await searchParams;
  const spaces = await listSpaces(await currentWorkspaceId());
  const space = spaceId ? spaces.find((s) => s.id === spaceId) : undefined;
  if (!space) redirect('/');
  return <NewThreadCompose space={space} />;
}
