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

interface SidebarState {
  expanded: Set<string>;
  renaming: RenameTarget;
  pendingDelete: PendingDelete;
  toggleExpanded: (id: string, force?: boolean) => void;
  startRename: (target: RenameTarget) => void;
  clearRename: () => void;
  queueDelete: (d: PendingDeleteInput) => void;
  clearDelete: () => void;
}

export const useSidebar = create<SidebarState>((set) => ({
  expanded: new Set(),
  renaming: null,
  pendingDelete: null,
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
}));
