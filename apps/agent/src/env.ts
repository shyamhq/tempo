import { z } from 'zod';

const Env = z.object({
  TEMPO_CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  // Worker URL — CLI exchanges codes, refreshes tokens, checks thread access,
  // and posts agent events here. Defaults to Worker's local-dev port (3001,
  // matching apps/worker/src/env.ts PORT default). In prod, set to
  // https://worker.tempo.dev.
  TEMPO_WORKER_URL: z.string().url().default('http://localhost:3001'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // `verbose` bumps LOG_LEVEL to debug and surfaces every tempo MCP tool call
  // and every event POSTed to Worker. Useful when `connect` appears stuck.
  TEMPO_LOG_MODE: z.enum(['normal', 'verbose']).default('normal'),
  // Passed as `--model` to `claude`. Accepts an alias (`haiku`, `sonnet`,
  // `opus`) or a full model ID.
  TEMPO_AGENT_MODEL: z.string().default('sonnet'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Agent env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
