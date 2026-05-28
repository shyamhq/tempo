import { appendEvent } from '../../../../../server/event-log';
import { ok } from '../../../../../server/http';
import { getThread, reopenThread } from '../../../../../server/threads';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const prior = await getThread(id);
  await reopenThread(id);
  if (prior && prior.status !== 'unapproved') {
    await appendEvent(id, { kind: 'status_changed', from: prior.status, to: 'unapproved' });
  }
  return ok({ ok: true });
}
