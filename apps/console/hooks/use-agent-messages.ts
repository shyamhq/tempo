'use client';

// Loads persisted agent messages for a thread on mount via React Query, writes
// them into the zustand store, and returns the merged render list: persisted
// (oldest-first) + the live in-progress message, deduped by id so a turn never
// double-renders during the live→persisted handoff.

import { useQuery } from '@tanstack/react-query';
import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import { useEffect, useMemo } from 'react';
import { api } from '../lib/api-client';
import { useAgentMessagesStore } from '../store/agent-messages';

export function useAgentMessages(threadId: string): TempoUIMessage[] {
  const setPersistedMessages = useAgentMessagesStore((s) => s.setPersistedMessages);

  const { data } = useQuery({
    queryKey: ['agent-messages', threadId],
    queryFn: () => api.getAgentMessages(threadId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data) setPersistedMessages(threadId, data);
  }, [data, threadId, setPersistedMessages]);

  // Select stable slices (each only changes when its thread's data changes), then
  // merge — keeps the subscription from re-rendering on unrelated store writes.
  const persisted = useAgentMessagesStore((s) => s.persisted[threadId]);
  const live = useAgentMessagesStore((s) => s.live[threadId]);
  return useMemo(() => {
    const base = persisted ?? [];
    if (!live || base.some((m) => m.id === live.id)) return base;
    return [...base, live];
  }, [persisted, live]);
}
