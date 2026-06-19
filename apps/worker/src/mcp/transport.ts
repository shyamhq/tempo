import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Caller } from '../auth';
import { createMcpServer } from './server';

// Stateless MCP transport. Each request stands up a fresh transport + server,
// runs the request, then tears down. No `Map<sessionId, …>`, no
// `session_not_found` after Worker restart, no cross-request caller binding —
// every request runs full Bearer auth on the way in. Tempo's MCP tools are
// single-shot RPC; we don't use the streaming/capability-negotiation features
// that need a stateful session.
export async function handleMcpRequest(
  caller: Caller,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const rawThreadId = req.headers['x-tempo-thread-id'];
  const threadId = Array.isArray(rawThreadId) ? rawThreadId[0] : rawThreadId;

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(caller, threadId);
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close().catch(() => {});
  }
}
