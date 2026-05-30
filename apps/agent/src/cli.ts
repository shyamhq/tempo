#!/usr/bin/env node
// Force stderr-bound logs before any module that loads pino runs. The MCP
// stdio transport reserves stdout for protocol framing; defense-in-depth in
// case a Dev runs `tempo-agent mcp-stdio` directly without the env var the
// parent normally injects.
if (process.argv[2] === 'mcp-stdio') {
  process.env.TEMPO_LOG_TO_STDERR = '1';
}

import { ConnectToken, SessionId, ThreadId } from '@tempo/contracts';
import { z } from 'zod';
import { connect } from './connect';
import { env } from './env';
import { toDevMessage } from './errors';
import { runHookRelay } from './hook-relay';
import { ConsoleClient } from './http-client';
import { logger } from './logger';
import { runStdioMcpServer } from './mcp-server';
import { runPostToolBatchHook } from './post-tool-batch-hook';
import { runStopHook } from './stop-hook';

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === 'mcp-stdio') {
    await runMcpStdio();
    return;
  }

  if (command === 'hook-relay') {
    await runHookRelay();
    return;
  }

  if (command === 'stop-hook') {
    await runStopHook();
    return;
  }

  if (command === 'post-tool-batch-hook') {
    await runPostToolBatchHook();
    return;
  }

  if (command === 'connect') {
    const [token, ...extra] = rest;
    if (!token || extra.length > 0) {
      usage();
    }
    const parsed = ConnectToken.safeParse(token);
    if (!parsed.success) {
      process.stderr.write('failed: token must look like tmp_<32+ chars>\n');
      process.exit(2);
    }
    await connect(parsed.data);
    return;
  }

  usage();
}

function usage(): never {
  process.stderr.write('usage: tempo-agent connect <token>\n');
  process.exit(2);
}

async function runMcpStdio(): Promise<void> {
  const McpStdioEnv = z.object({
    TEMPO_CONNECT_TOKEN: ConnectToken,
    TEMPO_SESSION_ID: SessionId,
    TEMPO_THREAD_ID: ThreadId,
  });
  const parsed = McpStdioEnv.safeParse(process.env);
  if (!parsed.success) {
    process.stderr.write(`mcp-stdio: invalid env\n${z.prettifyError(parsed.error)}\n`);
    process.exit(2);
  }
  const client = new ConsoleClient(env.TEMPO_CONSOLE_URL, parsed.data.TEMPO_CONNECT_TOKEN);
  await runStdioMcpServer({
    client,
    sessionId: parsed.data.TEMPO_SESSION_ID,
    threadId: parsed.data.TEMPO_THREAD_ID,
  });
}

main().catch((err) => {
  logger.debug({ err }, 'fatal');
  process.stderr.write(`${toDevMessage(err)}\n`);
  process.exit(1);
});
