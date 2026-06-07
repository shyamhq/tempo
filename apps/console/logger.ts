import path from 'node:path';
import pino from 'pino';
import { env } from './env';

// Dev-only file sink for warn+ logs so a server 500 isn't lost to a scrolled
// terminal. Production keeps the original behavior (JSON to stdout, no file).
// File lives at `<cwd>/tempo-console.log` — Next dev runs cwd=apps/console.
const LOG_FILE = path.resolve(process.cwd(), 'tempo-console.log');

export const logger =
  env.NODE_ENV === 'production'
    ? pino({ level: env.LOG_LEVEL })
    : pino({
        level: env.LOG_LEVEL,
        transport: {
          targets: [
            {
              target: 'pino-pretty',
              level: env.LOG_LEVEL,
              options: { colorize: true },
            },
            {
              target: 'pino/file',
              level: 'warn',
              options: { destination: LOG_FILE, mkdir: true },
            },
          ],
        },
      });

if (env.NODE_ENV !== 'production') {
  logger.info({ logFile: LOG_FILE }, 'console warn+ logs tee to file');
}
