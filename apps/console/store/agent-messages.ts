'use client';

// Per-thread UIMessage store. Persisted messages arrive via the REST route on
// mount; live in-progress messages are assembled from agent_chunk SSE frames
// via readUIMessageStream in use-thread-events.ts and written here by turn id.
// The two lists are merged in order for rendering: persisted (oldest-first)
// followed by the single live in-progress message if one exists.

import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import { create } from 'zustand';

interface AgentMessagesState {
  // Persisted messages keyed by threadId.
  persisted: Record<string, TempoUIMessage[]>;
  // Live in-progress message per threadId (at most one active turn at a time).
  live: Record<string, TempoUIMessage>;

  setPersistedMessages: (threadId: string, messages: TempoUIMessage[]) => void;
  setLiveMessage: (threadId: string, message: TempoUIMessage) => void;
  clearLiveMessage: (threadId: string) => void;
}

// Named *Store to avoid colliding with the useAgentMessages hook (which returns
// the merged list). The merge lives in that hook, not here — a store getter that
// allocated a new array would re-render every subscriber on any mutation.
export const useAgentMessagesStore = create<AgentMessagesState>((set) => ({
  persisted: {},
  live: {},

  setPersistedMessages: (threadId, messages) =>
    set((s) => ({ persisted: { ...s.persisted, [threadId]: messages } })),

  setLiveMessage: (threadId, message) => set((s) => ({ live: { ...s.live, [threadId]: message } })),

  clearLiveMessage: (threadId) =>
    set((s) => {
      const { [threadId]: _, ...rest } = s.live;
      return { live: rest };
    }),
}));
