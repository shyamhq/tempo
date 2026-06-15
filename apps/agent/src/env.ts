import { z } from 'zod';

const Env = z.object({
  TEMPO_CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  // Worker URL — CLI exchanges codes, refreshes tokens, checks thread access,
  // and posts agent events here. Defaults to Worker's local-dev port (3001,
  // matching apps/worker/src/env.ts PORT default). In prod, set to
  // https://worker.tempo.dev.
  TEMPO_WORKER_URL: z.string().url().default('http://localhost:3001'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Passed as `--model` to `claude`. Accepts an alias (`haiku`, `sonnet`,
  // `opus`) or a full model ID.
  TEMPO_AGENT_MODEL: z.string().default('sonnet'),
  // TODO(slice-1c-2b): moves to Worker with r2-fetcher. Origin allowlist for
  // the attachment fetcher — guards against SSRF if the response is tampered.
  // Defaults to the local MinIO endpoint; in prod, set to the R2 endpoint.
  TEMPO_ATTACHMENT_ORIGIN: z.string().url().default('http://127.0.0.1:9000'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Agent env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
