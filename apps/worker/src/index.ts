import { pool } from '@tempo/db/client';
import { TempoError } from '@tempo/errors';
import cors from 'cors';
import type { ErrorRequestHandler } from 'express';
import express from 'express';
import { bearerAuth, ensureCommentAccess, ensureThreadAccess, rejectWorkspaceAgent } from './auth';
import { env } from './env';
import { stopSupervisor } from './hosted/supervisor';
import { logger } from './logger';
import { handleMcpRequest } from './mcp/transport';
import { agentEventsHandler } from './routes/agent-events/index';
import { initAttachmentHandler } from './routes/browser/attachments';
import {
  createCommentHandler,
  deleteCommentHandler,
  resolveCommentHandler,
  unresolveCommentHandler,
} from './routes/browser/comments';
import { createDiscussionMessageHandler } from './routes/browser/discussion';
import { githubReposHandler } from './routes/browser/github-repos';
import { writePlanHandler } from './routes/browser/plan';
import { createReplyHandler } from './routes/browser/replies';
import { cliExchangeHandler } from './routes/cli/exchange';
import { cliRefreshHandler } from './routes/cli/refresh';
import { sseHandler } from './routes/events/sse';
import { healthHandler } from './routes/health';
import { wakeHostedHandler } from './routes/hosted/wake';
import { threadAccessHandler } from './routes/threads/access';

const app = express();

// CORS — allow the Console origin to call Worker endpoints with Authorization headers.
app.use(
  cors({
    origin: env.CONSOLE_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id'],
    credentials: false,
    maxAge: 86400,
  }),
);

app.use(express.json());

// Health check — unauthenticated, used by Fly's HTTP health probe.
app.get('/health', healthHandler);

// CLI auth — intentionally outside bearerAuth; the caller is exchanging an
// OAuth code / refresh token, not presenting a Bearer.
app.post('/api/cli/exchange', express.json(), cliExchangeHandler);
app.post('/api/cli/refresh', express.json(), cliRefreshHandler);

// Thread access check — CLI + browser preflight (resolves workspace + title).
// Special-cases its own membership check to return enriched 404/403 bodies.
app.get('/api/threads/:id/access', bearerAuth, threadAccessHandler);

// Agent event ingestion — sk_user_* only. Membership check happens inside the
// handler (the threadId arrives in the body, not the URL).
app.post('/api/agent-events', bearerAuth, express.json({ limit: '1mb' }), agentEventsHandler);

// Hosted Agent spawn — browser button OR internal Console server-to-server
// auto-wake. Handler enforces the per-kind allowlist; the `internal` caller can
// reach this route while still being blocked on SSE and other user-facing paths.
app.post('/api/threads/:id/hosted/wake', bearerAuth, ensureThreadAccess, wakeHostedHandler);

// SSE activity feed — browsers, the local CLI, and the hosted runner all tail
// it for new events. Workspace-scoped agent keys (no single thread) stay out.
app.get(
  '/api/threads/:id/events',
  bearerAuth,
  rejectWorkspaceAgent,
  ensureThreadAccess,
  sseHandler,
);

// Thread-scoped routes — bearerAuth → ensureThreadAccess sets req.workspaceId.
app.post('/api/threads/:id/plan', bearerAuth, ensureThreadAccess, writePlanHandler);
app.post('/api/threads/:id/comments', bearerAuth, ensureThreadAccess, createCommentHandler);
app.post(
  '/api/threads/:id/discussion/messages',
  bearerAuth,
  ensureThreadAccess,
  createDiscussionMessageHandler,
);
app.post(
  '/api/threads/:id/attachments/init',
  bearerAuth,
  ensureThreadAccess,
  initAttachmentHandler,
);

// Comment-scoped routes — bearerAuth → ensureCommentAccess resolves
// comment → thread, then authorizes against that thread.
app.delete('/api/comments/:id', bearerAuth, ensureCommentAccess, deleteCommentHandler);
app.post('/api/comments/:id/resolve', bearerAuth, ensureCommentAccess, resolveCommentHandler);
app.post('/api/comments/:id/unresolve', bearerAuth, ensureCommentAccess, unresolveCommentHandler);
app.post('/api/comments/:id/replies', bearerAuth, ensureCommentAccess, createReplyHandler);

// Workspace-scoped (no thread): the Console repo picker. Browser-only; the
// handler resolves the workspace from the caller's active Clerk org.
app.get('/api/connectors/github/repos', bearerAuth, githubReposHandler);

// MCP endpoint — bearerAuth identifies caller; tools call authorizeThread
// per-thread inside the tool implementation.
app.all('/mcp', bearerAuth, async (req, res) => {
  await handleMcpRequest(req.caller, req, res);
});

// Last-resort error handler. Per-handler catches still own their domain-
// specific 4xx mapping; anything that escapes lands here, gets logged with
// Pino, and surfaces as the TempoError's status (or a generic 500).
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof TempoError) {
    logger.error({ err, path: req.path, code: err.code }, 'unhandled request error');
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled request error');
  res.status(500).json({ error: 'internal_error' });
};
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'worker started');
});

// Graceful shutdown — drain HTTP first, then end the pg pool. Reverse order
// crashes in-flight queries (e.g. auth identify) with "Cannot use a pool after end".
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  await stopSupervisor().catch((err) =>
    logger.warn({ err }, 'supervisor: shutdown error (continuing)'),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch((err) => logger.warn({ err }, 'pg pool: shutdown error (continuing)'));
  logger.info('worker stopped');
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
