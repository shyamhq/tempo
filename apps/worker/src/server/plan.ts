import { randomUUID } from 'node:crypto';
import type { Actor, AgentPlanBlocks, AgentPlanState, Plan } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { readPlanRow } from '@tempo/db/queries/plans';
import { plans, threads } from '@tempo/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { logger } from '../logger';
import { appendEvent } from './event-log';
import {
  blocksToPmDoc,
  blockToHtml,
  htmlToPmBlockContainers,
  type PmBlockContainer,
  parseHtmlDocToBlocks,
  pmDocToBlocks,
} from './plan/block-html';

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
      updated_at: row.updated_at.toISOString(),
      updated_by: row.updated_by,
    },
  };
}

export async function writePlan(
  threadId: string,
  pmJson: unknown,
  by: Actor,
): Promise<{ updated_at: string }> {
  if (pmJson === null || typeof pmJson !== 'object') {
    throw new InvalidPlanBodyError('plan body must be a document object');
  }
  const updated_at = new Date();
  const updated_at_iso = updated_at.toISOString();
  await db
    .update(plans)
    .set({ body_pm_json: JSON.stringify(pmJson), updated_by: by, updated_at })
    .where(eq(plans.thread_id, threadId));
  await db.update(threads).set({ updated_at }).where(eq(threads.id, threadId));
  if (by === 'agent') {
    await appendEvent(threadId, { kind: 'plan_edited_by_agent', updated_at: updated_at_iso });
  }
  return { updated_at: updated_at_iso };
}

export async function requestPlanRecheck(threadId: string): Promise<{ updated_at: string }> {
  const [t] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!t) throw new ThreadNotFoundError(threadId);
  const updated_at = new Date().toISOString();
  await appendEvent(threadId, { kind: 'plan_edited_by_dev', updated_at });
  return { updated_at };
}

export async function getPlanState(threadId: string): Promise<AgentPlanState> {
  const row = await readPlanRow(threadId);
  return {
    status: row.status,
    updated_at: row.updated_at?.toISOString() ?? null,
    updated_by: row.updated_by,
  };
}

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
      logger.warn({ threadId }, 'getPlanBlocks: block missing id, skipping');
      continue;
    }
    const html = await blockToHtml(block);
    result.push({ id: `${block.id}$`, html });
  }
  return { blocks: result };
}

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
  const [first, ...rest] = await htmlToPmBlockContainers(html);
  if (!first) throw new InvalidPlanBodyError('html produced no plan blocks');
  first.attrs = { ...first.attrs, id: rawId };
  for (const bc of rest) {
    bc.attrs = { ...bc.attrs, id: randomUUID() };
  }
  group.content.splice(idx, 1, first, ...rest);
  await writePlan(threadId, pmJson, actor);
}

export async function addBlocks(
  threadId: string,
  referenceId: string | null,
  position: 'before' | 'after' | 'end',
  htmlBlocks: string[],
  actor: Actor,
): Promise<{ ids: string[] }> {
  if (position === 'end' && referenceId !== null) {
    throw new InvalidPlanBodyError(
      "position 'end' requires reference_id to be null; use 'after' with a reference_id instead",
    );
  }

  const row = await readPlanRow(threadId);
  const pmJson = parsePmJsonOrThrow(row.body_pm_json);
  const group = getRootBlockGroup(pmJson);

  const perEntry = await Promise.all(htmlBlocks.map((html) => htmlToPmBlockContainers(html)));
  const newContainers: PmBlockContainer[] = [];
  for (const [i, entry] of perEntry.entries()) {
    if (entry.length === 0) {
      throw new InvalidPlanBodyError(`blocks[${i}]: html produced no plan blocks`);
    }
    for (const bc of entry) {
      bc.attrs = { ...bc.attrs, id: randomUUID() };
      newContainers.push(bc);
    }
  }
  const newIds = newContainers.map((bc) => `${bc.attrs.id}$`);

  let insertAt: number;
  if (referenceId === null) {
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

  const updated_at = new Date();
  const updated_at_iso = updated_at.toISOString();
  const written = await db
    .update(plans)
    .set({ body_pm_json: JSON.stringify(pmJson), updated_by: actor, updated_at })
    .where(and(eq(plans.thread_id, threadId), isNull(plans.body_pm_json)))
    .returning({ id: plans.id });
  if (written.length === 0) throw new PlanNotEmptyError();

  await db.update(threads).set({ updated_at }).where(eq(threads.id, threadId));
  if (actor === 'agent') {
    await appendEvent(threadId, { kind: 'plan_edited_by_agent', updated_at: updated_at_iso });
  }
  return { ids };
}

export async function deleteBlock(threadId: string, blockId: string, actor: Actor): Promise<void> {
  const rawId = stripDollar(blockId);
  const row = await readPlanRow(threadId);
  const pmJson = parsePmJsonOrThrow(row.body_pm_json);
  const group = getRootBlockGroup(pmJson);
  const idx = group.content.findIndex((bc) => bc.attrs?.id === rawId);
  if (idx === -1) throw new BlockNotFoundError(blockId);
  group.content.splice(idx, 1);
  if (group.content.length === 0) {
    const [empty] = await htmlToPmBlockContainers('<p></p>');
    if (!empty) throw new Error('editor failed to parse <p></p> into a block');
    empty.attrs = { ...empty.attrs, id: randomUUID() };
    group.content.push(empty);
  }
  await writePlan(threadId, pmJson, actor);
}

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

function getRootBlockGroup(pmJson: unknown): { content: PmBlockContainer[] } {
  const doc = pmJson as { type?: string; content?: Array<{ type?: string; content?: unknown[] }> };
  const group = doc?.content?.[0];
  if (doc?.type !== 'doc' || group?.type !== 'blockGroup' || !Array.isArray(group.content)) {
    throw new InvalidPlanBodyError('plan body is malformed');
  }
  return group as { content: PmBlockContainer[] };
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
