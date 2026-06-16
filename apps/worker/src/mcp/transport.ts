import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpSession, markSessionDisconnected, touchSessionLastSeen } from '@tempo/server';
import type { Caller } from '../auth';
import { logger } from '../logger';
import { createMcpServer } from './server';

// The MCP transport binds the Caller to the session so resumed requests with
// a different identity (e.g. another workspace's API key guessing the session
// UUID, or an sk_user_ token resuming an sk_agent_ session) are rejected.
//
// No TTL eviction here: slice 2 will swap this for a Redis-backed store with
// idle expiry when horizontal scaling demands it. For a single-instance
// Worker with low session counts the unbounded growth risk is acceptable
// because `transport.onclose` clears the entry on the SDK's normal close path.
type SessionEntry = { transport: StreamableHTTPServerTransport; caller: Caller };
const sessions = new Map<string, SessionEntry>();

function callerMatches(a: Caller, b: Caller): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'agent' && b.kind === 'agent') return a.workspaceId === b.workspaceId;
  if (a.kind === 'hosted' && b.kind === 'hosted') {
    return a.threadId === b.threadId && a.workspaceId === b.workspaceId;
  }
  return 'userId' in a && 'userId' in b && a.userId === b.userId;
}

// Handles all traffic to the /mcp route. The Express route has already run
// bearerAuth so `caller` is trusted.
export async function handleMcpRequest(
  caller: Caller,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'];
  const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  if (req.method === 'POST' && !id) {
    // New session — allocate transport + server bound to this auth context.
    let mcpSessionId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        mcpSessionId = crypto.randomUUID();
        return mcpSessionId;
      },
    });
    const server = createMcpServer(caller, () => mcpSessionId);
    await server.connect(transport);
    transport.onclose = () => {
      const id = transport.sessionId;
      if (!id) return;
      sessions.delete(id);
      markSessionDisconnected(id).catch((err) =>
        logger.error({ err, sessionId: id }, 'mcp: markSessionDisconnected failed'),
      );
      logger.debug({ sessionId: id }, 'mcp: session closed');
    };
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, caller });
      logger.debug({ sessionId: transport.sessionId }, 'mcp: session opened');
      // For CLI/browser callers: the JWT carries only userId, not threadId.
      // The CLI passes X-Tempo-Thread-Id so we can register the sticky session
      // row here — same lifecycle events as the hosted runner's postAgentEvent.
      const rawThreadId = req.headers['x-tempo-thread-id'];
      const threadId = Array.isArray(rawThreadId) ? rawThreadId[0] : rawThreadId;
      if (threadId && (caller.kind === 'cli' || caller.kind === 'browser')) {
        createMcpSession(threadId, transport.sessionId).catch((err) =>
          logger.error(
            { err, threadId, sessionId: transport.sessionId },
            'mcp: createMcpSession failed',
          ),
        );
      }
    }
    return;
  }

  if (id) {
    const entry = sessions.get(id);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'session_not_found' }));
      return;
    }
    // Return 404 (not 403) on identity mismatch so existence of the session
    // is not observable across identity boundaries.
    if (!callerMatches(entry.caller, caller)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'session_not_found' }));
      return;
    }
    // Heartbeat: keep last_seen_at fresh so Console's 45 s presence check
    // reflects actual activity, not just the attach timestamp. Fire-and-
    // forget; a missed heartbeat is recoverable on the next request.
    void touchSessionLastSeen(id).catch((err) =>
      logger.error({ err, sessionId: id }, 'mcp: touchSessionLastSeen failed'),
    );
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'bad_request' }));
}
