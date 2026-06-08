import { z } from 'zod';

const Env = z.object({
  TEMPO_CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TEMPO_AGENT_DRIVER: z.enum(['pty', 'stream-json']).default('pty'),
  // Passed as `--model` to `claude -p` in the stream-json driver. Accepts an
  // alias (`haiku`, `sonnet`, `opus`) or a full model ID.
  TEMPO_AGENT_MODEL: z.string().default('sonnet'),
  // tempo_attach inlines image bytes for the last N Discussion messages so
  // Claude sees recent screenshots without spending its first turn fetching
  // them. Older messages return refs only; tempo_poll auto-fetches every
  // new live attachment regardless of N.
  ATTACH_INLINE_RECENT_MESSAGES: z.coerce.number().int().positive().default(5),
  // Origin allowlist for the agent's attachment fetcher — guards against
  // SSRF if the Console response is ever tampered. Defaults to the local
  // MinIO endpoint; in prod, set to the R2 endpoint.
  TEMPO_ATTACHMENT_ORIGIN: z.string().url().default('http://127.0.0.1:9000'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Agent env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
