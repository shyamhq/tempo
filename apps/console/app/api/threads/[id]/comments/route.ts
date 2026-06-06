import { CreateCommentRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { createComment } from '../../../../../server/comments';
import { err, ok, parseBody } from '../../../../../server/http';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, CreateCommentRequest);
  if (!parsed.ok) return parsed.response;
  try {
    const comment = await createComment(
      id,
      parsed.data.plan_quote,
      parsed.data.plan_context,
      parsed.data.first_reply_text,
      parsed.data.attachments,
    );
    return ok(comment, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('attachment_')) return err(msg, 400);
    throw e;
  }
}
