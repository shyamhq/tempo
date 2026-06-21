'use client';

// Composition root: the ONE place that imports every feature slice + the global
// UI slice and combines them into a single useThreadStore — the single source of
// truth for live thread state (no dual Query cache). The event gateway (T2.2) is
// the only writer of remote thread state; it calls these slice actions via
// useThreadStore.getState(). Components read via the selectors below and trigger
// behavior by calling actions — they never see fetch, Zod, or a business rule.

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { type AgentSlice, createAgentSlice, mergeAgentMessages } from '../features/agent/store';
import { type CommentsSlice, createCommentsSlice } from '../features/comments/store';
import { createDiscussionSlice, type DiscussionSlice } from '../features/discussion/store';
import { createPlanSlice, type PlanSlice } from '../features/plan/store';
import { createSidebarSlice, type SidebarSlice } from '../features/sidebar/store';
import { createThreadSlice, type ThreadSlice } from '../features/thread/store';
import { createUiSlice, type PersistedUiState, type UiSlice } from './ui';

export type ThreadStore = ThreadSlice &
  CommentsSlice &
  DiscussionSlice &
  PlanSlice &
  AgentSlice &
  SidebarSlice &
  UiSlice;

export const useThreadStore = create<ThreadStore>()(
  persist(
    (...a) => ({
      ...createThreadSlice(...a),
      ...createCommentsSlice(...a),
      ...createDiscussionSlice(...a),
      ...createPlanSlice(...a),
      ...createAgentSlice(...a),
      ...createSidebarSlice(...a),
      ...createUiSlice(...a),
    }),
    {
      name: 'tempo:ui',
      version: 1,
      // Persist ONLY the ui slice — live thread state (comments, discussion,
      // plan, agent, sidebar tree) is hydrated/streamed, never cached to disk.
      partialize: (s): PersistedUiState => ({
        railOpen: s.railOpen,
        railTab: s.railTab,
        dockOpen: s.dockOpen,
        density: s.density,
        discussionSeenAt: s.discussionSeenAt,
        commentSeenAt: s.commentSeenAt,
      }),
    },
  ),
);

// ---- Selectors ------------------------------------------------------------
//
// Single-value selects (e.g. useThread()) return a stable reference and are
// safe as-is. Multi-value selects must wrap the object literal in useShallow,
// otherwise the new object identity on every store write forces a re-render —
// see useThreadStatus below.

export const useThread = () => useThreadStore((s) => s.thread);
export const useComments = () => useThreadStore((s) => s.comments);
export const useDiscussion = () => useThreadStore((s) => s.discussion);
export const usePlan = () => useThreadStore((s) => s.plan);
export const useSidebarSpaces = () => useThreadStore((s) => s.spaces);
export const useSpaceThreads = (spaceId: string) =>
  useThreadStore((s) => s.threadsBySpace[spaceId]);
export const useSpaceExpanded = (spaceId: string) =>
  useThreadStore((s) => s.expanded[spaceId] ?? false);

export const useThreadStatus = () =>
  useThreadStore(useShallow((s) => ({ agentPresent: s.agentPresent, vm: s.vm, repos: s.repos })));

export const useRailOpen = () => useThreadStore((s) => s.railOpen);
export const useDockOpen = () => useThreadStore((s) => s.dockOpen);

// Agent messages: select the two raw slices for this thread separately (each
// only changes when its own data does), then merge — the merge dedups the live
// turn against the persisted list so the live→persisted handoff never
// double-renders. useShallow guards the [persisted, live] tuple identity.
export const useAgentMessages = (threadId: string) => {
  const persisted = useThreadStore((s) => s.agentPersisted[threadId]);
  const live = useThreadStore((s) => s.agentLive[threadId]);
  return useMemo(() => mergeAgentMessages(persisted, live), [persisted, live]);
};
