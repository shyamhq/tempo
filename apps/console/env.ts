import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Fail loudly at boot if Clerk isn't configured. Required by proxy.ts + actor.ts.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
  CLERK_SECRET_KEY: z.string().startsWith('sk_'),
  // Optional until the Clerk Dashboard webhook is configured (Phase 4 / Phase 8).
  CLERK_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Console env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
