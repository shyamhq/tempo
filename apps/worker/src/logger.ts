import pino from 'pino';
import { env } from './env';

// stdout in dev (pretty-printed), JSON on stdout in prod.
// MCP stdio servers must use stderr; Worker is an HTTP server so stdout is safe.
export const logger = pino(
  { level: env.WORKER_LOG_LEVEL },
  env.NODE_ENV === 'development'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : pino.destination(1),
);
