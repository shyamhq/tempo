import { githubListRepos } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { GithubReposResponse } from '@/lib/api-client';
import { logger } from '../../../../../logger';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';

// GET /api/connectors/github/repos — any authenticated workspace member.
// Returns all repos accessible to the workspace's GitHub App installation.
// Returns an empty list if GitHub is not connected rather than 401-ing — the
// picker handles the empty state gracefully with a "connect GitHub" prompt.
export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('forbidden', 403);

  try {
    const repos = await githubListRepos(auth.workspace_id);
    return ok(
      GithubReposResponse.parse({
        repos: repos.map((r) => ({
          full_name: r.full_name,
          private: r.private,
          description: r.description,
          default_branch: r.default_branch,
        })),
      }),
    );
  } catch (e) {
    // GitHub not connected or API error — return empty list so the picker
    // degrades gracefully instead of breaking the composer. Log (workspace id +
    // message, never the install token) so "GitHub is down" is distinguishable
    // from "not connected" in the Console logs.
    logger.warn(
      { workspace_id: auth.workspace_id, err: (e as Error).message },
      'github-repos: list failed',
    );
    return ok(GithubReposResponse.parse({ repos: [] }));
  }
}
