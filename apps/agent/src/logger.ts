import pino from 'pino';
import { env } from './env';

// Always log to stderr. The new CLI's stdout is reserved for any future piped
// usage (today it just shows user-facing status lines via process.stdout) and
// stderr is the conventional channel for tool diagnostics — matches gh, aws,
// terraform, etc. The pino-pretty transport's `destination` accepts an FD
// number; 2 = stderr.
// verbose mode forces debug level so the per-tempo-call / per-event traces in
// stream-pump and connect become visible.
const level = env.TEMPO_LOG_MODE === 'verbose' ? 'debug' : env.LOG_LEVEL;

export const logger = pino({
  level,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, destination: 2 },
  },
});

export const verbose = env.TEMPO_LOG_MODE === 'verbose';
