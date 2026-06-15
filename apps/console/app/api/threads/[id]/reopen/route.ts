import { appendEvent, getThread, reopenThread } from '@tempo/server';
import { ok } from '../../../../../server/http';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const prior = await getThread(id);
  await reopenThread(id);
  if (prior && prior.status !== 'unapproved') {
    await appendEvent(id, { kind: 'status_changed', from: prior.status, to: 'unapproved' });
  }
  return ok({ ok: true });
}
