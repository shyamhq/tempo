// Hydration: one pass that fetches a thread's full state and seeds every live
// slice. This is the plain-fetch seed the architecture calls for (no TanStack
// Query in the live thread path) — after it runs, the event gateway is the only
// writer of remote thread state.
//
// Seeds in one pass so stale data can't bleed across threads: every setter
// REPLACES its whole collection (setThread / setComments / setDiscussion /
// setPlan / setRepos / setPersistedMessages), so re-running hydrate for a new
// threadId is itself the reset — there is no append to clear. The agent slice is
// keyed by threadId, so persisted messages are isolated per thread.
//
// Reused as the resync path: the gateway's onResyncNeeded (a reconnect after a
// drop that may have outlived Redis retention) re-runs hydrate to re-seed.

import { getPersistedMessages } from '../features/agent/api';
import { getRepos, getThread } from '../features/thread/api';
import { useThreadStore } from '../store';

export async function hydrateThread(threadId: string): Promise<void> {
  const [view, repos, agentMessages] = await Promise.all([
    getThread(threadId),
    // Repos are non-critical context (a user-only endpoint); a failure here must
    // not abort the whole hydrate. Degrade to an empty list. (getThread and the
    // persisted messages stay all-or-nothing — a half-seeded store is worse.)
    getRepos(threadId).catch(() => [] as string[]),
    getPersistedMessages(threadId),
  ]);

  const store = useThreadStore.getState();
  store.setThread(view);
  store.setRepos(repos);
  store.setComments(view.comments);
  // The discussion slice holds a flat array; unwrap view.discussion.messages.
  store.setDiscussion(view.discussion.messages);
  store.setPlan(view.plan);
  store.setPersistedMessages(threadId, agentMessages);
}
