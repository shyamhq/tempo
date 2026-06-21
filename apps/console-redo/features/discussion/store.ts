'use client';

// Discussion slice: the ordered DiscussionMessage[]. Mirrors apply()'s
// dedup-by-id append so an optimistic local post and the server's echoed
// discussion_message_posted event reconcile to a single message.

import type { DiscussionMessage } from '@tempo/contracts';
import type { DiscussionMessagePostedEvent } from '@tempo/contracts/events';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

export interface DiscussionSlice {
  discussion: DiscussionMessage[];

  setDiscussion: (messages: DiscussionMessage[]) => void;
  applyDiscussionMessagePosted: (e: z.infer<typeof DiscussionMessagePostedEvent>) => void;
  addMessageLocal: (message: DiscussionMessage) => void;
}

function upsertMessage(
  messages: DiscussionMessage[],
  message: DiscussionMessage,
): DiscussionMessage[] {
  return messages.some((m) => m.id === message.id) ? messages : [...messages, message];
}

export const createDiscussionSlice: StateCreator<ThreadStore, [], [], DiscussionSlice> = (set) => ({
  discussion: [],

  setDiscussion: (messages) => set({ discussion: messages }),

  applyDiscussionMessagePosted: (e) =>
    set((s) => ({ discussion: upsertMessage(s.discussion, e.message) })),

  addMessageLocal: (message) => set((s) => ({ discussion: upsertMessage(s.discussion, message) })),
});
