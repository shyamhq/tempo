import {
  CreateDiscussionMessageRequest,
  CreateDiscussionMessageResponse,
} from '@tempo/contracts/http';
import { postMessage } from '@tempo/server';
import type { RequestHandler } from 'express';
import { send } from '../../lib/typed-response';
import { logger } from '../../logger';

// POST /api/threads/:id/discussion/messages — browser only (Clerk JWT).
// Authorization handled by ensureThreadAccess middleware.
export const createDiscussionMessageHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const parsed = CreateDiscussionMessageRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  try {
    const message = await postMessage(req.params.id, 'dev', {
      text: parsed.data.text,
      attachments: parsed.data.attachments,
    });
    send(res, CreateDiscussionMessageResponse)(message);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'thread_not_found') {
      res.status(404).json({ error: 'thread_not_found' });
      return;
    }
    if (msg === 'thread_approved') {
      res.status(409).json({ error: 'thread_approved' });
      return;
    }
    logger.error({ err }, 'createDiscussionMessage failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
