import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GithubListPullRequestsInput } from '@tempo/contracts/mcp';
import { githubListPullRequests } from '@tempo/server';
import type { Caller } from '../../auth';
import { resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerGithubListPullRequests(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_github_list_pull_requests',
    'List pull requests for a GitHub repository. Filter by state (open, closed, all). Returns up to 50 summarised PRs.',
    GithubListPullRequestsInput.shape,
    async (args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: 'github', toolName: 'tempo_github_list_pull_requests', request: args },
        ({ workspaceId }) => githubListPullRequests(workspaceId, args),
      );
    },
  );
}
