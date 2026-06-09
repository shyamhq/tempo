'use client';

// Shared UI state for the enlarged-comment surface. Three React subtrees
// coordinate through this store: the gutter (highlight + click target),
// the floating card (which hides itself while enlarged), and the rail's
// Comment tab (which renders the panel-variant card via a portal).
//
// Side effects (e.g. clearing BlockNote's `selectedThreadId` on close)
// live in consumer-side effects, not in store actions — the store stays
// editor-unaware.

import { create } from 'zustand';

type RailTab = 'discussion' | 'comment';

type CommentUiState = {
  /** Currently enlarged Comment id, or null when the Comment tab is closed. */
  enlargedCommentId: string | null;
  /** Which left-rail tab is currently visible. */
  activeRailTab: RailTab;
  /** Mount point for the panel-variant card. ThreadView sets this via a
   *  callback ref when the Comment tab body renders; PlanEditor portals the
   *  card into it from inside BlockNoteView so the card's hooks resolve. */
  panelMount: HTMLDivElement | null;

  setEnlarged: (commentId: string) => void;
  closeEnlarged: () => void;
  setActiveRailTab: (tab: RailTab) => void;
  setPanelMount: (el: HTMLDivElement | null) => void;
};

export const useCommentUi = create<CommentUiState>((set) => ({
  enlargedCommentId: null,
  activeRailTab: 'discussion',
  panelMount: null,
  setEnlarged: (commentId) => set({ enlargedCommentId: commentId, activeRailTab: 'comment' }),
  closeEnlarged: () => set({ enlargedCommentId: null, activeRailTab: 'discussion' }),
  setActiveRailTab: (tab) => set({ activeRailTab: tab }),
  setPanelMount: (el) => set({ panelMount: el }),
}));
