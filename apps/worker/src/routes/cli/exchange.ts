import { CliExchangeRequest } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { InvalidCodeError, issueUserToken, verifyCliCode } from '../../server/cli-auth';

// POST /api/cli/exchange — outside bearerAuth; caller presents an OAuth code.
// Verifies the code (signature + PKCE + nonce), then issues a sk_user_* token.
export const cliExchangeHandler: RequestHandler = async (req, res) => {
  const parsed = CliExchangeRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  const { code, code_verifier } = parsed.data;

  try {
    const { userId, email } = await verifyCliCode(code, code_verifier);
    const result = await issueUserToken(userId, email);
    res.json({
      token: result.token,
      refresh_token: result.refresh_token,
      expires_at: result.expires_at.toISOString(),
      user_id: result.user_id,
      email: result.email,
    });
  } catch (err) {
    if (err instanceof InvalidCodeError) {
      logger.debug({ err: err.message }, 'cli/exchange: invalid code');
      res.status(400).json({ error: 'invalid_code' });
      return;
    }
    logger.error({ err }, 'cli/exchange: unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
};
