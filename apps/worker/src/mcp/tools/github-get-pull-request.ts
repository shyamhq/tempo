import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GithubGetPullRequestInput } from '@tempo/contracts/mcp';
import { githubGetPullRequest } from '@tempo/server';
import type { Caller } from '../../auth';
import { resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerGithubGetPullRequest(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_github_get_pull_request',
    'Fetch a single GitHub pull request by owner, repo, and PR number. Returns title, state, draft status, merge state, branch refs, labels, assignees, and a truncated body.',
    GithubGetPullRequestInput.shape,
    async (args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: 'github', toolName: 'tempo_github_get_pull_request', request: args },
        ({ workspaceId }) => githubGetPullRequest(workspaceId, args),
      );
    },
  );
}
