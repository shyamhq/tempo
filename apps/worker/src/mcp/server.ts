import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runAttach } from './tools/attach';

// Creates a new McpServer instance for one authenticated session.
// workspaceId is captured by closure from the auth middleware — no global
// request context or extra._meta tricks needed.
export function createMcpServer(workspaceId: string): McpServer {
  const server = new McpServer({ name: 'tempo', version: '0.2.0' });

  // tempo_attach — fetches full Thread state for the attached session.
  //
  // TODO(slice-1c): The { session_id } input here is a 1b-only convenience and
  // does NOT match @tempo/contracts AttachInput, which is z.object({}). Before
  // 1c ships, two things must happen:
  //   1. @tempo/contracts AttachInput must be updated (it's the canonical wire
  //      shape; Worker advertising a different schema is a divergence).
  //   2. The mechanism by which a remote MCP client (the user's claude binary)
  //      knows its session_id must be decided. Three live options:
  //        (a) embed in the MCP server URL as a path segment (.mcp.json url),
  //        (b) embed in the API key (session-scoped tokens, not workspace-scoped),
  //        (c) pass on every tool call (current 1b stub shape).
  // The decision belongs in the slice-1c grilling.
  server.tool(
    'tempo_attach',
    'Attach to a planning Thread. Fetches thread metadata, plan status, open comments, discussion messages, the latest event cursor, and the workflow guide. Call once at the start of each session. Pass the session_id you received from `tempo-agent init`.',
    { session_id: z.string().describe('Tempo Session ID (ses_…)') },
    async (args) => {
      const result = await runAttach(args.session_id, workspaceId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  return server;
}
