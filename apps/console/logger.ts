import pino from 'pino';
import { env } from './env';

export const logger =
  env.NODE_ENV === 'production'
    ? pino({ level: env.LOG_LEVEL })
    : pino({
        level: env.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      });
