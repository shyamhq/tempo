import { EventsQuery } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { longPoll, sseStream } from '../../../../../server/events-stream';
import { err, ok } from '../../../../../server/http';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const parsed = EventsQuery.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    wait: url.searchParams.get('wait') ?? undefined,
  });
  if (!parsed.success) return err('invalid_input', 400);
  const { cursor, wait } = parsed.data;
  if (wait === undefined) {
    return sseStream(id, cursor);
  }
  const result = await longPoll(id, cursor, wait);
  return ok(result);
}
