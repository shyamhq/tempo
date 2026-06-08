import { randomUUID } from 'node:crypto';
import type { Actor, AgentPlanBlocks, AgentPlanState, Plan } from '@tempo/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { plans, threads } from '../db/schema';
import { logger } from '../logger';
import { readPlanRow } from './db-queries/plans';
import { appendEvent } from './event-log';
import {
  blocksToPmDoc,
  blockToHtml,
  htmlToPmBlockContainer,
  type PmBlockContainer,
  parseHtmlDocToBlocks,
  pmDocToBlocks,
} from './plan/block-html';
import { nowIso, toIso } from './threads';

export async function getPlan(threadId: string): Promise<Plan> {
  const row = await readPlanRow(threadId);
  if (row.body_pm_json == null || row.updated_at == null || row.updated_by == null) {
    return { status: row.status, body: null };
  }
  let pmJson: unknown = null;
  try {
    pmJson = JSON.parse(row.body_pm_json);
  } catch {
    return { status: row.status, body: null };
  }
  return {
    status: row.status,
    body: {
      pm_json: pmJson,
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

// ---------------------------------------------------------------------------
// Agent-facing read-only accessors

// Lightweight accessor for the attach route: returns only status + timestamps.
// No PM JSON parse, no jsdom. Fast enough for the attach hot path.
export async function getPlanState(threadId: string): Promise<AgentPlanState> {
  const row = await readPlanRow(threadId);
  return {
    status: row.status,
    updated_at: row.updated_at ? toIso(row.updated_at) : null,
    updated_by: row.updated_by,
  };
}

// Returns the Plan as a flat list of blocks with HTML content, keyed by
// opaque `$`-suffixed IDs so the Agent treats them as opaque tokens.
export async function getPlanBlocks(threadId: string): Promise<AgentPlanBlocks> {
  const row = await readPlanRow(threadId);
  if (row.body_pm_json == null) {
    return { blocks: [] };
  }
  let pmJson: unknown;
  try {
    pmJson = JSON.parse(row.body_pm_json);
  } catch {
    return { blocks: [] };
  }
  const allBlocks = pmDocToBlocks(pmJson);
  const result: { id: string; html: string }[] = [];
  for (const block of allBlocks) {
    if (!block.id) {
      // Corrupted block — log and skip. Dev can repair manually.
      logger.warn({ threadId }, 'getPlanBlocks: block missing id, skipping');
      continue;
    }
    const html = await blockToHtml(block);
    result.push({ id: `${block.id}$`, html });
  }
  return { blocks: result };
}

// ---------------------------------------------------------------------------
// Agent-facing write orchestrators

// The write orchestrators below do block-level surgery on the stored pm_json:
// they read the original tree, locate the target blockContainer in the
// root blockGroup by `attrs.id`, and splice (replace / insert / remove). The
// new content is converted from HTML via `htmlToPmBlockContainer`, which
// produces a single PM blockContainer node — that's the only conversion that
// runs through BlockNote.
//
// Why surgery (rather than `pmDocToBlocks` → mutate → `blocksToPmDoc`): the
// round-trip through BlockNote's Block model silently drops every `comment`
// mark, because the mark spec tags itself `blocknoteIgnore: true` in
// `extendMarkSchema`. Comments on untouched blocks would vanish on every
// write. Surgery keeps the original tree byte-for-byte except at the target
// index — comment marks on every other block are preserved by construction.

// Replace one block's content. The block's id is preserved; the surrounding
// blocks (and their anchored Comments) are untouched.
export async function updateBlock(
  threadId: string,
  blockId: string,
  html: string,
  actor: Actor,
): Promise<void> {
  const rawId = stripDollar(blockId);
  const row = await readPlanRow(threadId);
  const pmJson = parsePmJsonOrThrow(row.body_pm_json);
  const group = getRootBlockGroup(pmJson);
  const idx = group.content.findIndex((bc) => bc.attrs?.id === rawId);
  if (idx === -1) throw new BlockNotFoundError(blockId);
  const replacement = await htmlToPmBlockContainer(html);
  // Preserve the original block id — the Agent must not change IDs.
  replacement.attrs = { ...replacement.attrs, id: rawId };
  group.content[idx] = replacement;
  await writePlan(threadId, pmJson, actor);
}

// Insert new blocks relative to an existing block (or at the doc boundary).
// Returns `$`-suffixed IDs for the newly inserted blocks.
export async function addBlocks(
  threadId: string,
  referenceId: string | null,
  position: 'before' | 'after' | 'end',
  htmlBlocks: string[],
  actor: Actor,
): Promise<{ ids: string[] }> {
  // Ambiguous input: 'end' with a reference_id has no clear semantics. The
  // caller must either use null + 'end' to append, or a reference_id + 'after'.
  if (position === 'end' && referenceId !== null) {
    throw new InvalidPlanBodyError(
      "position 'end' requires reference_id to be null; use 'after' with a reference_id instead",
    );
  }

  const row = await readPlanRow(threadId);
  const pmJson = parsePmJsonOrThrow(row.body_pm_json);
  const group = getRootBlockGroup(pmJson);

  const newContainers = await Promise.all(
    htmlBlocks.map(async (html) => {
      const bc = await htmlToPmBlockContainer(html);
      bc.attrs = { ...bc.attrs, id: randomUUID() };
      return bc;
    }),
  );
  const newIds = newContainers.map((bc) => `${bc.attrs.id}$`);

  let insertAt: number;
  if (referenceId === null) {
    // null + 'before' = prepend; null + 'after' or 'end' = append.
    insertAt = position === 'before' ? 0 : group.content.length;
  } else {
    const rawRef = stripDollar(referenceId);
    const refIdx = group.content.findIndex((bc) => bc.attrs?.id === rawRef);
    if (refIdx === -1) throw new BlockNotFoundError(referenceId);
    insertAt = position === 'before' ? refIdx : refIdx + 1;
  }
  group.content.splice(insertAt, 0, ...newContainers);

  await writePlan(threadId, pmJson, actor);
  return { ids: newIds };
}

// First-time Plan write from a single HTML document. Parses the doc into
// top-level blocks, assigns fresh ids, and persists in one shot. Refuses if
// the Plan already has any body — the Agent must use the per-block tools so
// anchored Comments survive.
//
// The empty-Plan guard is a conditional `UPDATE ... WHERE body_pm_json IS
// NULL`: if `rowsAffected` (returned ids) is zero, another writer landed
// first and we throw `PlanNotEmptyError`. A separate read-then-write would
// race — two concurrent inits could both observe NULL and both succeed,
// silently losing the first write.
//
// The guard is also *load-bearing for Comment fidelity*: this path uses
// `blocksToPmDoc`, which strips `comment` marks (BlockNote tags them
// `blocknoteIgnore: true` in `extendMarkSchema`). Safe here because no
// Comments can be anchored to a Plan that does not exist yet. If this guard
// is ever relaxed (e.g. to allow "overwrite" semantics), every anchored
// Comment in the Plan would silently vanish — switch to the block-surgery
// path in `updateBlock` / `addBlocks` instead.
export async function updatePlan(
  threadId: string,
  html: string,
  actor: Actor,
): Promise<{ ids: string[] }> {
  const partials = await parseHtmlDocToBlocks(html);
  if (partials.length === 0) {
    throw new InvalidPlanBodyError('html parsed to zero blocks');
  }
  const pmJson = blocksToPmDoc(partials);
  const group = getRootBlockGroup(pmJson);
  for (const bc of group.content) {
    bc.attrs = { ...bc.attrs, id: randomUUID() };
  }
  const ids = group.content.map((bc) => `${bc.attrs.id}$`);

  const updated_at = nowIso();
  const written = await db
    .update(plans)
    .set({ body_pm_json: JSON.stringify(pmJson), updated_by: actor, updated_at })
    .where(and(eq(plans.thread_id, threadId), isNull(plans.body_pm_json)))
    .returning({ id: plans.id });
  if (written.length === 0) throw new PlanNotEmptyError();

  await db.update(threads).set({ updated_at }).where(eq(threads.id, threadId));
  if (actor === 'agent') {
    await appendEvent(threadId, { kind: 'plan_edited_by_agent', updated_at });
  }
  return { ids };
}

// Remove a block. Keeps the document non-empty by inserting an empty paragraph
// when the last block is deleted (BlockNote requires at least one block).
export async function deleteBlock(threadId: string, blockId: string, actor: Actor): Promise<void> {
  const rawId = stripDollar(blockId);
  const row = await readPlanRow(threadId);
  const pmJson = parsePmJsonOrThrow(row.body_pm_json);
  const group = getRootBlockGroup(pmJson);
  const idx = group.content.findIndex((bc) => bc.attrs?.id === rawId);
  if (idx === -1) throw new BlockNotFoundError(blockId);
  group.content.splice(idx, 1);
  if (group.content.length === 0) {
    // BlockNote requires at least one block in the doc.
    const empty = await htmlToPmBlockContainer('<p></p>');
    empty.attrs = { ...empty.attrs, id: randomUUID() };
    group.content.push(empty);
  }
  await writePlan(threadId, pmJson, actor);
}

// ---------------------------------------------------------------------------
// Internal helpers

function parsePmJsonOrThrow(body_pm_json: string | null): unknown {
  if (body_pm_json == null) throw new InvalidPlanBodyError('plan has no body');
  try {
    return JSON.parse(body_pm_json);
  } catch {
    throw new InvalidPlanBodyError('plan body is not valid JSON');
  }
}

function stripDollar(id: string): string {
  return id.endsWith('$') ? id.slice(0, -1) : id;
}

// Locate the root blockGroup whose `content` array carries the top-level
// blockContainers. BlockNote's pm_json shape is always
// `doc → blockGroup → blockContainer[]`. Mutating the returned array mutates
// the original tree (intentional — the write orchestrators rely on this).
function getRootBlockGroup(pmJson: unknown): { content: PmBlockContainer[] } {
  const doc = pmJson as { type?: string; content?: Array<{ type?: string; content?: unknown[] }> };
  const group = doc?.content?.[0];
  if (doc?.type !== 'doc' || group?.type !== 'blockGroup' || !Array.isArray(group.content)) {
    throw new InvalidPlanBodyError('plan body is not a BlockNote doc / blockGroup');
  }
  return group as { content: PmBlockContainer[] };
}

// ---------------------------------------------------------------------------

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

export class BlockNotFoundError extends Error {
  constructor(public readonly blockId: string) {
    super('block not found');
    this.name = 'BlockNotFoundError';
  }
}

export class PlanNotEmptyError extends Error {
  constructor() {
    super('plan already has content; use block-level tools for incremental edits');
    this.name = 'PlanNotEmptyError';
  }
}
