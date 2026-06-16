import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEventsSinceLastTurn } from '@tempo/server';
import type { Caller } from '../../auth';

// Hosted-only MCP tool. Returns immediately with whatever Mailbox events
// are pending for the caller's Thread (auth-derived; no thread_id arg).
// Empty events array means no work pending — the runner sleeps 5s and
// polls again. No long-poll inside the tool by design; the runner's
// idle loop IS the wake mechanism.
export function registerPollHosted(server: McpServer, caller: Caller): void {
  server.tool(
    'tempo_poll_hosted',
    'Drain pending Mailbox events for this Hosted Session. Empty array means no work; runner should sleep before re-polling.',
    {},
    async () => {
      if (caller.kind !== 'hosted') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'hosted_only' }) }],
        };
      }
      const events = await getEventsSinceLastTurn(caller.threadId);
      return { content: [{ type: 'text', text: JSON.stringify({ events }) }] };
    },
  );
}
