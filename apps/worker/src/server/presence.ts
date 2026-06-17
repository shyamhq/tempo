// In-memory CLI presence registry. "Fresh" = a CLI process is holding
// a live long-poll request to the Thread right now. Browser SSE
// connections do NOT register here; only the CLI is "the Agent".
//
// Single-Worker assumption. Slice 2 may force gossip/Redis when Worker
// is horizontally scaled; until then, in-memory is correct and one-file.
//
// Lives in apps/worker/src/server/ rather than packages/server/ on
// purpose: a single Map<> is process-scoped. Importing from Console
// would silently produce a second empty Map.
//
// We intentionally do NOT fire `session_disconnected` from this file.
// A long-poll teardown is not a death signal — it just means that
// drain cycle returned events; the CLI typically goes off and processes
// them before opening the next request, leaving a gap that's not a
// hard-kill. Use clean detach (MCP transport.onclose →
// markSessionDisconnected) for the only reliable CLI disconnect.

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
  return live.has(threadId);
}
