import type { ConnectToken, SessionId, ThreadId } from '@tempo/contracts';
import { CANCEL_NOTICE, findCancelForSession } from './cancel';
import { bestEffortDisconnect } from './disconnect-on-exit';
import { env } from './env';
import { createEventStream } from './event-stream';
import { ConsoleClient } from './http-client';
import { logger } from './logger';
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
    if (findCancelForSession(events, args.sessionId)) {
      // Await so the message lands before the child dies and the loop unwinds.
      await client
        .postDiscussionMessage(args.threadId, { text: CANCEL_NOTICE })
        .catch((err) => logger.warn({ err }, 'cancel notice post failed'));
      terminal.kill();
      return;
    }
    const nudge = buildNudge(events);
    if (nudge) await terminal.inject(nudge);
  });

  return new Promise<number>((resolve) => {
    terminal.onExit((exitCode) => {
      stream.stop();
      void bestEffortDisconnect({ sessionId: args.sessionId, token: args.token }).finally(() =>
        resolve(exitCode),
      );
    });
  });
}
