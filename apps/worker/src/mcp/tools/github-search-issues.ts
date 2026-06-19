import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GithubSearchIssuesInput } from '@tempo/contracts/mcp';
import { githubSearchIssues } from '@tempo/server';
import type { Caller } from '../../auth';
import { resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerGithubSearchIssues(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_github_search_issues',
    'Search GitHub issues and pull requests using a query string. Optionally scope to a single repo (owner/name). Returns up to 30 summarised results.',
    GithubSearchIssuesInput.shape,
    async (args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: 'github', toolName: 'tempo_github_search_issues', request: args },
        ({ workspaceId }) => githubSearchIssues(workspaceId, args),
      );
    },
  );
}
