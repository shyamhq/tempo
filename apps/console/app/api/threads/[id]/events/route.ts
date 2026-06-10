import { EventsQuery } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { longPoll, sseStream } from '../../../../../server/events-stream';
import { err, ok } from '../../../../../server/http';
import { touchSessionLastSeen } from '../../../../../server/sessions';

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
  if (auth?.actor === 'agent' && auth.session_id) {
    await touchSessionLastSeen(auth.session_id);
  }
  if (wait === undefined) {
    return sseStream(id, cursor);
  }
  const result = await longPoll(id, cursor, wait);
  return ok(result);
}
