import { verifyToken as clerkVerifyToken } from '@clerk/backend';
import { db } from '@tempo/db/client';
import { comments, threads } from '@tempo/db/schema';
import { ForbiddenError } from '@tempo/errors';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import * as jose from 'jose';
import { env } from './env';
import { logger } from './logger';
import {
  assertMembership,
  lookupUserByToken,
  lookupWorkspaceByAgentKey,
  NotAMemberError,
  ThreadNotFoundError,
} from './server/auth-lookup';

export { ForbiddenError };

// The Bearer flavors Worker accepts, after middleware identification.
// Routes never branch on `kind` — they call authorizeThread / authorizeComment
// which folds the dispatch into one place.
// `internal` is the Console-server caller — used by the event-log post-hook
// to auto-spawn a Sandbox on Dev wake events. Trusted to any Thread (no
// workspace check) because it's gated by the shared WORKER_INTERNAL_TOKEN.
export type Caller =
  | { kind: 'agent'; workspaceId: string }
  | { kind: 'cli'; userId: string }
  | { kind: 'browser'; userId: string }
  | { kind: 'hosted'; threadId: string; workspaceId: string; sessionId: string }
  | { kind: 'internal' };

declare global {
  namespace Express {
    interface Request {
      caller: Caller;
      workspaceId: string;
    }
  }
}

// Parse Bearer → identify caller. Throws ForbiddenError on a bad/unknown
// token. The middleware below catches and translates to 401.
async function identify(header: string | undefined): Promise<Caller> {
  if (!header?.startsWith('Bearer ')) throw new ForbiddenError('no_bearer');
  const token = header.slice('Bearer '.length).trim();

  if (token.startsWith('sk_agent_')) {
    const ws = await lookupWorkspaceByAgentKey(token);
    if (!ws) throw new ForbiddenError('bad_agent_key');
    return { kind: 'agent', workspaceId: ws.id };
  }

  if (token.startsWith('sk_user_')) {
    const row = await lookupUserByToken(token);
    if (!row) throw new ForbiddenError('bad_user_token');
    return { kind: 'cli', userId: row.user_id };
  }

  if (token.startsWith('int_')) {
    if (token === `int_${env.WORKER_INTERNAL_TOKEN}`) return { kind: 'internal' };
    throw new ForbiddenError('bad_internal_token');
  }

  if (token.startsWith('sk_hosted_')) {
    const jwt = token.slice('sk_hosted_'.length);
    try {
      const { payload } = await jose.jwtVerify(
        jwt,
        new TextEncoder().encode(env.HOSTED_AUTH_SECRET),
      );
      if (
        payload.kind !== 'hosted' ||
        typeof payload.thread_id !== 'string' ||
        typeof payload.workspace_id !== 'string' ||
        typeof payload.session_id !== 'string'
      ) {
        throw new ForbiddenError('bad_hosted_token');
      }
      return {
        kind: 'hosted',
        threadId: payload.thread_id,
        workspaceId: payload.workspace_id,
        sessionId: payload.session_id,
      };
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      logger.debug({ err }, 'auth: hosted jwt verification failed');
      throw new ForbiddenError('bad_hosted_token');
    }
  }

  try {
    const claims = await clerkVerifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    return { kind: 'browser', userId: claims.sub };
  } catch (err) {
    logger.debug({ err }, 'auth: clerk jwt verification failed');
    throw new ForbiddenError('bad_clerk_jwt');
  }
}

// The only place the kind switch lives. Returns the Tempo workspaceId iff
// the caller may act on the thread; throws ForbiddenError otherwise.
//
// - agent: thread.workspace_id must equal caller.workspaceId (the agent key
//   is workspace-scoped; cross-workspace use is rejected).
// - cli/browser: delegates to assertMembership (DB + Clerk SDK).
// - internal: trusted server-to-server, scope is the Thread's workspace.
export async function authorizeThread(caller: Caller, threadId: string): Promise<string> {
  if (caller.kind === 'agent' || caller.kind === 'internal') {
    const [thread] = await db
      .select({ workspace_id: threads.workspace_id })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!thread) throw new ForbiddenError('thread_not_found');
    if (caller.kind === 'agent' && thread.workspace_id !== caller.workspaceId) {
      throw new ForbiddenError('cross_workspace');
    }
    return thread.workspace_id;
  }
  if (caller.kind === 'hosted') {
    // Hosted is pre-authorized to its own Thread only — the JWT itself is
    // the proof. Any cross-Thread access attempt is an immediate 403.
    if (caller.threadId !== threadId) throw new ForbiddenError('cross_thread');
    return caller.workspaceId;
  }
  try {
    const { workspaceId } = await assertMembership(caller.userId, threadId);
    return workspaceId;
  } catch (err) {
    if (err instanceof ThreadNotFoundError) throw new ForbiddenError('thread_not_found');
    if (err instanceof NotAMemberError) throw new ForbiddenError('not_member');
    throw err;
  }
}

// Comment-scoped variant — resolves comment → thread, then delegates.
// 404 (not 403) if the comment doesn't exist; otherwise authorization
// outcome surfaces as a thrown ForbiddenError handled by middleware.
async function resolveCommentThread(commentId: string): Promise<string | null> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return row?.thread_id ?? null;
}

// Identifies the caller on every authenticated request. Uniform 401 on any
// identification failure — specific reason logged at debug.
export const bearerAuth: RequestHandler = async (req, res, next) => {
  try {
    req.caller = await identify(req.headers.authorization);
    next();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      logger.debug({ reason: err.message }, 'auth: identify rejected');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    logger.error({ err }, 'auth: identify crashed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// Thread-scoped routes: requires :id to be a threadId. Sets req.workspaceId
// on success; 403 on authorization failure. Must be chained after bearerAuth.
export const ensureThreadAccess: RequestHandler<{ id: string }> = async (req, res, next) => {
  try {
    req.workspaceId = await authorizeThread(req.caller, req.params.id);
    next();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      logger.debug({ reason: err.message, threadId: req.params.id }, 'auth: thread forbidden');
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    logger.error({ err }, 'auth: ensureThreadAccess crashed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// Comment-scoped routes: requires :id to be a commentId. Resolves comment →
// thread first (404 if comment absent), then authorizes against that thread.
export const ensureCommentAccess: RequestHandler<{ id: string }> = async (req, res, next) => {
  try {
    const threadId = await resolveCommentThread(req.params.id);
    if (!threadId) {
      res.status(404).json({ error: 'comment_not_found' });
      return;
    }
    req.workspaceId = await authorizeThread(req.caller, threadId);
    next();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      logger.debug({ reason: err.message, commentId: req.params.id }, 'auth: comment forbidden');
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    logger.error({ err }, 'auth: ensureCommentAccess crashed');
    res.status(500).json({ error: 'internal_error' });
  }
};

// SSE feed guard. Rejects only the workspace-scoped agent key and the internal
// token (neither carries a single-thread context). cli, browser, and the
// thread-bound hosted runner pass — the hosted runner subscribes to its OWN
// thread's SSE feed, and ensureThreadAccess pins it to that thread.
export const rejectWorkspaceAgent: RequestHandler = (req, res, next) => {
  if (req.caller.kind === 'agent' || req.caller.kind === 'internal') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};
