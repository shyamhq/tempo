import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GithubListReposInput } from '@tempo/contracts/mcp';
import { githubListRepos } from '@tempo/server';
import type { Caller } from '../../auth';
import { resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerGithubListRepos(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_github_list_repos',
    'List all GitHub repositories accessible to this workspace installation. Returns up to 100 repos with name, visibility, default branch, and description.',
    GithubListReposInput.shape,
    async (_args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: 'github', toolName: 'tempo_github_list_repos', request: _args },
        ({ workspaceId }) => githubListRepos(workspaceId),
      );
    },
  );
}
