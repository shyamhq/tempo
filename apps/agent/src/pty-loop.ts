import type { ConnectToken, SessionId, ThreadId } from '@tempo/contracts';
import { env } from './env';
import { createEventStream } from './event-stream';
import { ConsoleClient } from './http-client';
import { buildNudge } from './nudge';
import { spawnTerminal } from './pty-terminal';

export async function runPtyLoop(args: {
  sessionId: SessionId;
  threadId: ThreadId;
  token: ConnectToken;
}): Promise<number> {
  const client = new ConsoleClient(env.TEMPO_CONSOLE_URL, args.token);
  const terminal = spawnTerminal(args);
  const stream = createEventStream({ client, threadId: args.threadId });

  stream.start(async (events) => {
    const nudge = buildNudge(events);
    if (nudge) await terminal.inject(nudge);
  });

  return new Promise<number>((resolve) => {
    terminal.onExit((exitCode) => {
      stream.stop();
      resolve(exitCode);
    });
  });
}
