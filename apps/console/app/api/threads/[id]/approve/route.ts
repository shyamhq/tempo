import { appendEvent } from '../../../../../server/event-log';
import { ok } from '../../../../../server/http';
import { approveThread, getThread } from '../../../../../server/threads';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const prior = await getThread(id);
  await approveThread(id);
  if (prior && prior.status !== 'approved') {
    await appendEvent(id, { kind: 'status_changed', from: prior.status, to: 'approved' });
  }
  return ok({ ok: true });
}
