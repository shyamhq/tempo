import cors from 'cors';
import express from 'express';
import { bearerAuth, ensureCommentAccess, ensureThreadAccess, rejectAgent } from './auth';
import { env } from './env';
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
import { recheckPlanHandler, writePlanHandler } from './routes/browser/plan';
import { createReplyHandler } from './routes/browser/replies';
import { cliExchangeHandler } from './routes/cli/exchange';
import { cliRefreshHandler } from './routes/cli/refresh';
import { sseHandler } from './routes/events/sse';
import { healthHandler } from './routes/health';
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

// SSE is a browser activity feed — agent keys (workspace-scoped, no user)
// have no business subscribing.
app.get('/api/threads/:id/events', bearerAuth, rejectAgent, ensureThreadAccess, sseHandler);

// Thread-scoped routes — bearerAuth → ensureThreadAccess sets req.workspaceId.
app.post('/api/threads/:id/plan', bearerAuth, ensureThreadAccess, writePlanHandler);
app.post('/api/threads/:id/plan/recheck', bearerAuth, ensureThreadAccess, recheckPlanHandler);
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

// MCP endpoint — bearerAuth identifies caller; tools call authorizeThread
// per-thread inside the tool implementation.
app.all('/mcp', bearerAuth, async (req, res) => {
  await handleMcpRequest(req.caller, req, res);
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'worker started');
});

// Graceful shutdown — let in-flight MCP streams drain before the process exits.
const shutdown = (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  server.close(() => {
    logger.info('worker stopped');
    process.exit(0);
  });
  // Force-exit after 10 s if connections don't drain.
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
