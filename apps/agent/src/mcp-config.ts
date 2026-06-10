import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionId, ThreadId } from '@tempo/contracts';
import { env } from './env';

// Path to the bundled cli.js (sibling of this file in both dev and dist).
// The MCP config re-invokes this CLI as a subcommand. Invariant: mcp-config
// must remain a sibling of cli in the source tree (regex rewrites only the
// file name).
export const CLI_PATH = fileURLToPath(import.meta.url).replace(/mcp-config\.(ts|js)$/, 'cli.$1');

export function writeMcpConfigFile(args: {
  sessionId: SessionId;
  threadId: ThreadId;
  agentApiKey: string;
}): { configPath: string; configDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tempo-mcp-'));
  const path = join(dir, `config-${args.sessionId}.json`);

  // mcp-stdio reads TEMPO_AGENT_API_KEY + TEMPO_SESSION_ID and constructs a
  // post-handshake ConsoleClient. The mode 0600 file is the secret's only
  // hop between processes — never logs, never network.
  const config = {
    mcpServers: {
      tempo: {
        type: 'stdio',
        command: process.execPath,
        args: [CLI_PATH, 'mcp-stdio'],
        env: {
          TEMPO_AGENT_API_KEY: args.agentApiKey,
          TEMPO_SESSION_ID: args.sessionId,
          TEMPO_THREAD_ID: args.threadId,
          TEMPO_CONSOLE_URL: env.TEMPO_CONSOLE_URL,
          TEMPO_LOG_TO_STDERR: '1',
        },
      },
    },
  };

  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  return { configPath: path, configDir: dir };
}
