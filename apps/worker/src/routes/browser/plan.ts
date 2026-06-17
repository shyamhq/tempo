import { RecheckPlanResponse, WritePlanRequest, WritePlanResponse } from '@tempo/contracts/http';
import { NotFoundError, ValidationError } from '@tempo/errors';
import { requestPlanRecheck, writePlan } from '@tempo/server';
import type { RequestHandler } from 'express';
import { send } from '../../lib/typed-response';
import { logger } from '../../logger';

// POST /api/threads/:id/plan — browser Dev write (full pm_json from editor save).
// Authorization handled by ensureThreadAccess middleware.
export const writePlanHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const parsed = WritePlanRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await writePlan(req.params.id, parsed.data.pm_json, 'dev');
    send(res, WritePlanResponse)({ ok: true, updated_at: result.updated_at });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: 'invalid_input', message: err.message });
      return;
    }
    logger.error({ err }, 'writePlan failed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// POST /api/threads/:id/plan/recheck — browser Dev triggers agent re-read.
export const recheckPlanHandler: RequestHandler<{ id: string }> = async (req, res) => {
  try {
    const result = await requestPlanRecheck(req.params.id);
    send(res, RecheckPlanResponse)({ ok: true, updated_at: result.updated_at });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'thread_not_found' });
      return;
    }
    logger.error({ err }, 'recheckPlan failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
