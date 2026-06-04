'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Space } from '@tempo/contracts';
import { Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { ThreadRow } from './thread-row';

export function SpaceBody({ space, spaces }: { space: Space; spaces: Space[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const activeThreadId = pathname?.startsWith('/threads/') ? pathname.split('/')[2] : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['space-threads', space.id],
    queryFn: () => api.listSpaceThreads(space.id),
  });

  const newThread = useMutation({
    mutationFn: () =>
      api.createThread({
        title: 'Untitled thread',
        description: '',
        space_id: space.id,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['space-threads', space.id] });
      qc.invalidateQueries({ queryKey: ['spaces'] });
      router.push(`/threads/${res.thread.id}`);
    },
  });

  const threads = data?.threads ?? [];

  return (
    <div className="ml-[18px] mt-px mb-1.5 border-l border-hairline pl-1.5">
      {isLoading ? (
        <div className="px-2 py-1 text-[13px] text-ink-tertiary">Loading…</div>
      ) : threads.length === 0 ? (
        <div className="px-2.5 py-1 text-[13px] text-ink-tertiary">No threads yet.</div>
      ) : (
        <SortableContext items={threads.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              spaceId={space.id}
              active={t.id === activeThreadId}
              spaces={spaces}
            />
          ))}
        </SortableContext>
      )}
      <button
        type="button"
        onClick={() => newThread.mutate()}
        disabled={newThread.isPending}
        className="mt-0.5 flex w-full items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[13px] text-ink-tertiary hover:bg-surface-2 hover:text-ink"
      >
        <Plus className="h-3 w-3" strokeWidth={2.2} /> New Thread
      </button>
    </div>
  );
}
