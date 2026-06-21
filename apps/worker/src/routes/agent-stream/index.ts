import type { UIMessageChunk } from '@tempo/contracts';
import { AgentStreamRequest } from '@tempo/contracts/http';
import { finalizeTurn, ingestChunks, touchVmRun } from '@tempo/server';
import type { RequestHandler } from 'express';
import { touch } from '../../hosted/supervisor';
import { logger } from '../../logger';

// POST /api/threads/:id/agent-stream — UIMessageChunk batches from the local CLI
// (sk_user_*) or hosted VM (sk_hosted_*). ensureThreadAccess has authorized :id.
// Malformed chunks can't crash us: assembly is error-trapped and persists only a
// non-empty message, so bad input is dropped, not stored.
export const agentStreamHandler: RequestHandler<{ id: string }> = async (req, res) => {
  if (req.caller.kind !== 'cli' && req.caller.kind !== 'hosted') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parsed = AgentStreamRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }

  const threadId = req.params.id;
  const { turn, chunks, done } = parsed.data;
  try {
    await ingestChunks(threadId, turn, chunks as UIMessageChunk[]);
    if (done) await finalizeTurn(threadId, turn);
    if (req.caller.kind === 'hosted') {
      touch(threadId);
      await touchVmRun(threadId);
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, 'agent-stream: ingest failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
