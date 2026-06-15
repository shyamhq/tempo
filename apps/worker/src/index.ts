import express from 'express';
import { bearerAuth } from './auth';
import { env } from './env';
import { logger } from './logger';
import { handleMcpRequest } from './mcp/transport';
import { agentEventsHandler } from './routes/agent-events/index';
import { cliExchangeHandler } from './routes/cli/exchange';
import { cliRefreshHandler } from './routes/cli/refresh';
import { healthHandler } from './routes/health';
import { threadAccessHandler } from './routes/threads/access';

const app = express();
app.use(express.json());

// Health check — unauthenticated, used by Fly's HTTP health probe.
app.get('/health', healthHandler);

// CLI auth — intentionally outside bearerAuth; the caller is exchanging an
// OAuth code / refresh token, not presenting a Bearer.
app.post('/api/cli/exchange', express.json(), cliExchangeHandler);
app.post('/api/cli/refresh', express.json(), cliRefreshHandler);

// Thread access check — CLI + browser, requires sk_user_* or Clerk JWT.
app.get('/api/threads/:id/access', bearerAuth, threadAccessHandler);

// Agent event ingestion — sk_user_* only.
app.post('/api/agent-events', bearerAuth, express.json({ limit: '1mb' }), agentEventsHandler);

// MCP endpoint — all methods, Bearer-authenticated.
// Express 5 supports async route handlers natively.
app.all('/mcp', bearerAuth, async (req, res) => {
  const { authSource, userId, workspaceId } = res.locals;
  if (authSource === 'agent') {
    if (!workspaceId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    await handleMcpRequest({ source: 'agent', workspaceId }, req, res);
    return;
  }
  if (authSource === 'cli') {
    if (!userId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    await handleMcpRequest({ source: 'cli', userId }, req, res);
    return;
  }
  // browser
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  await handleMcpRequest({ source: 'browser', userId, workspaceId }, req, res);
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
