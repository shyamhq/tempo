'use client';

// The left rail: workspace switcher, thread search, and the spaces/threads tree.
// Fully presentational over the sidebar slice — it reads spaces via selectors and
// triggers create/rename/delete through slice actions. The tree itself is seeded
// once on shell mount by useSidebarHydration (called in the (app) layout).

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PanelLeftClose, Plus, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useAgentPresent, useSidebarSpaces, useThreadStore } from '@/store';
import { SpaceRow } from './space-row';
import { WorkspaceSwitcher } from './workspace-switcher';

type RowKind = 'space' | 'thread';

// Two reorder modes plus the cross-space move share one handler:
//   - space over space          → reorderSpace (midpoint PATCH sort_order)
//   - thread dropped on a space  → moveThread (PATCH space_id) when it differs
//   - thread over thread (other) → moveThread reparent into the over's space
//   - thread over thread (same)  → reorderThread (midpoint PATCH sort_order)
function handleDragEnd(e: DragEndEvent, spaceListFiltered: boolean): void {
  const { active, over } = e;
  if (!over || active.id === over.id) return;
  const activeKind = active.data.current?.kind as RowKind | undefined;
  const overKind = over.data.current?.kind as RowKind | undefined;
  if (!activeKind) return;

  const store = useThreadStore.getState();
  const activeId = String(active.id);
  const overId = String(over.id);

  if (activeKind === 'space' && overKind === 'space') {
    // A name filter renders a partial space list; the new neighbours computed
    // against the full array wouldn't match the visible drop, so the drag is a
    // no-op while filtering. Thread reorder/move stay valid (threads aren't
    // filtered), so only space reorder is gated.
    if (spaceListFiltered) return;
    void store.reorderSpace(activeId, overId);
    return;
  }

  if (activeKind === 'thread') {
    const fromSpace = active.data.current?.spaceId as string;

    // Dropped on a space header → cross-space move when the target differs.
    if (overKind === 'space') {
      if (overId !== fromSpace) void store.moveThread(activeId, fromSpace, overId);
      return;
    }

    if (overKind === 'thread') {
      const overSpace = over.data.current?.spaceId as string;
      if (overSpace !== fromSpace) void store.moveThread(activeId, fromSpace, overSpace);
      else void store.reorderThread(fromSpace, activeId, overId);
    }
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const activeThreadId = pathname?.startsWith('/t/') ? pathname.split('/')[2] : undefined;

  const spaces = useSidebarSpaces();
  const agentPresent = useAgentPresent();

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((s) => s.name.toLowerCase().includes(q));
  }, [spaces, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-1">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <button
          type="button"
          title="Collapse sidebar"
          onClick={() => useThreadStore.getState().toggleRail()}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 outline-none transition-colors hover:bg-inset hover:text-ink focus-visible:shadow-[var(--tp-focus-ring)]"
        >
          <PanelLeftClose className="size-[15px]" strokeWidth={2} />
        </button>
      </div>

      <div className="px-3 pb-2">
        <Input
          size="sm"
          icon={<Search />}
          placeholder="Search spaces…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between px-[14px] py-1.5">
        <span className="text-2xs font-semibold uppercase tracking-label text-ink-3">Spaces</span>
        <button
          type="button"
          onClick={() => void useThreadStore.getState().createSpace()}
          className="flex items-center gap-1.5 text-sm font-medium text-success hover:opacity-80"
        >
          <Plus className="size-[13px]" strokeWidth={2.2} /> New
        </button>
      </div>

      <DndContext
        id="sidebar-spaces"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => handleDragEnd(e, filtered.length !== spaces.length)}
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <SortableContext items={filtered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {filtered.map((s) => (
              <SpaceRow
                key={s.id}
                space={s}
                spaces={spaces}
                activeThreadId={activeThreadId}
                agentPresent={agentPresent}
              />
            ))}
          </SortableContext>
          {filtered.length === 0 ? (
            <div className="px-4 py-2 text-sm text-ink-3">
              {search ? 'No matches.' : 'No spaces yet.'}
            </div>
          ) : null}
        </div>
      </DndContext>
    </aside>
  );
}
