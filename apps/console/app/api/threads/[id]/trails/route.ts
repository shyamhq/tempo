import { listTrailsForThread } from '@tempo/server';
import { ok } from '../../../../../server/http';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const trails = await listTrailsForThread(id);
  return ok({ trails });
}
