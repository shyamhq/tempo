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
        dockOpen: s.dockOpen,
        discussionWidth: s.discussionWidth,
        discussionSeenAt: s.discussionSeenAt,
        commentSeenAt: s.commentSeenAt,
        draftedBannerDismissed: s.draftedBannerDismissed,
      }),
    },
  ),
);

// ---- Selectors ------------------------------------------------------------
//
// Single-value selects (e.g. useThread()) return a stable reference and are
// safe as-is. A multi-value select would need useShallow (or a useMemo over a
// tuple, as useAgentMessages does), otherwise a fresh object identity on every
// store write forces a re-render.

export const useThread = () => useThreadStore((s) => s.thread);
export const useComments = () => useThreadStore((s) => s.comments);
export const useDiscussion = () => useThreadStore((s) => s.discussion);
export const usePlan = () => useThreadStore((s) => s.plan);
export const useSidebarSpaces = () => useThreadStore((s) => s.spaces);
export const useSpaceThreads = (spaceId: string) =>
  useThreadStore((s) => s.threadsBySpace[spaceId]);
export const useSpaceExpanded = (spaceId: string) =>
  useThreadStore((s) => s.expanded[spaceId] ?? false);

// The only thread-status fact any current surface reads is agent presence (the
// dock's live/idle dot, the sidebar's badge). A single-value select keeps both
// from re-rendering on vm/repos churn; widen to a useShallow object select if a
// caller ever needs more than presence.
export const useAgentPresent = () => useThreadStore((s) => s.agentPresent);

// The VM provisioning snapshot (null when no Sandbox is provisioning) — the
// status strip's VM pill reads it. Single-value select: the object reference is
// stable until the gateway writes a new vm frame.
export const useVm = () => useThreadStore((s) => s.vm);

// Local vs hosted. Drives the VM-only surfaces (the status strip's "VM sandbox"
// pill, the discussion provisioning card) so they never render for a Local thread.
export const useAgentType = () => useThreadStore((s) => s.thread?.agent_type ?? null);

// Whether a turn is streaming right now: the gateway holds the in-progress
// message in agentLive while a turn runs and clears it on agent_turn_ended, so
// its presence is the authoritative "live" signal (vs. heuristically reading
// part states). The status strip's pulsing ring + the drawer's progress bar use
// it.
export const useAgentTurnLive = (threadId: string) =>
  useThreadStore((s) => s.agentLive[threadId] !== undefined);

export const useRailOpen = () => useThreadStore((s) => s.railOpen);
export const useDockOpen = () => useThreadStore((s) => s.dockOpen);
export const useDiscussionWidth = () => useThreadStore((s) => s.discussionWidth);
export const useActivityOpen = () => useThreadStore((s) => s.activityOpen);
export const useSettingsOpen = () => useThreadStore((s) => s.settingsOpen);
export const useSettingsSection = () => useThreadStore((s) => s.settingsSection);
export const useDraftedBannerDismissed = (threadId: string) =>
  useThreadStore((s) => s.draftedBannerDismissed[threadId] ?? false);

// The breadcrumb space name. ThreadSummary carries no space_id, so resolve it
// from the already-hydrated sidebar tree: the space whose thread list contains
// this thread. Null while the tree is still loading or the thread isn't in it.
export const useThreadSpaceName = (threadId: string): string | null =>
  useThreadStore((s) => {
    for (const space of s.spaces) {
      if ((s.threadsBySpace[space.id] ?? []).some((t) => t.id === threadId)) return space.name;
    }
    return null;
  });

// Agent messages: select the two raw slices for this thread separately (each
// only changes when its own data does), then merge — the merge dedups the live
// turn against the persisted list so the live→persisted handoff never
// double-renders. useMemo guards the [persisted, live] tuple identity.
export const useAgentMessages = (threadId: string) => {
  const persisted = useThreadStore((s) => s.agentPersisted[threadId]);
  const live = useThreadStore((s) => s.agentLive[threadId]);
  return useMemo(() => mergeAgentMessages(persisted, live), [persisted, live]);
};
