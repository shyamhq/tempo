// One shared path for both producers (hosted runtime, local CLI): identical
// `UIMessageChunk`s stream live as `agent_chunk` frames and assemble — via the
// SDK's `readUIMessageStream`, never a hand-rolled accumulator — into one
// persisted `UIMessage` per turn. Postgres is written exactly once, at finalize.

import { stripEmptyAgentText } from '@tempo/contracts';
import type { TempoUIMessage, UIMessageChunk } from '@tempo/contracts/agent-message';
import { agentMessages, db } from '@tempo/db';
import { readUIMessageStream } from 'ai';
import { asc, eq } from 'drizzle-orm';
import { bufferChunks, drainChunkBuffer, publishAgentChunks } from './redis';

export async function ingestChunks(
  threadId: string,
  turn: string,
  chunks: UIMessageChunk[],
): Promise<void> {
  await publishAgentChunks(threadId, turn, chunks);
  await bufferChunks(turn, chunks);
}

// Safe on abort (persists whatever streamed); no-op for an already-drained turn.
// `turn` is the row id, so the persisted message shares its live frames' identity.
export async function finalizeTurn(threadId: string, turn: string): Promise<void> {
  const chunks = await drainChunkBuffer(turn);
  const message = await assembleMessage(chunks);
  // Skip empty turns. streamText emits a `step-start` part on every turn, so a
  // length check alone would persist a content-less "No output" card.
  if (!message || !hasRenderableContent(message)) return;
  // Idempotent: a retried/raced `done` for the same turn is a no-op, not a 500.
  await db
    .insert(agentMessages)
    .values({ id: turn, thread_id: threadId, parts_json: message.parts })
    .onConflictDoNothing();
}

// True when a turn has something worth showing — any tool/source part, or
// non-blank text/reasoning. step-start (always present) and blank text don't count.
export function hasRenderableContent(message: TempoUIMessage): boolean {
  return message.parts.some((p) => {
    if (p.type === 'step-start') return false;
    if (p.type === 'text' || p.type === 'reasoning') return p.text.trim().length > 0;
    return true;
  });
}

// Pure — isolated for unit testing.
export async function assembleMessage(chunks: UIMessageChunk[]): Promise<TempoUIMessage | null> {
  if (chunks.length === 0) return null;
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let message: TempoUIMessage | null = null;
  try {
    for await (const next of readUIMessageStream({ stream })) message = next;
  } catch (err) {
    console.error('assembleMessage: chunk stream malformed', { err });
    return null;
  }
  // Drop provider empty-turn placeholders so they're never persisted as prose.
  return message && stripEmptyAgentText(message);
}

export async function listAgentMessages(threadId: string): Promise<TempoUIMessage[]> {
  const rows = await db
    .select({ id: agentMessages.id, parts_json: agentMessages.parts_json })
    .from(agentMessages)
    .where(eq(agentMessages.thread_id, threadId))
    .orderBy(asc(agentMessages.created_at));
  return rows.map((row) => ({
    id: row.id,
    role: 'assistant',
    parts: row.parts_json as TempoUIMessage['parts'],
  }));
}
