'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useQuery } from '@tanstack/react-query';
import type { Space } from '@tempo/contracts';
import { Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { ThreadRow } from './thread-row';

export function SpaceBody({ space, spaces }: { space: Space; spaces: Space[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeThreadId = pathname?.startsWith('/threads/') ? pathname.split('/')[2] : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['space-threads', space.id],
    queryFn: () => api.listSpaceThreads(space.id),
  });

  const threads = data?.threads ?? [];

  // ml-[37px] lands the guide under the space row's chevron column;
  // pl-[68px] on the "+ New thread" button = same offset + thread-row's
  // px-2 + grip (14px) + gap-2 so the "+" sits under the status-dot column.
  return (
    <div className="mt-px mb-1.5">
      <div className="ml-[37px] border-l border-hairline">
        {isLoading ? (
          <div className="px-2 py-1 text-[13px] text-ink-tertiary">Loading…</div>
        ) : threads.length === 0 ? (
          <div className="px-2 py-1 text-[13px] text-ink-tertiary">No threads yet.</div>
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
      </div>
      <button
        type="button"
        onClick={() => router.push(`/threads/new?space=${space.id}`)}
        className="mt-0.5 flex w-full items-center gap-2 rounded-[7px] py-1.5 pl-[68px] pr-2 text-[13px] text-ink-tertiary hover:bg-surface-2 hover:text-ink"
      >
        <Plus className="h-3 w-3" strokeWidth={2.2} /> New thread
      </button>
    </div>
  );
}
