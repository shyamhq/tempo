// GitHub Tier-1 connector client (own GitHub App, direct REST via octokit).
//
// All operations are workspace-scoped: we read the stored installation_id from
// the workspace connector config and mint a per-installation Octokit via
// app.getInstallationOctokit(). Octokit caches the installation access token
// internally and refreshes it before expiry, so we do not manage token
// lifecycle ourselves.
//
// The App singleton is lazy so the module can be imported without the env vars
// set (they are asserted at first call, not at import time). This keeps tests
// that mock the DB layer from needing GitHub credentials.

import { App } from 'octokit';
import {
  type MappedIssue,
  type MappedPullRequest,
  type MappedRepo,
  type MappedSearchResult,
  mapIssue,
  mapPullRequest,
  mapRepo,
  mapSearchResult,
} from './github-map';
import { getConnectorConfig } from './queries';

// --- App singleton ---------------------------------------------------------

let _app: App | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function getApp(): App {
  if (_app) return _app;
  const appId = requireEnv('GITHUB_APP_ID');
  // Private key may arrive with literal \n (escaped newline) from env or
  // secrets managers — normalize to real newlines so the PEM is valid.
  const privateKey = requireEnv('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  _app = new App({ appId, privateKey });
  return _app;
}

// --- Installation resolution -----------------------------------------------

async function resolveInstallationId(workspaceId: string): Promise<number> {
  const cfg = await getConnectorConfig(workspaceId, 'github');
  const installationId = cfg?.installation_id;
  if (
    typeof installationId !== 'number' ||
    !Number.isInteger(installationId) ||
    installationId <= 0
  ) {
    throw new Error('github is not connected for this workspace');
  }
  return installationId;
}

async function getInstallationOctokit(workspaceId: string) {
  return getApp().getInstallationOctokit(await resolveInstallationId(workspaceId));
}

// The raw installation access token — for callers that need the bearer string
// itself (the provisioner passes it into the sandbox to clone repos), not an
// Octokit. `app.octokit.auth({ type: 'installation' })` runs the App's auth-app
// strategy and returns the freshly-minted (or cached) installation token; the
// token is ~1h TTL, so callers must mint immediately before use.
export async function getInstallationToken(
  workspaceId: string,
): Promise<{ token: string; expiresAt: string }> {
  const installationId = await resolveInstallationId(workspaceId);
  const auth = await getApp().octokit.auth({ type: 'installation', installationId });
  const { token, expiresAt } = auth as { token: string; expiresAt: string };
  return { token, expiresAt };
}

// --- Public API ------------------------------------------------------------

type IssueRef = { owner: string; repo: string; number: number };
type PrState = 'open' | 'closed' | 'all';

export async function githubSearchIssues(
  workspaceId: string,
  args: { query: string; repo?: string },
): Promise<MappedSearchResult> {
  const octokit = await getInstallationOctokit(workspaceId);
  // Scope to repo when provided — repo:owner/name narrows to one repository.
  const q = args.repo ? `${args.query} repo:${args.repo}` : args.query;
  const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 30 });
  return mapSearchResult(data);
}

export async function githubGetIssue(workspaceId: string, args: IssueRef): Promise<MappedIssue> {
  const octokit = await getInstallationOctokit(workspaceId);
  const { data } = await octokit.rest.issues.get({
    owner: args.owner,
    repo: args.repo,
    issue_number: args.number,
  });
  return mapIssue(data);
}

export async function githubGetPullRequest(
  workspaceId: string,
  args: IssueRef,
): Promise<MappedPullRequest> {
  const octokit = await getInstallationOctokit(workspaceId);
  const { data } = await octokit.rest.pulls.get({
    owner: args.owner,
    repo: args.repo,
    pull_number: args.number,
  });
  return mapPullRequest(data);
}

export async function githubListPullRequests(
  workspaceId: string,
  args: { owner: string; repo: string; state: PrState },
): Promise<MappedPullRequest[]> {
  const octokit = await getInstallationOctokit(workspaceId);
  const { data } = await octokit.rest.pulls.list({
    owner: args.owner,
    repo: args.repo,
    state: args.state,
    per_page: 50,
  });
  return data.map(mapPullRequest);
}

export async function githubListRepos(workspaceId: string): Promise<MappedRepo[]> {
  const octokit = await getInstallationOctokit(workspaceId);
  const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
  return data.repositories.map(mapRepo);
}

// Builds the GitHub App install URL. The `state` parameter round-trips the
// workspace id so the install callback can bind the returned installation_id.
// Use /select_target, not /new: GitHub drops the `state` query param on the
// post-install redirect from /new, but preserves it from /select_target.
export function githubAppInstallUrl(state: string): string {
  const slug = requireEnv('GITHUB_APP_SLUG');
  return `https://github.com/apps/${slug}/installations/select_target?state=${encodeURIComponent(state)}`;
}
