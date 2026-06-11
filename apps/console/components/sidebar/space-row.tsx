'use client';

import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Space } from '@tempo/contracts';
import { ChevronRight, GripVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { colorForSpace } from '@/lib/space-color';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/store/sidebar';
import { InlineRename } from './inline-rename';
import { RowMenu } from './row-menu';
import { SpaceBody } from './space-body';

export function SpaceRow({ space, spaces }: { space: Space; spaces: Space[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const expanded = useSidebar((s) => s.expanded.has(space.id));
  const toggle = useSidebar((s) => s.toggleExpanded);
  const renaming = useSidebar((s) => s.renaming?.kind === 'space' && s.renaming.id === space.id);
  const startRename = useSidebar((s) => s.startRename);
  const clearRename = useSidebar((s) => s.clearRename);
  const queueDelete = useSidebar((s) => s.queueDelete);
  const pendingDel = useSidebar(
    (s) => s.pendingDelete?.kind === 'space' && s.pendingDelete.id === space.id,
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: space.id,
    data: { kind: 'space' },
    disabled: renaming || pendingDel,
  });

  const { isOver, setNodeRef: dropRef } = useDroppable({
    id: `space-drop-${space.id}`,
    data: { kind: 'space', spaceId: space.id },
  });

  const rename = useMutation({
    mutationFn: (name: string) => api.updateSpace(space.id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spaces'] });
      router.refresh();
    },
  });

  if (pendingDel) return null;

  const color = colorForSpace(space.id);

  const onDelete = () => {
    if (space.thread_count > 0) {
      const ok = window.confirm(
        `Delete "${space.name}" and its ${space.thread_count} thread${space.thread_count === 1 ? '' : 's'}?`,
      );
      if (!ok) return;
    }
    queueDelete({ kind: 'space', id: space.id, name: space.name, threadCount: space.thread_count });
  };

  return (
    <div>
      <div
        ref={(n) => {
          setNodeRef(n);
          dropRef(n);
        }}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : 1,
        }}
        onClick={() => toggle(space.id)}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors cursor-pointer',
          'hover:bg-surface-2',
          isOver ? 'ring-2 ring-accent ring-inset bg-accent/8' : null,
        )}
      >
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center text-ink-tertiary/0 group-hover:text-ink-tertiary/80 cursor-grab active:cursor-grabbing"
          aria-label="Drag space"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-tertiary transition-transform',
            expanded ? 'rotate-90' : 'rotate-0',
          )}
        />

        <span
          className="flex size-icon-lg shrink-0 items-center justify-center rounded-sm text-micro font-bold"
          style={{ background: `${color}22`, color }}
        >
          {space.name.charAt(0).toUpperCase() || '·'}
        </span>

        {renaming ? (
          <InlineRename
            initial={space.name}
            onCommit={(v) => {
              clearRename();
              rename.mutate(v);
            }}
            onCancel={clearRename}
          />
        ) : (
          <span className="flex-1 truncate text-body-sm-medium text-ink text-left">
            {space.name}
          </span>
        )}

        <span className="inline-flex items-center gap-1 shrink-0">
          <span className="text-micro font-normal tabular-nums text-ink-tertiary">
            {space.thread_count}
          </span>
          <RowMenu
            kind="space"
            onAction={(a) => {
              if (a.kind === 'rename') startRename({ kind: 'space', id: space.id });
              else if (a.kind === 'delete') onDelete();
            }}
          />
        </span>
      </div>

      {expanded ? <SpaceBody space={space} spaces={spaces} /> : null}
    </div>
  );
}
