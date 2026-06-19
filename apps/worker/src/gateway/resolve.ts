import { ForbiddenError } from '@tempo/errors';
import { bumpAgentLastSeen } from '@tempo/server';
import { authorizeThread, type Caller } from '../auth';
import type { ConnectorCallContext } from './connector-call';

// Resolves + authorizes the thread for a connector tool call and returns both
// the threadId and the owning workspaceId (connector tools need the workspace
// for the allowlist + audit, which the existing resolveThreadIdForCaller does
// not surface). Mirrors that helper otherwise: hosted callers carry the
// threadId in their JWT; CLI / browser callers pass it on X-Tempo-Thread-Id,
// and authorizeThread rejects a forged header. Returns null on missing /
// unauthorized — the tool surfaces that as thread_id_required.
export async function resolveThreadWorkspace(
  caller: Caller,
  headerThreadId: string | undefined,
): Promise<ConnectorCallContext | null> {
  // Connector tools are an Agent surface (cli / browser / agent / hosted). The
  // `internal` server-to-server caller exists only for hosted/wake — it is
  // trusted to any thread without a workspace check, so it must never be able to
  // reach a connector (which would let it read any workspace's external data).
  if (caller.kind === 'internal') return null;

  const threadId = caller.kind === 'hosted' ? caller.threadId : (headerThreadId ?? null);
  if (!threadId) return null;
  try {
    const workspaceId = await authorizeThread(caller, threadId);
    // Same presence bump the other tool entry points fire — the Agent touched us.
    void bumpAgentLastSeen(threadId).catch(() => {});
    return { threadId, workspaceId };
  } catch (err) {
    // Only an authorization denial means "no access" → the tool surfaces
    // thread_id_required. Any other error (DB down, Clerk timeout) is a real
    // failure: let it propagate so the Agent sees an error, not a misleading
    // "missing header" (and so the failure isn't silently un-audited).
    if (err instanceof ForbiddenError) return null;
    throw err;
  }
}
