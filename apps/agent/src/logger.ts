import pino from 'pino';
import { env } from './env';

// MCP stdio mode reserves stdout for protocol framing. The spawn sets
// TEMPO_LOG_TO_STDERR=1 in the child env; pino-pretty's `destination` accepts
// an FD (1=stdout, 2=stderr).
export const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      destination: process.env.TEMPO_LOG_TO_STDERR === '1' ? 2 : 1,
    },
  },
});
