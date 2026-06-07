import type { Actor, AgentPlanState, Plan } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { plans, threads } from '../db/schema';
import { parsePmJson, readPlanRow } from './db-queries/plans';
import { appendEvent } from './event-log';
import { nowIso, toIso } from './threads';

export async function getPlan(threadId: string): Promise<Plan> {
  const row = await readPlanRow(threadId);
  if (row.body_pm_json == null || row.updated_at == null || row.updated_by == null) {
    return { status: row.status, body: null };
  }
  return {
    status: row.status,
    body: {
      pm_json: parsePmJson(row.body_pm_json),
      updated_at: toIso(row.updated_at),
      updated_by: row.updated_by,
    },
  };
}

export async function writePlan(
  threadId: string,
  pmJson: unknown,
  by: Actor,
): Promise<{ updated_at: string }> {
  // Refuse to persist anything that isn't a ProseMirror doc-shaped object.
  // Storing `null` or a scalar would parse cleanly on read but blow up when
  // `_prosemirrorJSONToBlocks` ran against it (it would throw, surfacing as
  // a 500 on the next Agent poll).
  if (pmJson === null || typeof pmJson !== 'object') {
    throw new InvalidPlanBodyError('pm_json must be a ProseMirror document object');
  }
  const updated_at = nowIso();
  await db
    .update(plans)
    .set({ body_pm_json: JSON.stringify(pmJson), updated_by: by, updated_at })
    .where(eq(plans.thread_id, threadId));
  await db.update(threads).set({ updated_at }).where(eq(threads.id, threadId));
  // Dev edits no longer auto-nudge the Agent — every keystroke or comment
  // would drag it into a re-read on every save. The Dev triggers a recheck
  // explicitly via `requestPlanRecheck` (the "Recheck plan" button), and
  // Agent writes still emit so the Console can refresh its view.
  if (by === 'agent') {
    await appendEvent(threadId, { kind: 'plan_edited_by_agent', updated_at });
  }
  return { updated_at };
}

// Dev-initiated request for the Agent to re-read the current Plan. Emits the
// same event the auto-nudge used to, so nudge.ts / poll consumers don't need
// to change. The Plan body itself is unchanged.
//
// Throws `ThreadNotFoundError` when the thread does not exist — the route
// handler catches and surfaces a 404 rather than silently inserting an event
// row with an orphan foreign key.
export async function requestPlanRecheck(threadId: string): Promise<{ updated_at: string }> {
  const [t] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!t) throw new ThreadNotFoundError(threadId);
  const updated_at = nowIso();
  await appendEvent(threadId, { kind: 'plan_edited_by_dev', updated_at });
  return { updated_at };
}

export class ThreadNotFoundError extends Error {
  constructor(public readonly threadId: string) {
    super(`thread_not_found: ${threadId}`);
    this.name = 'ThreadNotFoundError';
  }
}

export class InvalidPlanBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPlanBodyError';
  }
}

// The Agent reads and writes the Plan as the same PM JSON the editor uses.
// Comment marks (BlockNote's CommentsExtension stamps a `comment` mark with
// `blocknoteIgnore: true` on every annotated text run) survive the round-trip
// by construction — the Agent receives them in `marks` arrays, leaves them on
// text it doesn't rewrite, and writes them back. The MCP tool description
// tells the Agent that those arrays carry Dev annotations and must be
// preserved verbatim on untouched runs.
export async function getPlanForAgent(threadId: string): Promise<AgentPlanState> {
  const row = await readPlanRow(threadId);
  if (row.body_pm_json == null || row.updated_at == null || row.updated_by == null) {
    return { status: row.status, body: null };
  }
  const pmJson = parsePmJson(row.body_pm_json);
  if (pmJson === null) return { status: row.status, body: null };
  return {
    status: row.status,
    body: {
      pm_json: pmJson,
      updated_at: toIso(row.updated_at),
      updated_by: row.updated_by,
    },
  };
}

export async function writePlanFromAgent(
  threadId: string,
  pmJson: unknown,
): Promise<{ updated_at: string }> {
  return writePlan(threadId, pmJson, 'agent');
}
