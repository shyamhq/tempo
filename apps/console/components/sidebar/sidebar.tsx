'use client';

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
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Space, SpaceThreadLite } from '@tempo/contracts';
import { PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api-client';
import { useSidebar } from '@/store/sidebar';
import { SpaceRow } from './space-row';
import { UndoToast } from './undo-toast';

export function Sidebar({ initial }: { initial: Space[] }) {
  const qc = useQueryClient();
  // Seed during the first render (not in an effect) so `useQuery(['spaces'])`
  // sees fresh data before any child observers subscribe.
  useState(() => {
    if (qc.getQueryData(['spaces']) === undefined) qc.setQueryData(['spaces'], initial);
  });

  const router = useRouter();
  const pathname = usePathname();
  const activeThreadId = pathname?.startsWith('/threads/') ? pathname.split('/')[2] : undefined;

  const collapsed = useSidebar((s) => s.collapsed);
  const toggleCollapsed = useSidebar((s) => s.toggleCollapsed);

  // Publish the sidebar's current pixel width as a CSS variable so that
  // position:fixed children elsewhere (e.g. the Discussion FAB) can align
  // to the content area without knowing the magic 48/300 px values.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '48px' : '300px');
  }, [collapsed]);

  // ⌘\ toggles the sidebar. Skip when an editable surface is focused so the
  // Plan editor / Compose textarea can still emit a literal backslash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      e.preventDefault();
      useSidebar.getState().toggleCollapsed();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data } = useQuery({
    queryKey: ['spaces'],
    queryFn: () => api.listSpaces().then((r) => r.spaces),
    initialData: initial,
  });
  const spaces = data ?? initial;

  // Auto-expand the Space that owns the active Thread on first load / reload,
  // so the highlighted row is in view without the user clicking through.
  const { data: activeThread } = useQuery({
    queryKey: ['thread', activeThreadId],
    queryFn: () => api.getThread(activeThreadId as string),
    enabled: !!activeThreadId,
  });
  useEffect(() => {
    if (activeThread?.space_id) useSidebar.getState().toggleExpanded(activeThread.space_id, true);
  }, [activeThread?.space_id]);

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return spaces;
    const q = search.trim().toLowerCase();
    return spaces.filter((s) => s.name.toLowerCase().includes(q));
  }, [spaces, search]);

  const newSpace = useMutation({
    mutationFn: () => api.createSpace({ name: 'New space' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['spaces'] });
      useSidebar.getState().toggleExpanded(res.space.id, true);
      useSidebar.getState().startRename({ kind: 'space', id: res.space.id });
      router.refresh();
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => handleDragEnd(e, qc, spaces, router.refresh);

  if (collapsed) {
    return (
      <aside className="flex h-dvh w-12 shrink-0 flex-col items-center border-r border-hairline bg-surface-2/40 pt-[18px] pb-3.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-caption font-bold text-on-primary">
          T
        </span>
        <div className="my-auto flex flex-col items-center gap-3">
          <Tooltip content="Expand sidebar  ⌘\" side="right">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              className="flex h-10 w-10 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              <PanelLeftOpen size={22} strokeWidth={2} />
            </button>
          </Tooltip>
          <span
            aria-hidden
            className="text-micro-uppercase uppercase text-ink-tertiary select-none"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Tempo
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-dvh w-sidebar shrink-0 flex-col border-r border-hairline bg-surface-2/40">
      <div className="px-[18px] pt-[18px] pb-3.5">
        <div className="flex items-center gap-2.5 text-heading-5 tracking-tight text-ink">
          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-caption font-bold text-on-primary">
            T
          </span>
          Tempo
          <Tooltip content="Collapse sidebar  ⌘\" side="right">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              <PanelLeftClose size={20} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="px-4 pb-2.5">
        <label className="flex h-[34px] items-center gap-2 rounded-md border border-hairline bg-canvas px-2.5 text-ink-tertiary">
          <Search className="h-3.5 w-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads…"
            className="flex-1 min-w-0 border-none bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-[18px] py-1.5">
        <span className="text-micro-uppercase uppercase text-ink-subtle">Spaces</span>
        <button
          type="button"
          onClick={() => newSpace.mutate()}
          disabled={newSpace.isPending}
          className="flex items-center gap-1.5 text-caption font-medium text-accent-deep hover:text-accent-hover"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> New
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-3.5">
          <SortableContext items={filtered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {filtered.map((s) => (
              <SpaceRow key={s.id} space={s} spaces={spaces} />
            ))}
          </SortableContext>
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-caption text-ink-tertiary">
              {search ? 'No matches.' : 'No spaces yet.'}
            </div>
          ) : null}
        </div>
      </DndContext>

      <UndoToast />
    </aside>
  );
}

// Two reorder modes share the same handler:
//   - same-list reorder → midpoint of new neighbours (PATCH sort_order)
//   - cross-Space thread drop on a Space row → PATCH space_id, the receiving
//     Space lazy-loads its threads on next expand.
function handleDragEnd(
  e: DragEndEvent,
  qc: QueryClient,
  spaces: Space[],
  refresh: () => void,
): void {
  const { active, over } = e;
  if (!over || active.id === over.id) return;
  const activeKind = active.data.current?.kind as 'space' | 'thread' | undefined;
  const overKind = over.data.current?.kind as 'space' | 'thread' | undefined;
  if (!activeKind) return;

  if (activeKind === 'space' && overKind === 'space') {
    const from = spaces.findIndex((s) => s.id === active.id);
    const to = spaces.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(spaces, from, to);
    const idx = next.findIndex((s) => s.id === active.id);
    const sortOrder = midpoint(next[idx - 1]?.sort_order, next[idx + 1]?.sort_order);
    qc.setQueryData(
      ['spaces'],
      next.map((s, i) => (i === idx ? { ...s, sort_order: sortOrder } : s)),
    );
    void api.updateSpace(String(active.id), { sort_order: sortOrder }).then(() => {
      qc.invalidateQueries({ queryKey: ['spaces'] });
    });
    return;
  }

  if (activeKind === 'thread') {
    const fromSpace = active.data.current?.spaceId as string;

    // Drop onto another Space row → move thread cross-space.
    if (overKind === 'space') {
      const toSpace = over.data.current?.spaceId as string;
      if (toSpace && toSpace !== fromSpace) {
        void api.updateThread(String(active.id), { space_id: toSpace }).then(() => {
          qc.invalidateQueries({ queryKey: ['space-threads', fromSpace] });
          qc.invalidateQueries({ queryKey: ['space-threads', toSpace] });
          qc.invalidateQueries({ queryKey: ['spaces'] });
          refresh();
        });
      }
      return;
    }

    // Drop onto another thread → reorder within the same Space.
    if (overKind === 'thread') {
      const overSpace = over.data.current?.spaceId as string;
      if (overSpace !== fromSpace) {
        // Cross-space drop on a thread row: reparent into the over's Space.
        void api.updateThread(String(active.id), { space_id: overSpace }).then(() => {
          qc.invalidateQueries({ queryKey: ['space-threads', fromSpace] });
          qc.invalidateQueries({ queryKey: ['space-threads', overSpace] });
          qc.invalidateQueries({ queryKey: ['spaces'] });
        });
        return;
      }
      const existing =
        (
          qc.getQueryData(['space-threads', fromSpace]) as
            | { threads: SpaceThreadLite[] }
            | undefined
        )?.threads ?? [];
      const fromIdx = existing.findIndex((t) => t.id === active.id);
      const toIdx = existing.findIndex((t) => t.id === over.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = arrayMove(existing, fromIdx, toIdx);
      const idx = next.findIndex((t) => t.id === active.id);
      const sortOrder = midpoint(next[idx - 1]?.sort_order, next[idx + 1]?.sort_order);
      qc.setQueryData(['space-threads', fromSpace], {
        threads: next.map((t, i) => (i === idx ? { ...t, sort_order: sortOrder } : t)),
      });
      void api.updateThread(String(active.id), { sort_order: sortOrder }).then(() => {
        qc.invalidateQueries({ queryKey: ['space-threads', fromSpace] });
      });
    }
  }
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [m] = next.splice(from, 1);
  if (m === undefined) return arr;
  next.splice(to, 0, m);
  return next;
}

// Fractional indexing: drop between `prev` and `next` gets the midpoint of
// their sort_order values. Missing prev = head of list (next - 1); missing
// next = tail (prev + 1); both missing = first row (1).
function midpoint(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 1;
  if (prev === undefined) return (next ?? 1) - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}
