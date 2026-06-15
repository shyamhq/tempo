import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
    // The mcpSessionId is the UUID assigned by the SDK after the first
    // initialize exchange; it's passed to the MCP server so tempo_attach
    // can write it into the sessions table for sticky-session mapping.
    let mcpSessionId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        mcpSessionId = crypto.randomUUID();
        return mcpSessionId;
      },
    });
    // Server is created before connect() so it can close over the same
    // mcpSessionId reference. By the time tempo_attach is called the
    // sessionIdGenerator will have run and mcpSessionId will be set.
    const server = createMcpServer(caller, () => mcpSessionId);
    await server.connect(transport);
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        logger.debug({ sessionId: transport.sessionId }, 'mcp: session closed');
      }
    };
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, caller });
      logger.debug({ sessionId: transport.sessionId }, 'mcp: session opened');
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
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'bad_request' }));
}
