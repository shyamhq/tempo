'use client';

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

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

interface SidebarState {
  expanded: Set<string>;
  renaming: RenameTarget;
  pendingDelete: PendingDelete;
  _commit: CommitFn | null;
  collapsed: boolean;
  peeking: boolean;
  toggleExpanded: (id: string, force?: boolean) => void;
  startRename: (target: RenameTarget) => void;
  clearRename: () => void;
  queueDelete: (d: PendingDeleteInput) => void;
  clearDelete: () => void;
  registerCommit: (fn: CommitFn | null) => void;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
  setPeeking: (v: boolean) => void;
}

export const useSidebar = create<SidebarState>()(
  devtools(
    persist(
      (set) => ({
        expanded: new Set(),
        renaming: null,
        pendingDelete: null,
        _commit: null,
        collapsed: false,
        peeking: false,
        toggleExpanded: (id, force) =>
          set(
            (s) => {
              const next = new Set(s.expanded);
              const want = force ?? !next.has(id);
              if (want) next.add(id);
              else next.delete(id);
              return { expanded: next };
            },
            undefined,
            'sidebar/toggleExpanded',
          ),
        startRename: (target) => set({ renaming: target }, undefined, 'sidebar/startRename'),
        clearRename: () => set({ renaming: null }, undefined, 'sidebar/clearRename'),
        queueDelete: (d) =>
          set(
            (s) => {
              // A previous pending is still in flight; the user moved on, so commit it
              // now rather than letting its network call get cancelled when the slot
              // gets overwritten.
              if (s.pendingDelete) s._commit?.(s.pendingDelete);
              return { pendingDelete: { ...d, expiresAt: Date.now() + UNDO_MS } };
            },
            undefined,
            'sidebar/queueDelete',
          ),
        clearDelete: () => set({ pendingDelete: null }, undefined, 'sidebar/clearDelete'),
        registerCommit: (fn) => set({ _commit: fn }, undefined, 'sidebar/registerCommit'),
        setCollapsed: (v) =>
          set({ collapsed: v, peeking: false }, undefined, 'sidebar/setCollapsed'),
        toggleCollapsed: () =>
          set(
            (s) => ({ collapsed: !s.collapsed, peeking: false }),
            undefined,
            'sidebar/toggleCollapsed',
          ),
        setPeeking: (v) => set({ peeking: v }, undefined, 'sidebar/setPeeking'),
      }),
      {
        name: 'tempo:sidebar',
        // `collapsed` is intentionally NOT persisted — refresh always opens
        // the sidebar so the workspace switcher + spaces are immediately
        // visible. Within a session, in-memory state carries the choice.
        partialize: () => ({}),
      },
    ),
    { name: 'sidebar', enabled: process.env.NODE_ENV !== 'production' },
  ),
);
