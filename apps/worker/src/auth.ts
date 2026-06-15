import { verifyToken as clerkVerifyToken } from '@clerk/backend';
import type { RequestHandler } from 'express';
import { env } from './env';
import { logger } from './logger';
import { lookupUserByToken, lookupWorkspaceByAgentKey } from './server/auth-lookup';

// `workspaceId` and `userId` are conditionally set depending on which Bearer
// branch the request took. Optionality here forces downstream handlers to
// branch on `authSource` before reading either field — TS catches the mistake
// of assuming both are always present.
declare global {
  namespace Express {
    interface Locals {
      workspaceId?: string;
      userId?: string;
      authSource: 'agent' | 'cli' | 'browser';
    }
  }
}

// Verify a Clerk-issued session JWT using the Clerk backend SDK.
// secretKey drives JWKS fetch + cache internally.
async function verifyClerkToken(token: string): Promise<{ sub: string; org_id?: string }> {
  const claims = await clerkVerifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
  return {
    sub: claims.sub,
    org_id: typeof claims.org_id === 'string' ? claims.org_id : undefined,
  };
}

// Bearer middleware: three branches — sk_agent_* (workspace API key),
// sk_user_* (CLI user token), or Clerk JWT (browser path foundation).
//
// Uniform `{ error: 'unauthorized' }` on every auth failure — no enumeration
// signal in the response body. Specific reason logged at debug for ops.
export const bearerAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    logger.debug('auth: missing or non-bearer authorization header');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();

  try {
    if (token.startsWith('sk_agent_')) {
      const ws = await lookupWorkspaceByAgentKey(token);
      if (!ws) {
        logger.debug('auth: agent api key not found');
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      res.locals.workspaceId = ws.id;
      res.locals.authSource = 'agent';
    } else if (token.startsWith('sk_user_')) {
      const userRow = await lookupUserByToken(token);
      if (!userRow) {
        logger.debug('auth: user token not found or expired');
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      res.locals.userId = userRow.user_id;
      res.locals.authSource = 'cli';
      // workspaceId is NOT set here — Thread-scoped routes call
      // assertMembership(userId, threadId) to resolve it on demand.
    } else {
      // Assume Clerk JWT — browser path foundation for future browser↔Worker calls.
      try {
        const claims = await verifyClerkToken(token);
        res.locals.userId = claims.sub;
        if (claims.org_id) res.locals.workspaceId = claims.org_id;
        res.locals.authSource = 'browser';
      } catch (e) {
        logger.debug({ err: e }, 'auth: clerk jwt verification failed');
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
    }
    next();
  } catch (err) {
    logger.error({ err }, 'auth: lookup failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
