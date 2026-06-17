// Shared MCP tool helpers. Keep this file small — it is here to remove
// 8-line duplications, not to grow into a misc bag.

// Standard "no thread id" response. Returned by every tool when
// resolveThreadId yields null (header missing, or authorize check failed).
// Hosted callers carry threadId in their JWT so this branch is unreachable
// for them — the wording targets CLI / browser callers.
export function threadIdRequired() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'thread_id_required',
          message: 'X-Tempo-Thread-Id header missing or not authorized',
        }),
      },
    ],
  };
}
