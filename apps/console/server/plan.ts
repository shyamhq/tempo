import type { Actor, AgentPlanState, Plan } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import type { PartialBlock } from '@blocknote/core';
import { db } from '../db';
import { plans, threads } from '../db/schema';
import { appendEvent } from './event-log';
import { decodeFromAgent } from './plan/decode';
import { encodeForAgent } from './plan/encode';
import { serverPlanEditor } from './plan/server-editor';
import { nowIso, toIso } from './threads';

export async function getPlan(threadId: string): Promise<Plan> {
  const { status, row } = await readPlanRow(threadId);
  if (!row || row.body_pm_json == null || row.updated_at == null || row.updated_by == null) {
    return { status, body: null };
  }
  return {
    status,
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

// The agent variants wrap getPlan / writePlan with the sentinel encoder. The
// MCP boundary is the only place these are reached from — every other caller
// (the Console editor, the GET handler) goes through the PM-JSON-native pair
// above. Stateless: the marker carries its own style payload, so nothing
// flows between pull and write besides the markdown itself.
//
// `_prosemirrorJSONToBlocks` and `_blocksToProsemirrorNode` are BlockNote's
// semi-internal escape hatch (verified against @blocknote/server-util
// v0.51.4). Pin the version; revisit if the BlockNote upgrade touches these.
export async function getPlanForAgent(threadId: string): Promise<AgentPlanState> {
  const { status, row } = await readPlanRow(threadId);
  if (!row || row.body_pm_json == null || row.updated_at == null || row.updated_by == null) {
    return { status, body: null };
  }
  const pmJson = parsePmJson(row.body_pm_json);
  // Malformed row — treat the same as a missing body rather than crashing
  // the Agent's poll path with an uncaught throw out of BlockNote.
  if (pmJson === null) return { status, body: null };
  const blocks = serverPlanEditor._prosemirrorJSONToBlocks(stripCommentMarks(pmJson));
  const markdown = await encodeForAgent(blocks);
  return {
    status,
    body: {
      markdown,
      updated_at: toIso(row.updated_at),
      updated_by: row.updated_by,
    },
  };
}

export async function writePlanFromAgent(
  threadId: string,
  markdown: string,
): Promise<{ updated_at: string }> {
  const { row } = await readPlanRow(threadId);
  // The decoder's reconcileIds wants the previous blocks for id preservation.
  // A malformed prior row drops the id-stability fallback (we start from
  // empty) rather than crashing the agent's write.
  const previousPmJson = row?.body_pm_json != null ? parsePmJson(row.body_pm_json) : null;
  const previousBlocks =
    previousPmJson !== null
      ? serverPlanEditor._prosemirrorJSONToBlocks(stripCommentMarks(previousPmJson))
      : [];
  const blocks = await decodeFromAgent(markdown, previousBlocks);
  const pmJson = serverPlanEditor
    ._blocksToProsemirrorNode(blocks as PartialBlock[])
    .toJSON();
  return writePlan(threadId, pmJson, 'agent');
}

async function readPlanRow(threadId: string) {
  const [t] = await db
    .select({ status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  const [row] = await db
    .select({
      body_pm_json: plans.body_pm_json,
      updated_at: plans.updated_at,
      updated_by: plans.updated_by,
    })
    .from(plans)
    .where(eq(plans.thread_id, threadId))
    .limit(1);
  return { status: t?.status ?? 'unapproved', row };
}

function parsePmJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// The Console editor registers the BlockNote CommentsExtension, which adds a
// `comment` ProseMirror mark not declared in `planSchema`. The server editor
// is constructed from `planSchema` alone (no extensions), so `comment` marks
// on saved docs make prosemirror-model throw `There is no mark type comment
// in this schema` from `_prosemirrorJSONToBlocks`. Comment anchors are not
// part of the agent's markdown view of the Plan anyway — they're pulled via
// the comments API — so strip them at the agent boundary instead of trying
// to register the extension server-side.
function stripCommentMarks(pmJson: unknown): unknown {
  if (pmJson === null || typeof pmJson !== 'object') return pmJson;
  if (Array.isArray(pmJson)) return pmJson.map(stripCommentMarks);
  const node = pmJson as Record<string, unknown>;
  const next: Record<string, unknown> = { ...node };
  if (Array.isArray(node.marks)) {
    next.marks = (node.marks as Array<Record<string, unknown>>).filter(
      (m) => m && m.type !== 'comment',
    );
  }
  if (Array.isArray(node.content)) {
    next.content = (node.content as unknown[]).map(stripCommentMarks);
  }
  return next;
}
