import { InitAttachmentInput } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { initUpload } from '../../server/attachments';

// POST /api/threads/:id/attachments/init — ensureThreadAccess authorizes.
export const initAttachmentHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const parsed = InitAttachmentInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await initUpload(req.params.id, parsed.data);
    res.json(result);
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
    logger.error({ err }, 'initAttachment failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
