import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../logger';
import { createMcpServer } from './server';

// Per-Mcp-Session-Id in-memory store. workspaceId is stored alongside the
// transport so a resumed request whose Bearer token resolves to a different
// workspace is rejected (otherwise a workspace's API key that learns or
// guesses another workspace's session ID could send into it).
//
// No TTL eviction here: slice 2 will swap this for a Redis-backed store with
// idle expiry when horizontal scaling demands it. For a single-instance
// Worker with low session counts the unbounded growth risk is acceptable
// because `transport.onclose` clears the entry on the SDK's normal close path.
type SessionEntry = { transport: StreamableHTTPServerTransport; workspaceId: string };
const sessions = new Map<string, SessionEntry>();

// Handles all traffic to the /mcp route. The caller (Express route handler)
// has already run bearerAuth so workspaceId is known and trusted.
export async function handleMcpRequest(
  workspaceId: string,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'];
  const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  if (req.method === 'POST' && !id) {
    // New session — allocate transport + server bound to this workspace.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const server = createMcpServer(workspaceId);
    await server.connect(transport);
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        logger.debug({ sessionId: transport.sessionId }, 'mcp: session closed');
      }
    };
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, workspaceId });
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
    // Return 404 (not 403) on workspace mismatch so existence of the session
    // is not observable across workspace boundaries.
    if (entry.workspaceId !== workspaceId) {
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
