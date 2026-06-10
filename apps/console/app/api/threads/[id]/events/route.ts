import { EventsQuery } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest, readSessionHeader } from '../../../../../server/actor';
import { longPoll, sseStream } from '../../../../../server/events-stream';
import { err, ok } from '../../../../../server/http';
import { sessionBelongsToWorkspace, touchSessionLastSeen } from '../../../../../server/sessions';
import { threadBelongsToWorkspace } from '../../../../../server/threads';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const parsed = EventsQuery.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    wait: url.searchParams.get('wait') ?? undefined,
  });
  if (!parsed.success) return err('invalid_input', 400);
  const { cursor, wait } = parsed.data;
  // The CLI's long-poll IS the heartbeat: every Agent-authenticated request
  // bumps last_seen_at. UI / unauthenticated polls still run the auth lookup
  // but skip the heartbeat write.
  const auth = await authFromRequest(req);
  if (auth?.actor === 'agent') {
    if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) {
      return err('forbidden', 403);
    }
    const sessionId = readSessionHeader(req);
    if (sessionId && (await sessionBelongsToWorkspace(sessionId, auth.workspace_id))) {
      await touchSessionLastSeen(sessionId);
    }
  }
  if (wait === undefined) {
    return sseStream(id, cursor);
  }
  const result = await longPoll(id, cursor, wait);
  return ok(result);
}
