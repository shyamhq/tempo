import { CliRefreshRequest } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { InvalidRefreshError, refreshUserToken } from '../../server/cli-auth';

// POST /api/cli/refresh — outside bearerAuth; caller presents a refresh token.
// Issues a new pair (rotate-on-use); old pair is revoked atomically.
export const cliRefreshHandler: RequestHandler = async (req, res) => {
  const parsed = CliRefreshRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await refreshUserToken(parsed.data.refresh_token);
    res.json({
      token: result.token,
      refresh_token: result.refresh_token,
      expires_at: result.expires_at.toISOString(),
      user_id: result.user_id,
      email: result.email,
    });
  } catch (err) {
    if (err instanceof InvalidRefreshError) {
      logger.debug({ err: err.message }, 'cli/refresh: invalid refresh token');
      res.status(400).json({ error: 'invalid_refresh_token' });
      return;
    }
    logger.error({ err }, 'cli/refresh: unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
};
