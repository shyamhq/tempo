import { getThread } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';

const ThreadReposResponse = z.object({ repos: z.array(z.string()) });

// GET /api/threads/:id/repos — Dev-only (the Agent reads repos via /access
// hydration). Returns the thread's current `repos` array (["owner/name", ...]).
// Separate from GET /api/threads/:id because ThreadSummary (used in the
// GetThreadResponse contract) does not expose repos — this route is the
// dedicated read path for the composer's thread-context bar.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { id } = await ctx.params;
  const thread = await getThread(id);
  if (!thread || thread.workspace_id !== auth.workspace_id) return err('thread_not_found', 404);
  return ok(ThreadReposResponse.parse({ repos: thread.repos }));
}
