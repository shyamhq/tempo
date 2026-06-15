import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  WORKER_LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // CLI auth — shared secret between Console (code mint) and Worker (verify).
  // Must be at least 32 bytes of entropy. Same value in both processes.
  CLI_AUTH_SECRET: z.string().min(32),
  // Token hash pepper — added to SHA-256 input so a stolen DB dump cannot be
  // brute-forced without this value. Rotate requires re-issuing all tokens.
  TOKEN_HASH_PEPPER: z.string().min(32),
  // Clerk secret key — used by @clerk/backend to verify JWTs and query memberships.
  CLERK_SECRET_KEY: z.string().startsWith('sk_'),
  // CORS origin for browser → Worker requests. Single origin; the `cors`
  // package does NOT split on commas. In dev: http://localhost:3000.
  // In prod: https://console.tempo.dev.
  CONSOLE_ORIGIN: z.string().url().default('http://localhost:3000'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Worker env validation failed — missing or invalid: ${missing}`);
}

export const env = parsed.data;
