'use client';

// One space group in the rail: a collapsible header (chevron, colour badge,
// name, thread count, kebab menu) plus — when expanded — its thread rows and a
// "New thread" link. Reads expand/rename state from the sidebar slice and
// triggers behaviour through slice actions.

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Space } from '@tempo/contracts';
import { ChevronRight, GripVertical, Plus } from 'lucide-react';
import Link from 'next/link';
import { colorForSpace } from '@/lib/space-color';
import { cn } from '@/lib/utils';
import { useSpaceExpanded, useSpaceThreads, useThreadStore } from '@/store';
import { InlineRename } from './inline-rename';
import { type MenuAction, RowMenu } from './row-menu';
import { ThreadRow } from './thread-row';

export function SpaceRow({
  space,
  spaces,
  activeThreadId,
  agentPresent,
}: {
  space: Space;
  spaces: Space[];
  activeThreadId: string | undefined;
  agentPresent: boolean;
}) {
  const expanded = useSpaceExpanded(space.id);
  const threads = useSpaceThreads(space.id);
  const renaming = useThreadStore(
    (s) => s.renaming?.kind === 'space' && s.renaming.id === space.id,
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: space.id,
      data: { kind: 'space', spaceId: space.id },
      disabled: renaming,
    });

  const color = colorForSpace(space.id);

  const onMenu = (a: MenuAction) => {
    const store = useThreadStore.getState();
    if (a.kind === 'rename') {
      store.startRename({ kind: 'space', id: space.id });
    } else if (a.kind === 'delete') {
      const msg =
        space.thread_count > 0
          ? `Delete "${space.name}" and its ${space.thread_count} thread${space.thread_count === 1 ? '' : 's'}?`
          : `Delete "${space.name}"?`;
      if (!window.confirm(msg)) return;
      void store.deleteSpace(space.id);
    }
  };

  return (
    <div className="px-2">
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : 1,
        }}
        className={cn(
          'group flex w-full items-center gap-1 rounded-sm pr-2 transition-colors hover:bg-inset',
          isOver ? 'bg-primary/[0.08] ring-2 ring-inset ring-primary' : null,
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag space"
          className="flex shrink-0 cursor-grab items-center pl-1 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-[13px]" />
        </button>

        <button
          type="button"
          onClick={() => useThreadStore.getState().toggleExpanded(space.id)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1.5 text-left outline-none focus-visible:shadow-[var(--tp-focus-ring)]"
        >
          <ChevronRight
            className={cn(
              'size-[13px] shrink-0 text-ink-3 transition-transform',
              expanded ? 'rotate-90' : 'rotate-0',
            )}
          />

          <span
            className="flex size-[18px] shrink-0 items-center justify-center rounded-xs text-xs font-bold text-white"
            style={{ background: color }}
          >
            {space.name.charAt(0).toUpperCase() || '·'}
          </span>

          {renaming ? null : (
            <span className="flex-1 truncate text-base font-medium text-ink">{space.name}</span>
          )}
        </button>

        {renaming ? (
          <span className="min-w-0 flex-1 py-1.5">
            <InlineRename
              initial={space.name}
              onCommit={(v) => {
                useThreadStore.getState().clearRename();
                void useThreadStore.getState().renameSpace(space.id, v);
              }}
              onCancel={() => useThreadStore.getState().clearRename()}
            />
          </span>
        ) : null}

        <span className="inline-flex shrink-0 items-center gap-1">
          <span className="font-mono text-xs tabular-nums text-ink-3">{space.thread_count}</span>
          <RowMenu kind="space" onAction={onMenu} />
        </span>
      </div>

      {expanded ? (
        <div className="mb-1.5 mt-px">
          <div className="ml-[18px] border-l border-border pl-1">
            {threads === undefined ? (
              <div className="px-2 py-1 text-sm text-ink-3">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="px-2 py-1 text-sm text-ink-3">No threads yet.</div>
            ) : (
              <SortableContext
                items={threads.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {threads.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    spaceId={space.id}
                    active={t.id === activeThreadId}
                    agentPresent={agentPresent}
                    spaces={spaces}
                  />
                ))}
              </SortableContext>
            )}
            <Link
              href={`/t/new?space=${space.id}`}
              className="mt-0.5 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink-3 hover:bg-inset hover:text-ink-2"
            >
              <Plus className="size-3" strokeWidth={2.2} /> New thread
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
