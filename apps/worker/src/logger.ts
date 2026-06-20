// Named imports (not the default) so the helpers resolve via pino's export map
// — bun's test loader leaves `pino.destination`/`pino.transport` undefined on
// the default CJS export, which crashes any test that imports this module.
import { destination, pino, transport } from 'pino';
import { env } from './env';

// stdout in dev (pretty-printed, single-line), JSON on stdout in prod.
// MCP stdio servers must use stderr; Worker is an HTTP server so stdout is safe.
export const logger = pino(
  { level: env.WORKER_LOG_LEVEL },
  env.NODE_ENV === 'development'
    ? transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'hostname',
        },
      })
    : destination(1),
);
