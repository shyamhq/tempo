// Shared MCP tool helpers. Keep this file small — it is here to remove
// 8-line duplications, not to grow into a misc bag.

// Standard "session not attached" response. Returned by every tool when
// resolveThreadId yields null (cli/browser caller without an active
// sessions row). For hosted callers this branch is unreachable today —
// the JWT carries threadId — so the message wording is CLI-oriented.
export function sessionNotFound() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'session_not_found',
          message: 'call tempo_attach before this tool',
        }),
      },
    ],
  };
}
