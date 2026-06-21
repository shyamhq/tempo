'use client';

// Discussion slice: the ordered DiscussionMessage[]. The composer sends without
// an optimistic row, so the only append path is the server's echoed
// discussion_message_posted event; the dedup-by-id keeps a re-delivered event
// from doubling a message.

import type { DiscussionMessage } from '@tempo/contracts';
import type { DiscussionMessagePostedEvent } from '@tempo/contracts/events';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

export interface DiscussionSlice {
  discussion: DiscussionMessage[];

  setDiscussion: (messages: DiscussionMessage[]) => void;
  applyDiscussionMessagePosted: (e: z.infer<typeof DiscussionMessagePostedEvent>) => void;
}

export const createDiscussionSlice: StateCreator<ThreadStore, [], [], DiscussionSlice> = (set) => ({
  discussion: [],

  setDiscussion: (messages) => set({ discussion: messages }),

  applyDiscussionMessagePosted: (e) =>
    set((s) => ({
      discussion: s.discussion.some((m) => m.id === e.message.id)
        ? s.discussion
        : [...s.discussion, e.message],
    })),
});
