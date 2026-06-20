import { GithubReposResponse } from '@tempo/contracts/http';
import { githubListRepos } from '@tempo/server';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { lookupWorkspaceByClerkOrg } from '../../server/auth-lookup';

// GET /api/connectors/github/repos — Console repo picker (browser only).
// Lists repos accessible to the workspace's GitHub App installation. The
// workspace is resolved from the caller's active Clerk org (the JWT's org_id
// claim). Returns an empty list on any failure — not connected, no active org,
// or a GitHub error — so the picker degrades to a "connect GitHub" prompt
// instead of breaking the composer. The Worker owns the GitHub App private key;
// the Console no longer mints install tokens.
export const githubReposHandler: RequestHandler = async (req, res) => {
  const caller = req.caller;
  if (caller.kind !== 'browser') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    const workspaceId = caller.orgId ? await lookupWorkspaceByClerkOrg(caller.orgId) : null;
    if (!workspaceId) {
      // orgId null → no active org on the token; orgId set but no row → the org
      // has no provisioned workspace. Either way the picker shows "connect".
      logger.info({ orgId: caller.orgId }, 'github-repos: no workspace for caller org');
      res.json({ repos: [] });
      return;
    }
    // parse() asserts the wire contract and strips MappedRepo's extra html_url.
    const repos = await githubListRepos(workspaceId);
    res.json(GithubReposResponse.parse({ repos }));
  } catch (err) {
    // Never log the install token; workspace org + message is enough to tell
    // "GitHub down" from "not connected".
    logger.warn({ orgId: caller.orgId, err: (err as Error).message }, 'github-repos: list failed');
    res.json({ repos: [] });
  }
};
