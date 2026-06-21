'use client';

// Sidebar slice: the spaces/threads navigation tree. Spaces are non-realtime
// (loaded via Query, T2.3), so the tree is seeded by setSidebar. The one live
// touch point is thread_renamed — the gateway routes it here too so a rename
// updates the title in the rail without a refetch (the old console pinged the
// ['space-threads'] query; here it's a direct in-tree edit).

import type { Space, SpaceThreadLite } from '@tempo/contracts';
import type { ThreadRenamedEvent } from '@tempo/contracts/events';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

export interface SidebarTree {
  spaces: Space[];
  // Threads per space, keyed by SpaceId. Absent key = that space's threads have
  // not been loaded yet (lazy-loaded on expand).
  threadsBySpace: Record<string, SpaceThreadLite[]>;
}

export interface SidebarSlice extends SidebarTree {
  setSidebar: (tree: SidebarTree) => void;
  // Distinct name from the thread slice's applyThreadRenamed: a single combined
  // store has one namespace, and the gateway fans thread_renamed to BOTH the
  // thread meta (title in the header) and the sidebar tree (title in the rail).
  applyThreadRenamedInTree: (e: z.infer<typeof ThreadRenamedEvent>, threadId: string) => void;
}

export const createSidebarSlice: StateCreator<ThreadStore, [], [], SidebarSlice> = (set) => ({
  spaces: [],
  threadsBySpace: {},

  setSidebar: (tree) => set({ spaces: tree.spaces, threadsBySpace: tree.threadsBySpace }),

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
});
