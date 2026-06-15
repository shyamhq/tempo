import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AttachInput } from '@tempo/contracts/mcp';
import { runAttach } from './tools/attach';
import type { AuthContext } from './transport';

// Creates a new McpServer instance for one authenticated session.
// auth and getMcpSessionId are captured by closure from the transport layer —
// no global request context or extra._meta tricks needed.
//
// getMcpSessionId is a getter because the SDK assigns the session UUID during
// the initialize handshake (inside the first transport.handleRequest call),
// which happens after createMcpServer returns. By the time tempo_attach is
// invoked the getter always returns a non-null value.
export function createMcpServer(
  auth: AuthContext,
  getMcpSessionId: () => string | undefined = () => undefined,
): McpServer {
  const server = new McpServer({ name: 'tempo', version: '0.2.0' });

  // tempo_attach — fetches full Thread state and establishes a sticky session.
  // Caller passes thread_id; runAttach branches on auth.source to do either a
  // workspace-isolation check (agent/browser) or a membership check (cli).
  server.tool(
    'tempo_attach',
    'Attach to a planning Thread. Fetches thread metadata, plan status, open comments, discussion messages, the latest event cursor, and the workflow guide. Call once at the start of each session.',
    AttachInput.shape,
    async (args) => {
      const mcpSessionId = getMcpSessionId();
      const result = await runAttach(args.thread_id, auth, mcpSessionId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  return server;
}
