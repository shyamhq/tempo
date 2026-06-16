import { authorizeThread, type Caller, ForbiddenError } from '../../auth';

// Session registration now happens in transport.ts on MCP connect (via the
// X-Tempo-Thread-Id header the CLI sends). tempo_attach is an auth-only
// handshake — it verifies the caller can access the thread and returns the
// thread_id so the agent knows the tool call succeeded.
export async function runAttach(
  threadId: string,
  caller: Caller,
): Promise<{ thread_id: string } | { error: string }> {
  try {
    await authorizeThread(caller, threadId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (err.reason === 'thread_not_found') return { error: 'thread_not_found' };
      if (err.reason === 'not_member') return { error: 'not_a_member' };
      return { error: 'unauthorized' };
    }
    throw err;
  }
  return { thread_id: threadId };
}
