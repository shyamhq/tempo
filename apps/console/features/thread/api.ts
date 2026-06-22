// Thread feature client: typed reads over the Console-side hydration routes via
// lib/api-client. Components never call these directly — the hydrate() helper
// (hooks/useThreadSession) does, seeding the slices.

import type { CreateThreadRequest } from '@tempo/contracts/http';
import {
  CreateThreadResponse,
  GetConnectTokenResponse,
  GetThreadResponse,
  GithubReposResponse,
  ListThreadsResponse,
} from '@tempo/contracts/http';
import { z } from 'zod';
import { request, workerRequest } from '../../lib/api-client';

const ThreadReposResponse = z.object({ repos: z.array(z.string()) });

export function getThread(threadId: string) {
  return request(
    'GET',
    `/api/threads/${encodeURIComponent(threadId)}`,
    undefined,
    GetThreadResponse,
  );
}

// New-thread compose. z.input so the caller can omit `repos` (the contract
// defaults it to []).
export function createThread(input: z.input<typeof CreateThreadRequest>) {
  return request('POST', '/api/threads', input, CreateThreadResponse);
}

// The in-thread Connect affordance. Token is invariant per Thread, so callers
// fetch it once and cache.
export function getConnectToken(threadId: string) {
  return request(
    'GET',
    `/api/threads/${encodeURIComponent(threadId)}/connect-token`,
    undefined,
    GetConnectTokenResponse,
  );
}

// The home's richer thread list (presence + updated_at), distinct from the
// sidebar's lighter /api/spaces tree.
export function listThreads(spaceId?: string) {
  const query = spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : '';
  return request('GET', `/api/threads${query}`, undefined, ListThreadsResponse).then(
    (r) => r.threads,
  );
}

// GitHub repos the workspace's App installation can see — for the compose repo
// picker. Worker route (Bearer JWT, getToken passed per-call); returns [] when
// GitHub isn't connected, which the picker renders as a connect prompt.
export function listGithubRepos(getToken: () => Promise<string | null>) {
  return workerRequest(
    'GET',
    '/api/connectors/github/repos',
    undefined,
    GithubReposResponse,
    getToken,
  );
}

// Repos are NOT on GetThreadResponse (ThreadSummary omits them) — a separate
// read seeds the thread slice's `repos` on hydrate.
export function getRepos(threadId: string): Promise<string[]> {
  return request(
    'GET',
    `/api/threads/${encodeURIComponent(threadId)}/repos`,
    undefined,
    ThreadReposResponse,
  ).then((r) => r.repos);
}
