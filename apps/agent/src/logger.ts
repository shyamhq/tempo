import pino from 'pino';
import { env } from './env';

// Always log to stderr. The new CLI's stdout is reserved for any future piped
// usage (today it just shows user-facing status lines via process.stdout) and
// stderr is the conventional channel for tool diagnostics — matches gh, aws,
// terraform, etc. The pino-pretty transport's `destination` accepts an FD
// number; 2 = stderr.
export const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, destination: 2 },
  },
});
