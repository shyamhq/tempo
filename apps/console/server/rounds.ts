import type { Answer, PendingRound, Question, QuestionInput } from '@tempo/contracts';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '../db';
import { clarification_rounds } from '../db/schema';
import { appendEvent } from './event-log';
import { newRoundId } from './ids';
import { nowIso } from './threads';

export type OpenRoundResult =
  | { ok: true; round: PendingRound }
  | { ok: false; error: 'round_already_pending' };

export async function openRound(
  threadId: string,
  questions: QuestionInput[],
): Promise<OpenRoundResult> {
  const pending = await db
    .select({ id: clarification_rounds.id })
    .from(clarification_rounds)
    .where(
      and(eq(clarification_rounds.thread_id, threadId), eq(clarification_rounds.status, 'pending')),
    )
    .limit(1);
  if (pending.length > 0) return { ok: false, error: 'round_already_pending' };

  const id = newRoundId();
  const withIds: Question[] = questions.map((q) => ({ ...q, id: `q_${ulid()}` }));
  await db.insert(clarification_rounds).values({
    id,
    thread_id: threadId,
    questions_json: withIds,
    status: 'pending',
  });
  const round: PendingRound = { id, questions: withIds };
  await appendEvent(threadId, { kind: 'round_opened', round });
  return { ok: true, round };
}

export async function answerRound(roundId: string, answers: Answer[]): Promise<void> {
  const [row] = await db
    .select()
    .from(clarification_rounds)
    .where(eq(clarification_rounds.id, roundId))
    .limit(1);
  if (!row) throw new Error('round_not_found');
  const answered_at = nowIso();
  await db
    .update(clarification_rounds)
    .set({ status: 'answered', answers_json: answers, answered_at })
    .where(eq(clarification_rounds.id, roundId));
  await appendEvent(row.thread_id, { kind: 'round_answered', round_id: roundId });
}

// Used by GET /api/clarification-rounds/:id (read by Agent via `tempo_get_clarification_answers`).
// Returns the discriminated union shape the MCP tool surface declares.
export type RoundAnswersView =
  | { status: 'pending' }
  | { status: 'answered'; answered_at: string; answers: Answer[] };

export async function getRoundAnswers(roundId: string): Promise<RoundAnswersView | null> {
  const [row] = await db
    .select()
    .from(clarification_rounds)
    .where(eq(clarification_rounds.id, roundId))
    .limit(1);
  if (!row) return null;
  if (row.status === 'pending' || row.answered_at === null) return { status: 'pending' };
  return {
    status: 'answered',
    answered_at: row.answered_at,
    answers: (row.answers_json ?? []) as Answer[],
  };
}

export async function getPendingRound(threadId: string): Promise<PendingRound | null> {
  const [row] = await db
    .select()
    .from(clarification_rounds)
    .where(
      and(eq(clarification_rounds.thread_id, threadId), eq(clarification_rounds.status, 'pending')),
    )
    .limit(1);
  if (!row) return null;
  return { id: row.id, questions: row.questions_json as Question[] };
}
