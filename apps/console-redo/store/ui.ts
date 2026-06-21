'use client';

// Global UI slice: viewer preferences that aren't tied to one feature's data —
// the left nav rail, the right dockable panel, display density, and
// per-thread/-comment "last seen" timestamps. This is the ONLY persisted slice
// (localStorage via the persist middleware in store/index.ts, partialized to
// exactly these fields), so layout choices and read-state survive reloads while
// live thread data does not.
//
// railOpen  → the left workspace/spaces/threads nav (the app frame's sidebar).
// dockOpen  → the right dockable panel (Phase 5 fills it with discussion/agent);
//             railTab selects which view it shows.

import type { StateCreator } from 'zustand';
import type { ThreadStore } from './index';

export type RailTab = 'discussion' | 'comment';
export type Density = 'comfortable' | 'compact';

export interface UiSlice {
  railOpen: boolean;
  railTab: RailTab;
  dockOpen: boolean;
  density: Density;
  // Per-thread / per-comment last-seen ISO timestamps; absent key = never seen.
  discussionSeenAt: Record<string, string>;
  commentSeenAt: Record<string, string>;

  setRailOpen: (open: boolean) => void;
  toggleRail: () => void;
  setRailTab: (tab: RailTab) => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setDensity: (density: Density) => void;
  markDiscussionSeen: (threadId: string) => void;
  markCommentSeen: (commentId: string) => void;
}

export const createUiSlice: StateCreator<ThreadStore, [], [], UiSlice> = (set) => ({
  railOpen: true,
  railTab: 'discussion',
  dockOpen: false,
  density: 'comfortable',
  discussionSeenAt: {},
  commentSeenAt: {},

  setRailOpen: (open) => set({ railOpen: open }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
  setRailTab: (tab) => set({ railTab: tab }),
  setDockOpen: (open) => set({ dockOpen: open }),
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
  setDensity: (density) => set({ density }),

  markDiscussionSeen: (threadId) =>
    set((s) => ({
      discussionSeenAt: { ...s.discussionSeenAt, [threadId]: new Date().toISOString() },
    })),
  markCommentSeen: (commentId) =>
    set((s) => ({
      commentSeenAt: { ...s.commentSeenAt, [commentId]: new Date().toISOString() },
    })),
});

// The persisted projection — store/index.ts partializes to exactly this so live
// thread state (comments, discussion, plan, agent) never leaks into localStorage.
export type PersistedUiState = Pick<
  UiSlice,
  'railOpen' | 'railTab' | 'dockOpen' | 'density' | 'discussionSeenAt' | 'commentSeenAt'
>;
