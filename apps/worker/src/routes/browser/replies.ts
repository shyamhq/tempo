import { CreateReplyRequest, CreateReplyResponse } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { send } from '../../lib/typed-response';
import { logger } from '../../logger';
import { postReply } from '../../server/replies';

// POST /api/comments/:id/replies — ensureCommentAccess middleware authorizes.
export const createReplyHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const parsed = CreateReplyRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  try {
    const reply = await postReply(
      req.params.id,
      parsed.data.payload,
      'dev',
      parsed.data.attachments,
    );
    send(res, CreateReplyResponse)(reply);
  } catch (err) {
    if ((err as Error).message === 'comment_not_found') {
      res.status(404).json({ error: 'comment_not_found' });
      return;
    }
    logger.error({ err }, 'createReply failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
