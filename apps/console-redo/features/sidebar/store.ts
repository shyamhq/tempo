'use client';

// Sidebar slice: the spaces/threads navigation tree plus the rail's local UI
// state (which spaces are expanded, which row is being renamed). Spaces are
// non-realtime, so the tree is seeded once by hydrateSidebar (setSidebar) on
// shell mount. The one live touch point is thread_renamed — the gateway routes
// it here too so a rename updates the title in the rail without a refetch.
//
// All sidebar logic lives here (Zustand-slices pattern): the components read via
// selectors and call these actions; the actions call features/sidebar/api.ts.
// Components never see fetch, Zod, or a business rule.

import type { Space, SpaceThreadLite } from '@tempo/contracts';
import type { ThreadRenamedEvent } from '@tempo/contracts/events';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';
import * as api from './api';

export type RenameTarget =
  | { kind: 'space'; id: string }
  | { kind: 'thread'; spaceId: string; id: string }
  | null;

export interface SidebarTree {
  spaces: Space[];
  // Threads per space, keyed by SpaceId. The hydration tree fills a key for
  // every space (empty array for empty spaces).
  threadsBySpace: Record<string, SpaceThreadLite[]>;
}

export interface SidebarSlice extends SidebarTree {
  expanded: Record<string, boolean>;
  renaming: RenameTarget;

  setSidebar: (tree: SidebarTree) => void;
  toggleExpanded: (spaceId: string, force?: boolean) => void;
  startRename: (target: RenameTarget) => void;
  clearRename: () => void;

  // Distinct name from the thread slice's applyThreadRenamed: a single combined
  // store has one namespace, and the gateway fans thread_renamed to BOTH the
  // thread meta (title in the header) and the sidebar tree (title in the rail).
  applyThreadRenamedInTree: (e: z.infer<typeof ThreadRenamedEvent>, threadId: string) => void;

  createSpace: () => Promise<void>;
  renameSpace: (spaceId: string, name: string) => Promise<void>;
  deleteSpace: (spaceId: string) => Promise<void>;
  renameThread: (spaceId: string, threadId: string, title: string) => Promise<void>;
  moveThread: (threadId: string, fromSpaceId: string, toSpaceId: string) => Promise<void>;
  deleteThread: (spaceId: string, threadId: string) => Promise<void>;
}

export const createSidebarSlice: StateCreator<ThreadStore, [], [], SidebarSlice> = (set, get) => ({
  spaces: [],
  threadsBySpace: {},
  expanded: {},
  renaming: null,

  setSidebar: (tree) => set({ spaces: tree.spaces, threadsBySpace: tree.threadsBySpace }),

  toggleExpanded: (spaceId, force) =>
    set((s) => ({
      expanded: { ...s.expanded, [spaceId]: force ?? !s.expanded[spaceId] },
    })),

  startRename: (target) => set({ renaming: target }),
  clearRename: () => set({ renaming: null }),

  // thread_renamed carries no space_id, so scan each space's list for the
  // thread. Only the matching list is reallocated; untouched spaces keep their
  // array identity so their rail rows don't re-render.
  applyThreadRenamedInTree: (e, threadId) =>
    set((s) => {
      const next: Record<string, SpaceThreadLite[]> = {};
      let changed = false;
      for (const [spaceId, threads] of Object.entries(s.threadsBySpace)) {
        if (!threads.some((t) => t.id === threadId)) {
          next[spaceId] = threads;
          continue;
        }
        changed = true;
        next[spaceId] = threads.map((t) => (t.id === threadId ? { ...t, title: e.title } : t));
      }
      return changed ? { threadsBySpace: next } : {};
    }),

  createSpace: async () => {
    const space = await api.createSpace('New space');
    set((s) => ({
      spaces: [...s.spaces, space],
      threadsBySpace: { ...s.threadsBySpace, [space.id]: [] },
      expanded: { ...s.expanded, [space.id]: true },
      renaming: { kind: 'space', id: space.id },
    }));
  },

  renameSpace: async (spaceId, name) => {
    // Optimistic edit; one snapshot rollback shape for every mutation (sync, no
    // second failure mode — unlike a re-read).
    const prev = { spaces: get().spaces, threadsBySpace: get().threadsBySpace };
    set((s) => ({
      spaces: s.spaces.map((sp) => (sp.id === spaceId ? { ...sp, name } : sp)),
    }));
    try {
      await api.updateSpace(spaceId, { name });
    } catch (e) {
      set(prev);
      throw e;
    }
  },

  deleteSpace: async (spaceId) => {
    const prev = { spaces: get().spaces, threadsBySpace: get().threadsBySpace };
    set((s) => {
      const { [spaceId]: _, ...rest } = s.threadsBySpace;
      return { spaces: s.spaces.filter((sp) => sp.id !== spaceId), threadsBySpace: rest };
    });
    try {
      await api.deleteSpace(spaceId);
    } catch (e) {
      set(prev);
      throw e;
    }
  },

  renameThread: async (spaceId, threadId, title) => {
    const prev = { spaces: get().spaces, threadsBySpace: get().threadsBySpace };
    set((s) => ({
      threadsBySpace: {
        ...s.threadsBySpace,
        [spaceId]: (s.threadsBySpace[spaceId] ?? []).map((t) =>
          t.id === threadId ? { ...t, title } : t,
        ),
      },
    }));
    try {
      await api.updateThread(threadId, { title });
    } catch (e) {
      set(prev);
      throw e;
    }
  },

  moveThread: async (threadId, fromSpaceId, toSpaceId) => {
    if (fromSpaceId === toSpaceId) return;
    const prev = { spaces: get().spaces, threadsBySpace: get().threadsBySpace };
    set((s) => {
      const moved = (s.threadsBySpace[fromSpaceId] ?? []).find((t) => t.id === threadId);
      if (!moved) return {};
      return {
        threadsBySpace: {
          ...s.threadsBySpace,
          [fromSpaceId]: (s.threadsBySpace[fromSpaceId] ?? []).filter((t) => t.id !== threadId),
          [toSpaceId]: [...(s.threadsBySpace[toSpaceId] ?? []), moved],
        },
        expanded: { ...s.expanded, [toSpaceId]: true },
      };
    });
    try {
      await api.updateThread(threadId, { space_id: toSpaceId });
    } catch (e) {
      set(prev);
      throw e;
    }
  },

  deleteThread: async (spaceId, threadId) => {
    // Snapshot BOTH slices: the optimistic edit also decrements spaces[].thread_count,
    // so a threadsBySpace-only rollback would leave the count badge stale.
    const prev = { spaces: get().spaces, threadsBySpace: get().threadsBySpace };
    set((s) => ({
      threadsBySpace: {
        ...s.threadsBySpace,
        [spaceId]: (s.threadsBySpace[spaceId] ?? []).filter((t) => t.id !== threadId),
      },
      spaces: s.spaces.map((sp) =>
        sp.id === spaceId ? { ...sp, thread_count: Math.max(0, sp.thread_count - 1) } : sp,
      ),
    }));
    try {
      await api.deleteThread(threadId);
    } catch (e) {
      set(prev);
      throw e;
    }
  },
});
