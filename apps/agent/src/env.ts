import { z } from 'zod';

const Env = z.object({
  TEMPO_CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Agent env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
