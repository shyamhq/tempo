'use client';

// One thread row in the rail. A <Link> to /t/[threadId]; an inline rename and a
// kebab menu (rename / move / delete) overlay it. The row reads which row is
// being renamed from the sidebar slice and triggers behaviour through slice
// actions — no fetch here. The green presence dot shows when this is the open
// thread and its agent is live (the only per-thread presence signal available;
// SpaceThreadLite carries no presence field).

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Space, SpaceThreadLite } from '@tempo/contracts';
import { GripVertical } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useThreadStore } from '@/store';
import { InlineRename } from './inline-rename';
import { type MenuAction, RowMenu } from './row-menu';

export function ThreadRow({
  thread,
  spaceId,
  active,
  agentPresent,
  spaces,
}: {
  thread: SpaceThreadLite;
  spaceId: string;
  active: boolean;
  agentPresent: boolean;
  spaces: Space[];
}) {
  const renaming = useThreadStore(
    (s) => s.renaming?.kind === 'thread' && s.renaming.id === thread.id,
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: thread.id,
    data: { kind: 'thread', spaceId },
    disabled: renaming,
  });

  const onMenu = (a: MenuAction) => {
    const store = useThreadStore.getState();
    if (a.kind === 'rename') {
      store.startRename({ kind: 'thread', spaceId, id: thread.id });
    } else if (a.kind === 'move') {
      void store.moveThread(thread.id, spaceId, a.toSpaceId);
    } else if (a.kind === 'delete') {
      if (!window.confirm(`Delete "${thread.title}"?`)) return;
      void store.deleteThread(spaceId, thread.id);
    }
  };

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
        active ? 'bg-canvas' : 'hover:bg-inset',
      )}
    >
      {!renaming ? (
        <Link
          href={`/t/${thread.id}`}
          aria-current={active ? 'page' : undefined}
          aria-label={thread.title}
          className="absolute inset-0 rounded-sm outline-none focus-visible:shadow-[var(--tp-focus-ring)]"
        />
      ) : null}

      <div className="pointer-events-none relative flex w-full items-center gap-2 px-2.5 py-1.5">
        {active ? (
          <span className="absolute -left-px top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
        ) : null}

        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag thread"
          className="pointer-events-auto flex shrink-0 cursor-grab items-center text-ink-3 opacity-0 transition-opacity group-hover/thread:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-[13px]" />
        </button>

        {active && agentPresent ? (
          <span
            title="Agent active"
            className="size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_0_2px_rgba(47,158,104,0.22)]"
          />
        ) : (
          <span
            className={cn('size-[5px] shrink-0 rounded-full', active ? 'bg-primary' : 'bg-ink-3')}
          />
        )}

        {renaming ? (
          <span className="pointer-events-auto min-w-0 flex-1">
            <InlineRename
              initial={thread.title}
              onCommit={(v) => {
                useThreadStore.getState().clearRename();
                void useThreadStore.getState().renameThread(spaceId, thread.id, v);
              }}
              onCancel={() => useThreadStore.getState().clearRename()}
            />
          </span>
        ) : (
          <span
            className={cn(
              'flex-1 truncate text-sm',
              active ? 'font-medium text-ink' : 'text-ink-2',
            )}
          >
            {thread.title}
          </span>
        )}

        {!renaming ? (
          <span className="pointer-events-auto shrink-0 opacity-0 transition-opacity group-hover/thread:opacity-100 has-[[data-state=open]]:opacity-100">
            <RowMenu kind="thread" spaceId={spaceId} spaces={spaces} onAction={onMenu} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
