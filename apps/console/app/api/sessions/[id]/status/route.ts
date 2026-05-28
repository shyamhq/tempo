import { SetActivityStatusRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { err, ok, parseBody } from '../../../../../server/http';
import { setActivityStatus } from '../../../../../server/status';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, SetActivityStatusRequest);
  if (!parsed.ok) return parsed.response;
  try {
    await setActivityStatus(id, parsed.data.label, parsed.data.detail);
  } catch (e) {
    if ((e as Error).message === 'session_not_found') return err('session_not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
