'use client';

// Thread-scoped UI state. Three slices that coordinate the right-rail layout,
// the Comment / Discussion tab switch, and per-thread "last seen" timestamps.
// Persisted: discussionWidth (one value) and discussionSeenAt (per-thread map).

import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

type RailTab = 'discussion' | 'comment';

// Sized to match chat/thread side panels in Slack, Linear, and Notion (~360–440px).
// Below ~360 the Agent's question cards (multi-line text + option buttons) wrap
// awkwardly; above ~720 the plan column starts feeling cramped.
export const MIN_DISCUSSION_WIDTH = 360;
export const MAX_DISCUSSION_WIDTH = 720;
export const DEFAULT_DISCUSSION_WIDTH = 440;

function clampWidth(w: number): number {
  return Math.max(MIN_DISCUSSION_WIDTH, Math.min(MAX_DISCUSSION_WIDTH, Math.round(w)));
}

type Mutators = [['zustand/devtools', never], ['zustand/persist', unknown]];

// ---- Rail slice -----------------------------------------------------------

interface RailSlice {
  discussionOpen: boolean;
  activeRailTab: RailTab;
  enlargedCommentId: string | null;
  panelMount: HTMLDivElement | null;
  setEnlarged: (commentId: string) => void;
  closeEnlarged: () => void;
  setActiveRailTab: (tab: RailTab) => void;
  setPanelMount: (el: HTMLDivElement | null) => void;
  setDiscussionOpen: (open: boolean) => void;
  toggleDiscussion: () => void;
  closeRail: () => void;
}

const createRailSlice: StateCreator<ThreadUiState, Mutators, [], RailSlice> = (set) => ({
  discussionOpen: false,
  activeRailTab: 'discussion',
  enlargedCommentId: null,
  panelMount: null,
  // `setEnlarged` is the sole writer of the null → set transition. Bundling
  // discussionOpen + activeRailTab into the same set() keeps the three fields
  // consistent — they cannot drift to "comment tab visible but rail closed".
  setEnlarged: (commentId) =>
    set(
      { enlargedCommentId: commentId, activeRailTab: 'comment', discussionOpen: true },
      undefined,
      'rail/setEnlarged',
    ),
  closeEnlarged: () =>
    set({ enlargedCommentId: null, activeRailTab: 'discussion' }, undefined, 'rail/closeEnlarged'),
  setActiveRailTab: (tab) => set({ activeRailTab: tab }, undefined, 'rail/setActiveRailTab'),
  setPanelMount: (el) => set({ panelMount: el }, undefined, 'rail/setPanelMount'),
  setDiscussionOpen: (open) => set({ discussionOpen: open }, undefined, 'rail/setDiscussionOpen'),
  toggleDiscussion: () =>
    set((s) => ({ discussionOpen: !s.discussionOpen }), undefined, 'rail/toggleDiscussion'),
  // Closing the rail forces the Comment tab back to Discussion so a later
  // re-open doesn't resurrect a stale enlarged comment.
  closeRail: () =>
    set(
      { discussionOpen: false, enlargedCommentId: null, activeRailTab: 'discussion' },
      undefined,
      'rail/closeRail',
    ),
});

// ---- Layout slice ---------------------------------------------------------

interface LayoutSlice {
  discussionWidth: number;
  setDiscussionWidth: (w: number) => void;
}

const createLayoutSlice: StateCreator<ThreadUiState, Mutators, [], LayoutSlice> = (set) => ({
  discussionWidth: DEFAULT_DISCUSSION_WIDTH,
  setDiscussionWidth: (w) =>
    set({ discussionWidth: clampWidth(w) }, undefined, 'layout/setDiscussionWidth'),
});

// ---- Seen slice -----------------------------------------------------------

interface SeenSlice {
  discussionSeenAt: Record<string, string>;
  markDiscussionSeen: (threadId: string) => void;
}

const createSeenSlice: StateCreator<ThreadUiState, Mutators, [], SeenSlice> = (set) => ({
  discussionSeenAt: {},
  markDiscussionSeen: (threadId) =>
    set(
      (s) => ({
        discussionSeenAt: { ...s.discussionSeenAt, [threadId]: new Date().toISOString() },
      }),
      undefined,
      'seen/markDiscussionSeen',
    ),
});

// ---- Combined store -------------------------------------------------------

export type ThreadUiState = RailSlice & LayoutSlice & SeenSlice;

export const useThreadUi = create<ThreadUiState>()(
  devtools(
    persist(
      (...a) => ({
        ...createRailSlice(...a),
        ...createLayoutSlice(...a),
        ...createSeenSlice(...a),
      }),
      {
        name: 'tempo:thread-ui',
        version: 2,
        partialize: (s) => ({
          discussionWidth: s.discussionWidth,
          discussionSeenAt: s.discussionSeenAt,
        }),
        // v1 → v2: bumped MIN/DEFAULT to match industry chat-panel widths.
        // Existing values below the new MIN get reset to the new default.
        migrate: (persisted, _version) => {
          const s = (persisted ?? {}) as Partial<LayoutSlice & SeenSlice>;
          return {
            discussionWidth: clampWidth(s.discussionWidth ?? DEFAULT_DISCUSSION_WIDTH),
            discussionSeenAt: s.discussionSeenAt ?? {},
          };
        },
      },
    ),
    { name: 'thread-ui', enabled: process.env.NODE_ENV !== 'production' },
  ),
);
