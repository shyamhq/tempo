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
  // Optional: explicit ACP adapter command. Defaults to the bundled
  // @zed-industries/claude-code-acp under the running node binary.
  TEMPO_AGENT_ADAPTER_CMD: z.string().optional(),
  // Optional space-separated args appended to the adapter spawn.
  TEMPO_AGENT_ADAPTER_ARGS: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Agent env:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
