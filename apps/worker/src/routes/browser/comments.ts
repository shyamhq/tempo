import {
  CreateCommentRequest,
  CreateCommentResponse,
  DeleteCommentResponse,
  ResolveCommentResponse,
  UnresolveCommentResponse,
} from '@tempo/contracts/http';
import { ConflictError, NotFoundError } from '@tempo/errors';
import { createComment, deleteComment, resolveComment, unresolveComment } from '@tempo/server';
import type { RequestHandler } from 'express';
import { send } from '../../lib/typed-response';
import { logger } from '../../logger';

// POST /api/threads/:id/comments — ensureThreadAccess middleware authorizes.
export const createCommentHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const parsed = CreateCommentRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  try {
    const comment = await createComment({
      threadId: req.params.id,
      ...parsed.data,
      anchor_block_id: parsed.data.anchor_block_id ?? null,
    });
    send(res, CreateCommentResponse)(comment);
  } catch (err) {
    logger.error({ err }, 'createComment failed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// DELETE /api/comments/:id — ensureCommentAccess middleware authorizes.
export const deleteCommentHandler: RequestHandler<{ id: string }> = async (req, res) => {
  try {
    await deleteComment(req.params.id);
    send(res, DeleteCommentResponse)({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'comment_not_found' });
      return;
    }
    if (err instanceof ConflictError) {
      res.status(409).json({ error: 'thread_approved' });
      return;
    }
    logger.error({ err }, 'deleteComment failed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// POST /api/comments/:id/resolve
export const resolveCommentHandler: RequestHandler<{ id: string }> = async (req, res) => {
  try {
    await resolveComment(req.params.id);
    send(res, ResolveCommentResponse)({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'comment_not_found' });
      return;
    }
    logger.error({ err }, 'resolveComment failed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// POST /api/comments/:id/unresolve
export const unresolveCommentHandler: RequestHandler<{ id: string }> = async (req, res) => {
  try {
    await unresolveComment(req.params.id);
    send(res, UnresolveCommentResponse)({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'comment_not_found' });
      return;
    }
    logger.error({ err }, 'unresolveComment failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
