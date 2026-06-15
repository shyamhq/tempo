import { db } from '@tempo/db/client';
import { workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { logger } from './logger';

// Extends Express's Request locals so downstream handlers get typed access.
declare global {
  namespace Express {
    interface Locals {
      workspaceId: string;
    }
  }
}

// Bearer middleware: expects `Authorization: Bearer sk_agent_<...>`.
// Looks up the workspace in the DB and attaches workspaceId to res.locals.
// Uniform `unauthorized` on every auth failure — no enumeration signal in
// the response body. Logs the specific reason at debug level for ops.
export const bearerAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    logger.debug('auth: missing or non-bearer authorization header');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token.startsWith('sk_agent_')) {
    logger.debug('auth: token does not match sk_agent_ prefix');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.agent_api_key, token))
      .limit(1);
    if (!row) {
      logger.debug('auth: api key not found');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.locals.workspaceId = row.id;
    next();
  } catch (err) {
    logger.error({ err }, 'auth: db lookup failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
