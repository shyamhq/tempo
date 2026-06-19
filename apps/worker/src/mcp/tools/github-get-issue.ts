import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GithubGetIssueInput } from '@tempo/contracts/mcp';
import { githubGetIssue } from '@tempo/server';
import type { Caller } from '../../auth';
import { resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerGithubGetIssue(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_github_get_issue',
    'Fetch a single GitHub issue by owner, repo, and issue number. Returns title, state, labels, assignees, and a truncated body.',
    GithubGetIssueInput.shape,
    async (args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: 'github', toolName: 'tempo_github_get_issue', request: args },
        ({ workspaceId }) => githubGetIssue(workspaceId, args),
      );
    },
  );
}
