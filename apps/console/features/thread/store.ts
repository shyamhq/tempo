'use client';

// Thread meta slice: identity + transient live status (agent presence, VM
// provisioning). Seeded from GetThreadResponse on hydration; kept current by the
// event gateway (thread_renamed, repo_linked) and the SSE-only presence/vm frames.

import type { ThreadSummary } from '@tempo/contracts';
import type {
  PresenceSignal,
  RepoLinkedEvent,
  ThreadRenamedEvent,
  VmSignal,
} from '@tempo/contracts/events';
import type { GetThreadResponse } from '@tempo/contracts/http';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

type ThreadView = z.infer<typeof GetThreadResponse>;
type VmState = ThreadView['vm'];

export interface ThreadSlice {
  thread: ThreadSummary | null;
  repos: string[];
  agentPresent: boolean;
  vm: VmState;

  setThread: (view: ThreadView) => void;
  // Repos are not on GetThreadResponse — hydration seeds them from the separate
  // /repos read through this setter (the same writer repo_linked routes through).
  setRepos: (repos: string[]) => void;
  applyThreadRenamed: (e: z.infer<typeof ThreadRenamedEvent>) => void;
  applyRepoLinked: (e: z.infer<typeof RepoLinkedEvent>) => void;
  applyPresence: (frame: z.infer<typeof PresenceSignal>) => void;
  applyVm: (frame: z.infer<typeof VmSignal>) => void;
}

export const createThreadSlice: StateCreator<ThreadStore, [], [], ThreadSlice> = (set) => ({
  thread: null,
  repos: [],
  agentPresent: false,
  vm: null,

  setThread: (view) =>
    set({
      thread: view.thread,
      agentPresent: view.agent_present,
      vm: view.vm,
    }),

  setRepos: (repos) => set({ repos }),

  applyThreadRenamed: (e) =>
    set((s) => (s.thread ? { thread: { ...s.thread, title: e.title } } : {})),

  applyRepoLinked: (e) => set({ repos: e.repos }),

  applyPresence: (frame) => set({ agentPresent: frame.online }),

  applyVm: (frame) => set({ vm: frame.vm }),
});
