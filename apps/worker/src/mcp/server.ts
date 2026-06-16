import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AttachInput } from '@tempo/contracts/mcp';
import type { Caller } from '../auth';
import { resolveThreadIdForCaller } from '../server/auth-lookup';
import { registerAddBlocks } from './tools/add-blocks';
import { runAttach } from './tools/attach';
import { registerDeleteBlock } from './tools/delete-block';
import { registerLoadSkill } from './tools/load-skill';
import { registerPoll } from './tools/poll';
import { registerPostDiscussionMessage } from './tools/post-discussion-message';
import { registerPostReply } from './tools/post-reply';
import { registerPullPlan } from './tools/pull-plan';
import { registerSetThreadMeta } from './tools/set-thread-meta';
import { registerUpdateBlock } from './tools/update-block';
import { registerUpdatePlan } from './tools/update-plan';

// Creates a new McpServer instance for one authenticated session.
// caller and getMcpSessionId are captured by closure from the transport layer —
// no global request context or extra._meta tricks needed.
//
// getMcpSessionId is a getter because the SDK assigns the session UUID during
// the initialize handshake (inside the first transport.handleRequest call),
// which happens after createMcpServer returns. By the time any tool is invoked
// the getter always returns a non-null value.
export function createMcpServer(
  caller: Caller,
  getMcpSessionId: () => string | undefined = () => undefined,
): McpServer {
  const server = new McpServer({ name: 'tempo', version: '0.2.0' });

  // tempo_attach — fetches full Thread state and establishes a sticky session.
  server.tool(
    'tempo_attach',
    'Attach to a planning Thread. Fetches thread metadata, plan status, open comments, discussion messages, the latest event cursor, and the workflow guide. Call once at the start of each session.',
    AttachInput.shape,
    async (args) => {
      const result = await runAttach(args.thread_id, caller);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  const resolveThreadId = () => resolveThreadIdForCaller(caller, getMcpSessionId);

  registerPullPlan(server, resolveThreadId);
  registerUpdatePlan(server, resolveThreadId);
  registerUpdateBlock(server, resolveThreadId);
  registerAddBlocks(server, resolveThreadId);
  registerDeleteBlock(server, resolveThreadId);
  registerPoll(server, resolveThreadId);
  registerPostReply(server, resolveThreadId);
  registerPostDiscussionMessage(server, resolveThreadId);
  registerSetThreadMeta(server, resolveThreadId);
  registerLoadSkill(server, resolveThreadId);

  return server;
}
