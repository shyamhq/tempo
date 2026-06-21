// Thread feature client: typed reads over the Console-side hydration routes via
// lib/api-client. Components never call these directly — the hydrate() helper
// (hooks/useThreadSession) does, seeding the slices.

import { GetThreadResponse } from '@tempo/contracts/http';
import { z } from 'zod';
import { request } from '../../lib/api-client';

const ThreadReposResponse = z.object({ repos: z.array(z.string()) });

export function getThread(threadId: string) {
  return request(
    'GET',
    `/api/threads/${encodeURIComponent(threadId)}`,
    undefined,
    GetThreadResponse,
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
