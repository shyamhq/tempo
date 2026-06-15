import express from 'express';
import { bearerAuth } from './auth';
import { env } from './env';
import { logger } from './logger';
import { handleMcpRequest } from './mcp/transport';
import { healthHandler } from './routes/health';

const app = express();
app.use(express.json());

// Health check — unauthenticated, used by Fly's HTTP health probe.
app.get('/health', healthHandler);

// MCP endpoint — all methods, Bearer-authenticated.
// Express 5 supports async route handlers natively.
app.all('/mcp', bearerAuth, async (req, res) => {
  await handleMcpRequest(res.locals.workspaceId, req, res);
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
