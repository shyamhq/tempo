import { err, ok } from '../../../../server/http';
import { getRoundAnswers } from '../../../../server/rounds';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = await getRoundAnswers(id);
  if (!view) return err('round_not_found', 404);
  return ok(view);
}
