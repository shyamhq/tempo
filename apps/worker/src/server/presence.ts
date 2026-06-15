// In-memory CLI presence registry. "Fresh" = a CLI process is holding
// a live SSE connection to the Thread right now (post-1d, the CLI is the
// long-lived presence beacon — not MCP `last_seen_at`). Browser SSE
// connections do NOT register here; only the CLI is "the Agent".
//
// Single-Worker assumption. Slice 2 may force gossip/Redis when Worker
// is horizontally scaled; until then, in-memory is correct and one-file.
//
// Lives in apps/worker/src/server/ rather than packages/server/ on
// purpose: a single Map<> is process-scoped. Importing from Console
// would silently produce a second empty Map.

const live = new Map<string, Set<string>>();

export function addConnection(threadId: string, connId: string): void {
  let set = live.get(threadId);
  if (!set) {
    set = new Set();
    live.set(threadId, set);
  }
  set.add(connId);
}

export function removeConnection(threadId: string, connId: string): void {
  const set = live.get(threadId);
  if (!set) return;
  set.delete(connId);
  if (set.size === 0) live.delete(threadId);
}

export function isFresh(threadId: string): boolean {
  // removeConnection deletes the entry when the set empties, so presence
  // is just "is the key here?"
  return live.has(threadId);
}
