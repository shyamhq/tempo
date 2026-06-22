'use client';

// Agent activity slice (ported from apps/console/store/agent-messages.ts). Agent
// activity IS the AI SDK UIMessage representation: a per-thread list of persisted
// messages plus, while a turn streams, a single live in-progress message
// assembled from agent_chunk frames via readUIMessageStream (the assembler runs
// in the gateway, T2.2 — this slice only stores the snapshots it produces).
//
// Live→persisted handoff invariant (the duplicate-turn bug this preserves
// against): the live message's `id` is the turn id (the agent_messages row id
// that AgentChunkFrame.turn references). On agent_turn_ended the live stream
// closes and the persisted refetch carries a message with the SAME id, so
// selectAgentMessages dedups the live slot away — the turn never double-renders.

import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

export interface AgentSlice {
  // Persisted messages keyed by threadId.
  agentPersisted: Record<string, TempoUIMessage[]>;
  // Live in-progress message per threadId (at most one active turn at a time).
  agentLive: Record<string, TempoUIMessage>;

  setPersistedMessages: (threadId: string, messages: TempoUIMessage[]) => void;
  setLiveMessage: (threadId: string, message: TempoUIMessage) => void;
  clearLiveMessage: (threadId: string) => void;
}

export const createAgentSlice: StateCreator<ThreadStore, [], [], AgentSlice> = (set) => ({
  agentPersisted: {},
  agentLive: {},

  setPersistedMessages: (threadId, messages) =>
    set((s) => ({ agentPersisted: { ...s.agentPersisted, [threadId]: messages } })),

  setLiveMessage: (threadId, message) =>
    set((s) => ({ agentLive: { ...s.agentLive, [threadId]: message } })),

  clearLiveMessage: (threadId) =>
    set((s) => {
      const { [threadId]: _, ...rest } = s.agentLive;
      return { agentLive: rest };
    }),
});

// The merge that realizes the handoff dedup: persisted (oldest-first) followed by
// the single live message, dropped when the persisted list already carries a
// message with the same turn id. Pure — call it inside a memoized selector with
// the two raw slices selected separately so it doesn't allocate on every store
// write (see store/index.ts selector note).
export function mergeAgentMessages(
  persisted: TempoUIMessage[] | undefined,
  live: TempoUIMessage | undefined,
): TempoUIMessage[] {
  const base = persisted ?? [];
  if (!live || base.some((m) => m.id === live.id)) return base;
  return [...base, live];
}
