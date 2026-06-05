'use client';

import { create } from 'zustand';

type RenameTarget =
  | { kind: 'space'; id: string }
  | { kind: 'thread'; spaceId: string; id: string }
  | null;

type PendingDeleteInput =
  | { kind: 'space'; id: string; name: string; threadCount: number }
  | { kind: 'thread'; id: string; title: string; spaceId: string };

type PendingDelete = (PendingDeleteInput & { expiresAt: number }) | null;

export const UNDO_MS = 5000;

const COLLAPSED_STORAGE = 'tempo:sidebar_collapsed';

interface SidebarState {
  expanded: Set<string>;
  renaming: RenameTarget;
  pendingDelete: PendingDelete;
  collapsed: boolean;
  toggleExpanded: (id: string, force?: boolean) => void;
  startRename: (target: RenameTarget) => void;
  clearRename: () => void;
  queueDelete: (d: PendingDeleteInput) => void;
  clearDelete: () => void;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
  hydrateCollapsed: () => void;
}

function persistCollapsed(v: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COLLAPSED_STORAGE, v ? '1' : '0');
}

export const useSidebar = create<SidebarState>((set) => ({
  expanded: new Set(),
  renaming: null,
  pendingDelete: null,
  collapsed: false,
  toggleExpanded: (id, force) =>
    set((s) => {
      const next = new Set(s.expanded);
      const want = force ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return { expanded: next };
    }),
  startRename: (target) => set({ renaming: target }),
  clearRename: () => set({ renaming: null }),
  queueDelete: (d) => set({ pendingDelete: { ...d, expiresAt: Date.now() + UNDO_MS } }),
  clearDelete: () => set({ pendingDelete: null }),
  setCollapsed: (v) => {
    persistCollapsed(v);
    set({ collapsed: v });
  },
  toggleCollapsed: () =>
    set((s) => {
      const next = !s.collapsed;
      persistCollapsed(next);
      return { collapsed: next };
    }),
  hydrateCollapsed: () => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(COLLAPSED_STORAGE) === '1') set({ collapsed: true });
  },
}));
