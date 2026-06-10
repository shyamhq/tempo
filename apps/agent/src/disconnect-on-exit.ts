import type { SessionId } from '@tempo/contracts';
import { env } from './env';
import { logger } from './logger';

// Tight ceiling — blocking on a hung Console at shutdown is worse than a
// dangling 'connected' row (the server's lazy reaper picks those up off the
// heartbeat path within STALE_MS).
export const DISCONNECT_TIMEOUT_MS = 500;

export async function bestEffortDisconnect(args: {
  sessionId: SessionId;
  agentApiKey: string;
}): Promise<void> {
  try {
    await fetch(`${env.TEMPO_CONSOLE_URL}/api/sessions/${args.sessionId}/disconnect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.agentApiKey}`,
        'X-Tempo-Session': args.sessionId,
      },
      signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
    });
  } catch (err) {
    logger.debug({ err }, 'disconnect-on-exit failed');
  }
}
