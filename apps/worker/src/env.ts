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
  // Hosted Session JWT signing secret — same shape as CLI_AUTH_SECRET, but
  // distinct so rotating one doesn't blast-radius the other. Worker mints
  // sk_hosted_* JWTs at VM-provision time and verifies them on every
  // incoming MCP call from the Sandbox.
  HOSTED_AUTH_SECRET: z.string().min(32),
  // Console→Worker server-to-server token. The Console's event-log post-hook
  // POSTs to /hosted/wake with `Authorization: Bearer int_${WORKER_INTERNAL_TOKEN}`
  // to auto-spawn a Sandbox on wake-eligible Dev events. Distinct from the
  // other secrets so leaking the worker→sandbox path doesn't grant server-
  // side trust (or vice versa).
  WORKER_INTERNAL_TOKEN: z.string().min(32),
  // Token hash pepper — added to SHA-256 input so a stolen DB dump cannot be
  // brute-forced without this value. Rotate requires re-issuing all tokens.
  TOKEN_HASH_PEPPER: z.string().min(32),
  // Clerk secret key — used by @clerk/backend to verify JWTs and query memberships.
  CLERK_SECRET_KEY: z.string().startsWith('sk_'),
  // CORS origin for browser → Worker requests. Single origin; the `cors`
  // package does NOT split on commas. In dev: http://localhost:3000.
  // In prod: https://console.tempo.dev.
  CONSOLE_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Sandbox provider (E2B) — provisioning API key, Worker-only; never
  // reaches the Sandbox itself.
  E2B_API_KEY: z.string().min(1),
  // Anthropic API key — Worker holds it; provision.ts injects it into the
  // Sandbox per-Session so the Claude Agent SDK loop can make model calls.
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  // Public URL the Sandbox uses to reach Worker's MCP endpoint. Must be
  // reachable from inside the E2B sandbox network.
  WORKER_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  // Optional Helicone proxy key — when set, the Hosted runner routes all
  // Anthropic calls through anthropic.helicone.ai so every request shows
  // up in the Helicone dashboard with usage / cost / tool-call traces.
  HELICONE_API_KEY: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Worker env validation failed — missing or invalid: ${missing}`);
}

// Guard the localhost default for WORKER_PUBLIC_URL — an unset value in prod
// would have Sandboxes try to call their own loopback for MCP. Fail loudly.
if (
  parsed.data.NODE_ENV === 'production' &&
  parsed.data.WORKER_PUBLIC_URL.startsWith('http://localhost')
) {
  throw new Error(
    'WORKER_PUBLIC_URL must be a public URL in production (got the localhost default)',
  );
}

export const env = parsed.data;
