'use client';

import { create } from 'zustand';

type RenameTarget =
  | { kind: 'space'; id: string }
  | { kind: 'thread'; spaceId: string; id: string }
  | null;

export type PendingDeleteInput =
  | { kind: 'space'; id: string; name: string; threadCount: number }
  | { kind: 'thread'; id: string; title: string; spaceId: string };

type PendingDelete = (PendingDeleteInput & { expiresAt: number }) | null;

type CommitFn = (p: PendingDeleteInput) => void;

export const UNDO_MS = 5000;

const COLLAPSED_STORAGE = 'tempo:sidebar_collapsed';

interface SidebarState {
  expanded: Set<string>;
  renaming: RenameTarget;
  pendingDelete: PendingDelete;
  _commit: CommitFn | null;
  collapsed: boolean;
  toggleExpanded: (id: string, force?: boolean) => void;
  startRename: (target: RenameTarget) => void;
  clearRename: () => void;
  queueDelete: (d: PendingDeleteInput) => void;
  clearDelete: () => void;
  registerCommit: (fn: CommitFn | null) => void;
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
  _commit: null,
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
  queueDelete: (d) =>
    set((s) => {
      // A previous pending is still in flight; the user moved on, so commit it
      // now rather than letting its network call get cancelled when the slot
      // gets overwritten.
      if (s.pendingDelete) s._commit?.(s.pendingDelete);
      return { pendingDelete: { ...d, expiresAt: Date.now() + UNDO_MS } };
    }),
  clearDelete: () => set({ pendingDelete: null }),
  registerCommit: (fn) => set({ _commit: fn }),
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
