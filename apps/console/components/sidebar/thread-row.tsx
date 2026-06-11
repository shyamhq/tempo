'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Space, SpaceThreadLite } from '@tempo/contracts';
import { Check, GripVertical } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/store/sidebar';
import { InlineRename } from './inline-rename';
import { RowMenu } from './row-menu';

export function ThreadRow({
  thread,
  spaceId,
  active,
  spaces,
}: {
  thread: SpaceThreadLite;
  spaceId: string;
  active: boolean;
  spaces: Space[];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const renaming = useSidebar((s) => s.renaming?.kind === 'thread' && s.renaming.id === thread.id);
  const startRename = useSidebar((s) => s.startRename);
  const clearRename = useSidebar((s) => s.clearRename);
  const queueDelete = useSidebar((s) => s.queueDelete);
  const pendingDel = useSidebar(
    (s) => s.pendingDelete?.kind === 'thread' && s.pendingDelete.id === thread.id,
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: thread.id,
    data: { kind: 'thread', spaceId },
    disabled: renaming || pendingDel,
  });

  const rename = useMutation({
    mutationFn: (title: string) => api.updateThread(thread.id, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space-threads', spaceId] });
      qc.invalidateQueries({ queryKey: ['thread', thread.id] });
      router.refresh();
    },
  });

  const move = useMutation({
    mutationFn: (toSpaceId: string) => api.updateThread(thread.id, { space_id: toSpaceId }),
    onSuccess: (_d, toSpaceId) => {
      qc.invalidateQueries({ queryKey: ['space-threads', spaceId] });
      qc.invalidateQueries({ queryKey: ['space-threads', toSpaceId] });
      qc.invalidateQueries({ queryKey: ['spaces'] });
      router.refresh();
    },
  });

  if (pendingDel) return null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={cn(
        'group/thread relative rounded-sm transition-colors',
        active ? 'bg-surface-2' : 'hover:bg-surface-2',
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!renaming ? (
        <Link
          href={`/threads/${thread.id}`}
          aria-current={active ? 'page' : undefined}
          aria-label={thread.title}
          className="absolute inset-0 rounded-sm focus:outline-none focus-visible:shadow-focus-soft"
        />
      ) : null}

      <div className="relative pointer-events-none flex w-full items-center gap-2 px-2 py-1.5">
        {active ? (
          // -left-px overlaps the gray guide-line on SpaceBody's bordered container.
          <span className="absolute -left-px top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
        ) : null}

        <button
          type="button"
          {...attributes}
          {...listeners}
          className="pointer-events-auto flex shrink-0 items-center text-ink-tertiary/0 group-hover/thread:text-ink-tertiary/80 cursor-grab active:cursor-grabbing"
          aria-label="Drag thread"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <StatusGlyph status={thread.status} />

        {renaming ? (
          <span className="pointer-events-auto flex-1 min-w-0">
            <InlineRename
              initial={thread.title}
              onCommit={(v) => {
                clearRename();
                rename.mutate(v);
              }}
              onCancel={clearRename}
            />
          </span>
        ) : (
          <span
            className={cn(
              'flex-1 truncate text-caption',
              active ? 'text-ink font-medium' : 'text-ink-muted',
            )}
          >
            {thread.title}
          </span>
        )}

        {!renaming ? (
          <span className="pointer-events-auto shrink-0">
            <RowMenu
              kind="thread"
              spaceId={spaceId}
              spaces={spaces}
              onAction={(a) => {
                if (a.kind === 'rename') startRename({ kind: 'thread', spaceId, id: thread.id });
                else if (a.kind === 'delete')
                  queueDelete({ kind: 'thread', id: thread.id, title: thread.title, spaceId });
                else if (a.kind === 'move') move.mutate(a.toSpaceId);
              }}
            />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: SpaceThreadLite['status'] }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-deep">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-ink-tertiary" />;
}
