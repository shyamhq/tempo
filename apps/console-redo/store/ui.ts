'use client';

// Global UI slice: viewer preferences that aren't tied to one feature's data —
// the left nav rail, the right dockable panel, and per-thread/-comment "last
// seen" timestamps. This is the ONLY persisted slice (localStorage via the
// persist middleware in store/index.ts, partialized to exactly these fields), so
// layout choices and read-state survive reloads while live thread data does not.
//
// railOpen  → the left workspace/spaces/threads nav (the app frame's sidebar).
// dockOpen  → the right dockable panel (the Discussion dock).

import type { StateCreator } from 'zustand';
import type { ThreadStore } from './index';

export const MIN_DISCUSSION_WIDTH = 320;
export const MAX_DISCUSSION_WIDTH = 640;
const DEFAULT_DISCUSSION_WIDTH = 400;

const clampWidth = (w: number): number =>
  Math.max(MIN_DISCUSSION_WIDTH, Math.min(MAX_DISCUSSION_WIDTH, Math.round(w)));

export interface UiSlice {
  railOpen: boolean;
  dockOpen: boolean;
  // The dockable discussion panel's width in px (clamped 320–640). Persisted so
  // the layout choice survives reloads; the resizer in ThreadView drives it.
  discussionWidth: number;
  // Per-thread / per-comment last-seen ISO timestamps; absent key = never seen.
  discussionSeenAt: Record<string, string>;
  commentSeenAt: Record<string, string>;

  setRailOpen: (open: boolean) => void;
  toggleRail: () => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setDiscussionWidth: (px: number) => void;
  markDiscussionSeen: (threadId: string) => void;
  markCommentSeen: (commentId: string) => void;
}

export const createUiSlice: StateCreator<ThreadStore, [], [], UiSlice> = (set) => ({
  railOpen: true,
  dockOpen: false,
  discussionWidth: DEFAULT_DISCUSSION_WIDTH,
  discussionSeenAt: {},
  commentSeenAt: {},

  setRailOpen: (open) => set({ railOpen: open }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
  setDockOpen: (open) => set({ dockOpen: open }),
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
  setDiscussionWidth: (px) => set({ discussionWidth: clampWidth(px) }),

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
  'railOpen' | 'dockOpen' | 'discussionWidth' | 'discussionSeenAt' | 'commentSeenAt'
>;
