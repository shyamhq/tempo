import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../logger';
import { createMcpServer } from './server';

// Auth context resolved by the Bearer middleware before the request reaches
// this layer. The MCP transport binds this tuple to the session so resumed
// requests with a different identity (e.g. another workspace's API key
// guessing the session UUID, or an sk_user_ token resuming an sk_agent_
// session) are rejected.
export type AuthContext =
  | { source: 'agent'; workspaceId: string }
  | { source: 'cli'; userId: string }
  | { source: 'browser'; userId: string; workspaceId?: string };

// Per-Mcp-Session-Id in-memory store. AuthContext is stored alongside the
// transport so resume mismatches are rejected.
//
// No TTL eviction here: slice 2 will swap this for a Redis-backed store with
// idle expiry when horizontal scaling demands it. For a single-instance
// Worker with low session counts the unbounded growth risk is acceptable
// because `transport.onclose` clears the entry on the SDK's normal close path.
type SessionEntry = { transport: StreamableHTTPServerTransport; auth: AuthContext };
const sessions = new Map<string, SessionEntry>();

function authMatches(a: AuthContext, b: AuthContext): boolean {
  if (a.source !== b.source) return false;
  if (a.source === 'agent' && b.source === 'agent') return a.workspaceId === b.workspaceId;
  if (a.source === 'cli' && b.source === 'cli') return a.userId === b.userId;
  if (a.source === 'browser' && b.source === 'browser') return a.userId === b.userId;
  return false;
}

// Handles all traffic to the /mcp route. The caller (Express route handler)
// has already run bearerAuth so the AuthContext is trusted.
export async function handleMcpRequest(
  auth: AuthContext,
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
    const server = createMcpServer(auth, () => mcpSessionId);
    await server.connect(transport);
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        logger.debug({ sessionId: transport.sessionId }, 'mcp: session closed');
      }
    };
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, auth });
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
    // Return 404 (not 403) on auth mismatch so existence of the session
    // is not observable across identity boundaries.
    if (!authMatches(entry.auth, auth)) {
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
