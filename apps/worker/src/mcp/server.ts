import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Caller } from '../auth';
import { resolveThreadIdForCaller } from '../server/auth-lookup';
import { registerAddBlocks } from './tools/add-blocks';
import { registerDeleteBlock } from './tools/delete-block';
import { registerLoadSkill } from './tools/load-skill';
import { registerPoll } from './tools/poll';
import { registerPostDiscussionMessage } from './tools/post-discussion-message';
import { registerPostReply } from './tools/post-reply';
import { registerPullPlan } from './tools/pull-plan';
import { registerSetThreadMeta } from './tools/set-thread-meta';
import { registerUpdateBlock } from './tools/update-block';
import { registerUpdatePlan } from './tools/update-plan';

// Creates a new McpServer instance for one stateless MCP request. The Caller
// is captured from the bearer auth; headerThreadId comes from `X-Tempo-Thread-Id`
// on the same request. Hosted callers ignore the header and read threadId from
// their JWT; CLI / browser callers rely on the header. No session map, no
// tempo_attach handshake.
export function createMcpServer(caller: Caller, headerThreadId: string | undefined): McpServer {
  const server = new McpServer({ name: 'tempo', version: '0.2.0' });

  const resolveThreadId = async () => resolveThreadIdForCaller(caller, headerThreadId);

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
