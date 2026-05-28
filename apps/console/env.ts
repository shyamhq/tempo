import { z } from 'zod';

const Env = z.object({
  // libsql accepts file:, libsql:, and http(s): schemes; reject anything else.
  DATABASE_URL: z
    .string()
    .regex(/^(file:|libsql:|https?:)/)
    .default('file:./data/tempo.db'),
  CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Console env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
