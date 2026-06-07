# Plan-Comments Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Agent's Markdown round-trip from destroying anchored comments, delete the four-file pipeline that made it possible, add a Notion-style right-side comment gutter with hide-resolved + orphan handling, and give the Dev a way to delete a comment.

**Architecture:** The Agent reads and writes the Plan as ProseMirror JSON (already the at-rest format), so the `comment` mark survives every round-trip by construction. The encode/decode/reconcile/server-editor pipeline is deleted. A new client-side `plan-comment-gutter.tsx` enumerates threads from the bridge, computes one DOM `top` per thread via a single shared PM-doc walk, and renders icons in a fixed right rail; threads whose anchor is missing land in an "Orphaned" section instead of disappearing. A new `DELETE /api/comments/:id` handler + bridge `deleteThread` lets the Dev remove a comment.

**Tech Stack:** Next.js App Router (Console), Drizzle/libSQL, BlockNote + TipTap/ProseMirror, Zod contracts in `@tempo/contracts`, TanStack Query, MCP via stdio (`apps/agent`), Bun, Biome, no test suite (per CLAUDE.md — verification is typecheck + Pino logs + manual exercise).

**Verification model** — CLAUDE.md says no tests in MVP. Each task's "verify" step is:
1. `bun run typecheck` clean
2. `bun run lint` clean
3. exercise the affected surface in `bun run dev` and observe the expected behaviour (or, for the Agent path, `bun run --filter tempo-agent dev connect <token>` and watch logs)

Conventional commits are small and frequent so any task can be reverted on its own.

---

## Spec → task map

| Spec section | Tasks |
|---|---|
| Part 1 — PM-JSON wire | T1, T3, T4 |
| Part 2 — delete pipeline | T5 |
| Part 3 — right-side gutter | T7 |
| Part 4 — delete a comment | T6 |
| Part 5 — forced cleanup | T2 (`db-queries/plans.ts`) and T5 (`RESTORABLE_STYLE_KEYS` gone with `encode.ts`) |
| Spotted-but-not-fixed filings | T8 |
| Judge advisory: single-walk `Map<threadId, pos>` | T7 (built in from the start) |
| Judge advisory: `comment_deleted` handler | T6 |
| `code-simplifier` + `code-reviewer` | T9 |

---

## Task 1: Contracts — PM-JSON wire and `comment_deleted` event

**Files:**
- Modify: `packages/contracts/src/primitives.ts`
- Modify: `packages/contracts/src/mcp.ts`
- Modify: `packages/contracts/src/events.ts`
- Modify: `packages/contracts/src/http.ts`

The contracts change first because every downstream file (server, agent, client) reads through these types — failing the typecheck on the contracts pulls every consumer into the change in one coordinated step.

- [ ] **Step 1: Switch `AgentPlanBody` from `markdown` to `pm_json` in `primitives.ts`**

Replace lines 60–77 of `packages/contracts/src/primitives.ts` with:

```ts
// The agent-facing projection of a Plan. Same `pm_json` shape as `PlanBody` —
// the Agent reads and writes the editor's ProseMirror JSON directly. Keeping
// the two body types separate (rather than aliasing) makes future divergence
// (e.g. an agent-only `summary` field) a one-line change instead of a contract
// rewrite.
export const AgentPlanBody = z.object({
  pm_json: z.unknown(),
  updated_at: IsoTimestamp,
  updated_by: Actor,
});
export type AgentPlanBody = z.infer<typeof AgentPlanBody>;

export const AgentPlanState = z.object({
  status: ThreadStatus,
  body: AgentPlanBody.nullable(),
});
export type AgentPlanState = z.infer<typeof AgentPlanState>;
```

- [ ] **Step 2: Switch `WritePlanInput` from `markdown` to `pm_json` in `mcp.ts`**

In `packages/contracts/src/mcp.ts`, replace the `WritePlanInput` definition (around lines 38–44) with:

```ts
export const WritePlanInput = z.object({
  pm_json: z.unknown(),
});
export const WritePlanOutput = z.object({
  ok: z.literal(true),
  updated_at: IsoTimestamp,
});
```

- [ ] **Step 3: Add `comment_deleted` to `events.ts`**

In `packages/contracts/src/events.ts`, immediately after the `CommentUnresolvedEvent` block (line 52), add:

```ts
export const CommentDeletedEvent = eventBase.extend({
  kind: z.literal('comment_deleted'),
  comment_id: CommentId,
});
```

Append `CommentDeletedEvent,` to the `Event = z.discriminatedUnion('kind', [ … ])` list. Append `'comment_deleted',` to the `EventKind = z.enum([ … ])` list.

- [ ] **Step 4: Drop `AgentWritePlanRequest` from `http.ts`**

In `packages/contracts/src/http.ts`, delete the `AgentWritePlanRequest` block (lines 168–173 in the current file) and the surrounding comment. The Agent's HTTP route will be removed in T5 — the contract goes now so nothing still references it once the route file is deleted.

- [ ] **Step 5: Verify**

```
bun run typecheck
```

Expected: the contract package itself compiles. Many downstream files in `apps/console` and `apps/agent` will report `Property 'markdown' does not exist`, `Property 'pm_json' is missing`, etc. — those are the pull-through points T2–T5 fix.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/primitives.ts packages/contracts/src/mcp.ts packages/contracts/src/events.ts packages/contracts/src/http.ts
git commit -m "contracts: PM JSON on the agent plan wire · comment_deleted event

Switches AgentPlanBody and WritePlanInput from markdown to pm_json so the
agent edits the same shape stored at rest, preventing the Markdown round-trip
from stripping BlockNote comment marks. Adds the comment_deleted event for
Dev-initiated comment deletion. Drops AgentWritePlanRequest — the agent route
will be removed in the next commit."
```

Type errors in downstream files are expected at this point and are addressed in the next task.

---

## Task 2: Server — move DB queries out of `plan.ts`

**Files:**
- Create: `apps/console/server/db-queries/plans.ts`
- Modify: `apps/console/server/plan.ts`

CLAUDE.md rule 19 says DB / query logic lives in `apps/console/server/db-queries/**`, never in the business-rule module. Task 1 forces every caller of `readPlanRow` to change shape; per rule 19 the file is in the wrong layer and must be moved when touched.

- [ ] **Step 1: Create the db-queries module**

```ts
// apps/console/server/db-queries/plans.ts
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { plans, threads } from '../../db/schema';

export type PlanRow = {
  status: 'unapproved' | 'approved';
  body_pm_json: string | null;
  updated_at: string | null;
  updated_by: 'dev' | 'agent' | null;
};

export async function readPlanRow(threadId: string): Promise<PlanRow> {
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
  return {
    status: t?.status ?? 'unapproved',
    body_pm_json: row?.body_pm_json ?? null,
    updated_at: row?.updated_at ?? null,
    updated_by: (row?.updated_by ?? null) as PlanRow['updated_by'],
  };
}

export function parsePmJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Wire `plan.ts` through the new module**

In `apps/console/server/plan.ts`, replace the local `readPlanRow` and `parsePmJson` definitions with an import from the new module. Add at the top:

```ts
import { parsePmJson, readPlanRow } from './db-queries/plans';
```

Delete the local `async function readPlanRow(...)` (lines 138–154) and `function parsePmJson(...)` (lines 156–162). Update callers to read the new return shape — the body fields now sit directly on the row, no `row.row` wrapper. The existing two callers (`getPlan`, `getPlanForAgent`, `writePlanFromAgent`) need:

```ts
// old: const { status, row } = await readPlanRow(threadId);
//      if (!row || row.body_pm_json == null || …) { … }
//
// new: const row = await readPlanRow(threadId);
//      if (row.body_pm_json == null || …) { … }
//      // status is row.status
```

Update each caller's destructuring accordingly. `getPlan`'s shape becomes:

```ts
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
```

`getPlanForAgent` and `writePlanFromAgent` get the same destructuring shape (Task 3 rewrites their bodies, but the row read is consistent here).

- [ ] **Step 3: Verify**

```
bun run typecheck
```

Expected: `server/plan.ts` compiles with the new module. Errors elsewhere remain from T1 (still expected).

- [ ] **Step 4: Commit**

```bash
git add apps/console/server/db-queries/plans.ts apps/console/server/plan.ts
git commit -m "server: move Plan DB queries to db-queries/plans.ts

CLAUDE.md rule 19 — DB reads live in server/db-queries, not the business-rule
module. Pure refactor; no behaviour change. Forced by the impending switch of
getPlanForAgent / writePlanFromAgent to PM JSON, which touches every caller."
```

---

## Task 3: Server — switch Agent boundary to PM JSON, drop `stripCommentMarks`

**Files:**
- Modify: `apps/console/server/plan.ts`

This is the bug fix. `getPlanForAgent` returns PM JSON verbatim; `writePlanFromAgent` takes PM JSON and writes it. No encode, no decode, no `stripCommentMarks`, no `ServerBlockNoteEditor` instance.

- [ ] **Step 1: Replace `getPlanForAgent`, `writePlanFromAgent`, drop the pipeline imports and `stripCommentMarks`**

Open `apps/console/server/plan.ts`. Delete the imports of `PartialBlock`, `decodeFromAgent`, `encodeForAgent`, `serverPlanEditor` at the top of the file. The remaining imports look like:

```ts
import type { Actor, AgentPlanState, Plan } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { plans, threads } from '../db/schema';
import { parsePmJson, readPlanRow } from './db-queries/plans';
import { appendEvent } from './event-log';
import { nowIso, toIso } from './threads';
```

Replace the body of `getPlanForAgent` with:

```ts
// The Agent reads the Plan as the same PM JSON the editor uses. Comment marks
// (BlockNote's CommentsExtension stamps a `comment` mark with `blocknoteIgnore:
// true` on every annotated text run) survive the round-trip by construction —
// the Agent receives them, leaves them on text it doesn't rewrite, and writes
// them back. The MCP tool description tells the Agent that `marks` arrays
// carry Dev annotations and must be preserved verbatim on untouched runs.
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
```

Replace the body of `writePlanFromAgent` with:

```ts
export async function writePlanFromAgent(
  threadId: string,
  pmJson: unknown,
): Promise<{ updated_at: string }> {
  return writePlan(threadId, pmJson, 'agent');
}
```

Delete the `stripCommentMarks` function entirely (the trailing 14 lines of the file). Delete the long comment block above `getPlanForAgent` that describes the sentinel pipeline — it's no longer accurate.

`writePlan` itself stays unchanged: it already validates `pmJson` is a non-null object via `InvalidPlanBodyError`.

- [ ] **Step 2: Verify**

```
bun run typecheck
```

Expected: `apps/console/server/plan.ts` compiles. The Agent route at `app/api/threads/[id]/plan/agent/route.ts` still references the old `markdown` shape; that's resolved in T5.

- [ ] **Step 3: Commit**

```bash
git add apps/console/server/plan.ts
git commit -m "server: agent reads and writes Plan as PM JSON, not Markdown

Drops the stripCommentMarks workaround and the encode/decode/reconcile sentinel
pipeline. The Agent now sees the editor's ProseMirror JSON directly, so the
BlockNote 'comment' mark survives every round-trip — the Section 2 comment no
longer dies when the Agent edits Section 4."
```

---

## Task 4: Agent — update MCP tool descriptions and HTTP client

**Files:**
- Modify: `apps/agent/src/mcp-server.ts`
- Modify: `apps/agent/src/http-client.ts`

The Agent's two Plan tools change shape (`markdown` → `pm_json`). The tool descriptions are the new prompt the LLM follows — they must explicitly tell it that `marks` arrays carry Dev comments and must be preserved on every untouched text run.

- [ ] **Step 1: Rewrite the `tempo_pull_plan` and `tempo_write_plan` tool descriptions**

In `apps/agent/src/mcp-server.ts`, replace the two `server.registerTool('tempo_pull_plan', ...)` and `server.registerTool('tempo_write_plan', ...)` blocks (lines 43–61) with:

```ts
  server.registerTool(
    'tempo_pull_plan',
    {
      description:
        'Read the current Plan as a ProseMirror JSON document — the editor\'s native shape. The body is a tree of nodes (paragraphs, headings, bullets, code blocks, etc.); inside each text node, `marks` is an array describing inline styling (bold, italic, code, link, and — most importantly — `comment` marks that anchor Dev-authored Comments to specific text runs). Edit the document as a tree, not as text: replace whole nodes when you need to rewrite, splice into the `content` array when you need to add. ON EVERY TEXT NODE YOU DO NOT INTEND TO REWRITE, KEEP THE `marks` ARRAY EXACTLY AS YOU FOUND IT — dropping it orphans the Dev\'s Comment. When you do rewrite a text node, you may drop `comment` marks on the rewritten run (the Dev\'s anchor will fall to the next-best surface), but never drop other marks (`bold`, `italic`, `code`, `link`) unless the rewrite genuinely removes that styling.',
      inputSchema: {},
    },
    async () => wrap(await client.getPlan(threadId)),
  );

  server.registerTool(
    'tempo_write_plan',
    {
      description:
        'Replace the Plan with this ProseMirror JSON document. The same rules apply: preserve `marks` arrays on every untouched text node, and keep the document shape valid (every block node has a `type`; text nodes live inside `content` arrays; node names match the ones you received from tempo_pull_plan). Pull the latest Plan with tempo_pull_plan immediately before each write so you do not stomp Dev edits — Tempo is last-write-wins.',
      inputSchema: WritePlanInput.shape,
    },
    async (args) => wrap(await client.writePlan(threadId, args.pm_json)),
  );
```

- [ ] **Step 2: Update `ConsoleClient.writePlan` to take PM JSON**

In `apps/agent/src/http-client.ts`, replace the `writePlan` method (around lines 41–50) with:

```ts
  writePlan(threadId: ThreadId, pm_json: unknown) {
    return this.send(
      'POST',
      `/api/threads/${threadId}/plan/agent`,
      { pm_json },
      WritePlanResponse,
    );
  }
```

The route path stays `/plan/agent` for now (T5 collapses it).

- [ ] **Step 3: Verify**

```
bun run typecheck
```

Expected: `apps/agent` compiles. The console-side agent route still expects `markdown` in the request body; that is fixed in T5.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/mcp-server.ts apps/agent/src/http-client.ts
git commit -m "agent: tempo_pull_plan / tempo_write_plan trade Markdown for PM JSON

Tool descriptions explicitly instruct the model to preserve every \`marks\`
array on untouched text nodes — that is where Dev-authored Comment anchors
live. HTTP client signature follows."
```

---

## Task 5: Delete the encode/decode pipeline and the Agent-specific HTTP route

**Files:**
- Delete: `apps/console/server/plan/encode.ts`
- Delete: `apps/console/server/plan/decode.ts`
- Delete: `apps/console/server/plan/reconcile-ids.ts`
- Delete: `apps/console/server/plan/server-editor.ts`
- Delete: `apps/console/server/plan/` directory itself if it becomes empty
- Delete: `apps/console/app/api/threads/[id]/plan/agent/route.ts` (and its parent dir if empty)
- Modify: `apps/console/app/api/threads/[id]/plan/route.ts` (route now serves both Dev and Agent)
- Modify: `apps/console/package.json` (drop `@blocknote/server-util`)
- Modify: `apps/agent/src/http-client.ts` (point `getPlan` and `writePlan` at the unified route)

The Agent's "annotated Markdown" route disappears. Both the Dev (Console) and the Agent hit `POST /api/threads/:id/plan` with `{ pm_json }`; the actor check in `authFromRequest` decides which `writePlan` to call.

- [ ] **Step 1: Delete the pipeline files**

```bash
rm apps/console/server/plan/encode.ts
rm apps/console/server/plan/decode.ts
rm apps/console/server/plan/reconcile-ids.ts
rm apps/console/server/plan/server-editor.ts
rmdir apps/console/server/plan
rm apps/console/app/api/threads/[id]/plan/agent/route.ts
rmdir apps/console/app/api/threads/[id]/plan/agent
```

- [ ] **Step 2: Drop the dependency**

In `apps/console/package.json`, remove the `"@blocknote/server-util": "^0.51.4",` line from `dependencies`. Then:

```bash
bun install
```

Expected: `bun.lock` updates; the package is removed from `node_modules`.

- [ ] **Step 3: Unify the plan route**

In `apps/console/app/api/threads/[id]/plan/route.ts`, leave `GET` and `POST` exactly as they are — they already accept `WritePlanRequest` (`pm_json`) and route through `writePlan`, which now handles both actors. The only thing to verify is that the Dev-vs-Agent distinction for `getPlan` is still correct: `getPlan` returns `Plan` (`pm_json` shape), and the Agent expects `AgentPlanState` (also `pm_json` shape post T1) — which means we either keep two GETs that return identical bodies or we collapse them. Collapse:

Add a thin GET handler that returns the shape the caller asks for via the actor:

```ts
import { GetPlanResponse } from '@tempo/contracts/http';
import { AgentPlanState, type Plan } from '@tempo/contracts';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import {
  getPlan,
  getPlanForAgent,
  InvalidPlanBodyError,
  writePlan,
} from '../../../../../server/plan';
import { WritePlanRequest } from '@tempo/contracts/http';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (auth?.actor === 'agent') {
    if (auth.thread_id !== id) return err('unauthorized', 401);
    return ok(await getPlanForAgent(id));
  }
  return ok(await getPlan(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  const parsed = await parseBody(req, WritePlanRequest);
  if (!parsed.ok) return parsed.response;
  try {
    const { updated_at } = await writePlan(id, parsed.data.pm_json, auth.actor);
    return ok({ ok: true, updated_at });
  } catch (e) {
    if (e instanceof InvalidPlanBodyError) return err('invalid_plan_body', 400);
    throw e;
  }
}
```

Since `getPlan` and `getPlanForAgent` now return the same shape modulo the type label, the actor-aware GET is conservative — it preserves the contract surface the Agent expects (`AgentPlanState`) without forcing the Console-side schema.

- [ ] **Step 4: Point the Agent's HTTP client at the unified path**

In `apps/agent/src/http-client.ts`, change the two methods:

```ts
  getPlan(threadId: ThreadId) {
    return this.send('GET', `/api/threads/${threadId}/plan`, null, AgentPlanState);
  }

  writePlan(threadId: ThreadId, pm_json: unknown) {
    return this.send('POST', `/api/threads/${threadId}/plan`, { pm_json }, WritePlanResponse);
  }
```

(Drop `/agent` from both URLs.)

- [ ] **Step 5: Verify**

```
bun run typecheck
bun run lint
```

Expected: both clean. Then a smoke test:

```
bun run --filter @tempo/console dev
```

Open an existing Thread with a Plan and a Comment, exercise the editor — the comment marks should be visible. Then connect the Agent CLI:

```
bun run --filter tempo-agent dev connect <connect_token>
```

Watch the CLI's first `tempo_pull_plan` log line — the body now contains `pm_json` not `markdown`. Have the Agent rewrite an unrelated section. After the Agent's write, the unchanged-section's Comment still appears in the Console editor — this is the bug fix.

- [ ] **Step 6: Commit**

```bash
git add -A apps/console/app/api/threads/\[id\]/plan apps/console/server apps/console/package.json apps/agent/src/http-client.ts bun.lock
git commit -m "remove the Markdown-sentinel Plan pipeline · unify Agent + Dev route

Deletes server/plan/{encode,decode,reconcile-ids,server-editor}.ts and the
companion app/api/threads/[id]/plan/agent route. Drops the @blocknote/server-util
dep. The unified /api/threads/:id/plan handler reads the actor and returns
the right shape; both sides now speak PM JSON."
```

---

## Task 6: Delete a comment — endpoint, bridge, card action, event handler

**Files:**
- Modify: `apps/console/server/comments.ts` (add `deleteComment`)
- Create: `apps/console/app/api/comments/[id]/route.ts` (the file does not exist yet; only sub-resource routes do)
- Modify: `apps/console/lib/api-client.ts` (add `deleteComment`)
- Modify: `apps/console/components/thread/editor/comment-thread-bridge.ts` (implement `deleteThread`)
- Modify: `apps/console/components/thread/editor/plan-comment-card.tsx` (add Delete action)
- Modify: `apps/console/hooks/use-thread-events.ts` (handle `comment_deleted`)

The Agent does not get a delete tool — Dev only. Confirm dialog before the destructive call.

- [ ] **Step 1: Server function**

In `apps/console/server/comments.ts`, append:

```ts
export async function deleteComment(commentId: string): Promise<void> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) throw new Error('comment_not_found');

  // SQLite has FKs disabled in this project (AGENTS.md spotted-but-not-fixed)
  // so cascades run manually. Replies first (delete-attachments cascade lives
  // in attachments.ts if a row references a reply), then the comment row.
  await db.transaction(async (tx) => {
    await tx.delete(replies).where(eq(replies.comment_id, commentId));
    await tx.delete(comments).where(eq(comments.id, commentId));
  });
  await appendEvent(row.thread_id, { kind: 'comment_deleted', comment_id: commentId });
}
```

The `replies` table reference already exists in the file's imports. If attachments need explicit cleanup, follow the same pattern as `deleteThread` in `server/threads.ts` — but for the first pass, the attachments table's `reply_id` rows become orphans rather than getting deleted, matching the existing manual-cascade scope.

- [ ] **Step 2: HTTP route**

Create `apps/console/app/api/comments/[id]/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { deleteComment } from '../../../../server/comments';
import { err, ok } from '../../../../server/http';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  // Dev-only — the Agent never gets a delete-comment tool, so any auth that
  // isn't a Dev (single-user MVP gate) is rejected here.
  if (!auth || auth.actor !== 'dev') return err('unauthorized', 401);
  try {
    await deleteComment(id);
  } catch (e) {
    if (e instanceof Error && e.message === 'comment_not_found') return err('not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
```

- [ ] **Step 3: api-client method**

In `apps/console/lib/api-client.ts`, add the import line (top of the file, alongside the existing response imports):

```ts
import { z } from 'zod';
const DeleteCommentResponse = z.object({ ok: z.literal(true) });
```

(Inline `DeleteCommentResponse` rather than threading a new contract through `http.ts` — it's a one-shape ok-envelope and matches the local-only API client patterns.)

In the `export const api = { … }` object, alongside `resolveComment` / `unresolveComment`, add:

```ts
  deleteComment: (commentId: string) =>
    request('DELETE', `/api/comments/${commentId}`, undefined, DeleteCommentResponse),
```

- [ ] **Step 4: Bridge `deleteThread`**

In `apps/console/components/thread/editor/comment-thread-bridge.ts`, replace the existing `deleteThread` method (the one that throws) with:

```ts
  async deleteThread(options: { threadId: string }): Promise<void> {
    await api.deleteComment(options.threadId);
    this.invalidate();
    this.notify();
  }
```

Update the file-top mapping comment to reflect that `deleteThread` is now wired:

```ts
// BlockNote createThread(initialComment)    → POST /api/threads/:id/comments
// BlockNote addComment(threadId, comment)   → POST /api/comments/:id/replies
// BlockNote resolveThread(threadId)         → POST /api/comments/:id/resolve
// BlockNote unresolveThread(threadId)       → POST /api/comments/:id/unresolve
// BlockNote deleteThread(threadId)          → DELETE /api/comments/:id
// updateComment / deleteComment / addReaction / deleteReaction → throw
//   (Tempo does not expose per-reply edit/delete or reactions in this phase)
```

Leave `deleteComment` (single-reply delete) and the reaction methods throwing — Tempo doesn't model those.

- [ ] **Step 5: Card "Delete thread" action**

In `apps/console/components/thread/editor/plan-comment-card.tsx`, import the trash icon and the bridge handle. Add a Delete control next to the Resolve button. Wire it through `threadStore.deleteThread({ threadId: thread.id })`. Place the implementation inside the non-resolved branch (`{thread.resolved ? … : ( … )}`); the resolved branch already shows only a Reopen button — keep that minimal.

Add a `deleting` state and a destructive confirm. Insert this just before `sendReply` is declared:

```tsx
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (deleting || !threadStore) return;
    const ok = window.confirm('Delete this comment and all replies? This cannot be undone.');
    if (!ok) return;
    setDeleting(true);
    try {
      await threadStore.deleteThread({ threadId: thread.id });
    } finally {
      setDeleting(false);
    }
  };
```

Then, inside the non-resolved branch's footer row (the one with the Resolve + Reply buttons, around line 148), add a destructive button as a sibling of the Resolve button:

```tsx
              <Tooltip content="Delete">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    void doDelete();
                  }}
                  className="inline-flex items-center gap-1.5 text-body-sm font-medium text-ink-subtle hover:text-danger hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md px-2 py-1.5"
                >
                  {deleting ? (
                    <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-icon-sm" aria-hidden />
                  )}
                </button>
              </Tooltip>
```

Import `Trash2` from `lucide-react` at the top of the file (alongside `Check`, `CornerDownLeft`, `Loader2`).

- [ ] **Step 6: SSE handler for `comment_deleted`**

In `apps/console/hooks/use-thread-events.ts`, add a case to the `switch (ev.kind)` block inside `apply()`:

```ts
      case 'comment_deleted':
        return {
          ...next,
          comments: next.comments.filter((c) => c.id !== ev.comment_id),
        };
```

The Agent's `poll` path does not need to handle `comment_deleted` (the Agent never wrote it; the only consequence on the Agent side is that the next `tempo_attach` sees one fewer Comment in `comments[]`, which is correct).

- [ ] **Step 7: Verify**

```
bun run typecheck && bun run lint
```

Then `bun run --filter @tempo/console dev`. In the editor:
1. Add a comment to some text. The card appears.
2. Click Delete. Confirm. The card disappears, the underlying text's highlight goes away, the DB row + its replies are gone (`select * from comments` in the SQLite DB shows the row removed).
3. Refresh the page. The deletion persisted.

- [ ] **Step 8: Commit**

```bash
git add apps/console/server/comments.ts apps/console/app/api/comments/\[id\]/route.ts apps/console/lib/api-client.ts apps/console/components/thread/editor/comment-thread-bridge.ts apps/console/components/thread/editor/plan-comment-card.tsx apps/console/hooks/use-thread-events.ts
git commit -m "comments: Dev can delete a comment · comment_deleted event handler

DELETE /api/comments/:id removes the comment and its replies in one tx and
appends comment_deleted. The bridge wires through BlockNote's deleteThread.
PlanCommentCard adds a destructive Delete button with confirm. use-thread-
events drops the comment from the cache on the SSE event."
```

---

## Task 7: Right-side comment gutter

**Files:**
- Create: `apps/console/components/thread/editor/plan-comment-gutter.tsx`
- Modify: `apps/console/components/thread/editor/plan-editor.tsx` (expose the editor + bridge to the gutter; render the gutter as a sibling)
- Modify: `apps/console/components/thread/thread-view.tsx` (grid gains a right column for the gutter)

**Design constraints (per judge's advisory):**
- ONE PM-doc walk per render that builds `Map<threadId, pos>` for every thread, then per-icon `coordsAtPos` derives `top`. Never one walk per thread.
- Recompute on (a) `editor.document` identity change (signal: every transaction), (b) `ResizeObserver` callback on the editor root.
- Verified APIs: `view.coordsAtPos(pos)` returns `{ left, right, top, bottom }` (prosemirror-view 1.41.8); the mark name is `comment`, attribute key `threadId` (@blocknote/core 0.51.4 `src/comments/mark.ts`).

- [ ] **Step 1: Add a handle from `plan-editor.tsx` that exposes the live editor and bridge**

The gutter needs the editor (to call `coordsAtPos`) and the bridge (to subscribe and drive `deleteThread` / focus). Extend `PlanEditorHandle` in `plan-editor.tsx` (top of file, around line 58):

```ts
export type PlanEditorHandle = {
  getPmJson: () => unknown;
  applyPmJson: (pmJson: unknown) => void;
  toMarkdown: () => Promise<string>;
  /** Underlying BlockNote editor. Used by the comment gutter to walk the
   * live PM doc, look up `comment` marks by threadId, and convert positions
   * to viewport coordinates. */
  editor: ReturnType<typeof useCreateBlockNote>;
  /** Bridge handle for the gutter — subscribe to thread changes, drive
   * deleteThread + resolve/unresolve from icon clicks. */
  bridge: CommentThreadBridge;
};
```

Update the `onReady?.` call (around line 145) to pass `editor` and `bridge`. Import `CommentThreadBridge` as a type if it isn't already.

- [ ] **Step 2: Write the gutter component**

Create `apps/console/components/thread/editor/plan-comment-gutter.tsx`:

```tsx
'use client';

// Right-side rail of comment icons, Notion-style. Subscribes to the bridge
// to get the current set of threads; on every editor transaction (and on
// ResizeObserver callbacks) walks the live PM doc ONCE to build
// Map<threadId, pos>, then derives one `top` per icon via coordsAtPos.
//
// Orphans (threads whose `comment` mark is no longer in the doc — anchor
// text deleted by Dev or Agent) appear in a labelled section at the bottom,
// in created_at order, mirroring Google Docs' "Original content deleted"
// pattern.
//
// Resolved threads are hidden by default; a checkbox toggles them on.

import type { ThreadData } from '@blocknote/core/comments';
import { CheckCircle2, MessageSquare, MessageSquareOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommentThreadBridge } from './comment-thread-bridge';
import type { PlanEditorHandle } from './plan-editor';

type LiveThread = {
  threadId: string;
  thread: ThreadData;
  top: number | null;
};

export function PlanCommentGutter({
  editorHandle,
  rootRef,
}: {
  editorHandle: PlanEditorHandle | null;
  rootRef: React.RefObject<HTMLElement | null>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [threads, setThreads] = useState<Map<string, ThreadData>>(new Map());
  const [positions, setPositions] = useState<Map<string, number | null>>(new Map());

  // Subscribe to the bridge for thread set changes.
  useEffect(() => {
    if (!editorHandle) return;
    setThreads(editorHandle.bridge.getThreads());
    return editorHandle.bridge.subscribe((m) => setThreads(new Map(m)));
  }, [editorHandle]);

  // Recompute positions on every editor transaction + ResizeObserver tick.
  // ONE doc-walk per recompute — see Map<threadId, pos> below.
  useEffect(() => {
    if (!editorHandle) return;
    const editor = editorHandle.editor;
    const recompute = () => {
      const positionsMap = walkPmDocForCommentMarks(editor);
      const next = new Map<string, number | null>();
      for (const [threadId] of threads) {
        const pos = positionsMap.get(threadId);
        if (pos === undefined) {
          next.set(threadId, null); // orphan
          continue;
        }
        try {
          const view = editor._tiptapEditor.view;
          const root = rootRef.current;
          const coords = view.coordsAtPos(pos);
          const top = root ? coords.top - root.getBoundingClientRect().top : coords.top;
          next.set(threadId, top);
        } catch {
          next.set(threadId, null);
        }
      }
      setPositions(next);
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    };

    // Editor transactions: subscribe via the Tiptap editor's update event.
    editor._tiptapEditor.on('update', schedule);
    editor._tiptapEditor.on('selectionUpdate', schedule);

    // Root resize (font load, mermaid render, window resize all flow through).
    let observer: ResizeObserver | null = null;
    if (rootRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(rootRef.current);
    }
    // Initial pass.
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      editor._tiptapEditor.off('update', schedule);
      editor._tiptapEditor.off('selectionUpdate', schedule);
      observer?.disconnect();
    };
  }, [editorHandle, threads, rootRef]);

  const { anchored, orphaned } = useMemo(() => {
    const a: LiveThread[] = [];
    const o: LiveThread[] = [];
    for (const [threadId, thread] of threads) {
      if (thread.resolved && !showResolved) continue;
      const top = positions.get(threadId) ?? null;
      const entry: LiveThread = { threadId, thread, top };
      if (top === null) o.push(entry);
      else a.push(entry);
    }
    a.sort((x, y) => (x.top ?? 0) - (y.top ?? 0));
    o.sort((x, y) => x.thread.createdAt.getTime() - y.thread.createdAt.getTime());
    return { anchored: a, orphaned: o };
  }, [threads, positions, showResolved]);

  return (
    <aside className="relative w-12 shrink-0 select-none">
      <div className="sticky top-[calc(3.5rem+1.5rem)] flex flex-col gap-2">
        <label className="flex items-center gap-1.5 text-caption text-ink-subtle px-1 cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          <span>Resolved</span>
        </label>

        <div className="relative h-[calc(100dvh-3.5rem-6rem)]">
          {anchored.map(({ threadId, thread, top }) => (
            <GutterIcon
              key={threadId}
              threadId={threadId}
              thread={thread}
              style={{ position: 'absolute', top: `${top ?? 0}px`, left: 0 }}
              editorHandle={editorHandle}
            />
          ))}
        </div>

        {orphaned.length === 0 ? null : (
          <div className="flex flex-col gap-1 pt-3 mt-3 border-t border-hairline">
            <span className="text-micro-uppercase uppercase font-semibold text-ink-tertiary px-1">
              Orphaned
            </span>
            {orphaned.map(({ threadId, thread }) => (
              <GutterIcon
                key={threadId}
                threadId={threadId}
                thread={thread}
                orphaned
                editorHandle={editorHandle}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function GutterIcon({
  threadId,
  thread,
  style,
  orphaned,
  editorHandle,
}: {
  threadId: string;
  thread: ThreadData;
  style?: React.CSSProperties;
  orphaned?: boolean;
  editorHandle: PlanEditorHandle | null;
}) {
  const onClick = () => {
    if (!editorHandle) return;
    // Anchored thread — focus the comment mark so BlockNote's
    // FloatingThreadController opens the card. The supported way is
    // selecting the mark range: find first matching position, set the
    // editor selection there, the controller renders next render.
    const editor = editorHandle.editor;
    if (!orphaned) {
      const pos = findFirstPositionForThread(editor, threadId);
      if (pos !== null) {
        editor._tiptapEditor.commands.setTextSelection(pos);
        editor._tiptapEditor.commands.focus();
      }
    }
    // Orphans have nowhere to scroll to — the click is a no-op visually
    // today. A future revision could open a centred modal of the card.
  };

  const Icon = orphaned ? MessageSquareOff : thread.resolved ? CheckCircle2 : MessageSquare;
  const titleParts = [thread.resolved ? 'Resolved' : 'Open', orphaned ? '(orphaned)' : null].filter(
    Boolean,
  );
  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      title={titleParts.join(' ')}
      className={`size-7 inline-flex items-center justify-center rounded-md hover:bg-surface-2 transition-colors text-ink-subtle hover:text-ink ${
        thread.resolved ? 'opacity-50' : ''
      } ${orphaned ? 'border border-dashed border-hairline' : ''}`}
    >
      <Icon className="size-icon-sm" aria-hidden />
    </button>
  );
}

// Single PM-doc walk — O(doc-size), not O(doc-size × threads). Returns the
// first matching position for every threadId found. Multi-block threads use
// the first match as their anchor (top of the highest block carrying the
// mark), which matches Notion's behaviour and the way `FloatingThread` already
// picks one position.
function walkPmDocForCommentMarks(
  editor: PlanEditorHandle['editor'],
): Map<string, number> {
  const out = new Map<string, number>();
  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment') continue;
      const threadId = mark.attrs.threadId as string | undefined;
      if (typeof threadId !== 'string' || threadId.length === 0) continue;
      if (!out.has(threadId)) out.set(threadId, pos);
    }
  });
  return out;
}

function findFirstPositionForThread(
  editor: PlanEditorHandle['editor'],
  threadId: string,
): number | null {
  let found: number | null = null;
  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name === 'comment' && mark.attrs.threadId === threadId) {
        found = pos;
        return false;
      }
    }
  });
  return found;
}
```

- [ ] **Step 3: Mount the gutter in `thread-view.tsx`**

The page already has a two-column grid (Discussion + main) controlled by `gridClass`. Add a third column for the gutter when a Plan is present. Update the `gridClass` and `gridStyle` near line 212:

```tsx
  // grid-cols: [discussion?] | main | gutter
  const planVisible = view.plan.body !== null;
  const gridClass = discussionOpen
    ? planVisible
      ? 'grid-cols-[var(--discussion-w)_1fr_auto]'
      : 'grid-cols-[var(--discussion-w)_1fr]'
    : planVisible
      ? 'grid-cols-[1fr_auto]'
      : 'grid-cols-1';
```

Inside the `<section>` rendering the editor (around line 279), capture a `rootRef` that wraps the editor's container, and render `<PlanCommentGutter>` as a sibling of `<section>` so it's a real column in the grid (not absolutely positioned inside the editor):

At the top of `ThreadView`, alongside the other refs:

```ts
  const editorRootRef = useRef<HTMLDivElement>(null);
```

Wrap the editor's container with `ref={editorRootRef}`. Add after the `<section>` and before `<ActivityWidget>`:

```tsx
        {planVisible && editorHandle ? (
          <PlanCommentGutter editorHandle={editorHandle} rootRef={editorRootRef} />
        ) : null}
```

Import `PlanCommentGutter` at the top of the file.

- [ ] **Step 4: Verify**

```
bun run typecheck && bun run lint
bun run --filter @tempo/console dev
```

Open a Thread with comments. Expected:
- Right rail shows one icon per non-resolved comment, vertically aligned with the block carrying the comment.
- Toggling "Resolved" shows resolved comments (with reduced opacity).
- Clicking an icon scrolls to and opens the comment card.
- Delete a comment via the card → its icon disappears from the rail.
- Edit the document so a comment's anchor text is removed → the icon moves to the "Orphaned" section.

- [ ] **Step 5: Commit**

```bash
git add apps/console/components/thread/editor/plan-editor.tsx apps/console/components/thread/editor/plan-comment-gutter.tsx apps/console/components/thread/thread-view.tsx
git commit -m "comments: right-side gutter with hide-resolved + orphan section

Notion-style rail of icons next to the editor. One shared PM-doc walk per
recompute builds Map<threadId, pos> for every thread; per-icon coordsAtPos
derives top. Resolved threads hidden behind a checkbox. Threads whose comment
mark is no longer in the doc (text deleted) appear in an Orphaned section so
they never become invisible."
```

---

## Task 8: File the deferred items under AGENTS.md → Spotted but not fixed

**File:** `AGENTS.md`

The spec deferred five items. File them now so they aren't lost.

- [ ] **Step 1: Append entries to `AGENTS.md` → "Spotted but not fixed"**

Open `AGENTS.md`, find the `### Spotted but not fixed` section (around line 163), and append at the end of the list:

```md
- **Duplicated `extractText` in two editor files.** `comment-thread-bridge.ts:221` and `plan-comment-card.tsx:215` carry near-identical `BlockLike` walkers that flatten BlockNote's CommentBody to a string. The two copies' `InlineLike` types differ slightly (one has `type?`, the other doesn't), so they're not structurally identical. Two callers does not justify a shared helper per "one adapter is hypothetical"; consolidate the day a third caller appears, or the next time both files are open in the same change. Filed 2026-06-07 with the plan-comments-redesign PR.
- **`CommentThreadBridge` double-fires subscribers after mutations.** Every `createThread` / `addComment` / `resolveThread` / `unresolveThread` / `deleteThread` call ends with `invalidate()` and `notify()`. TanStack Query's refetch then re-triggers `notify()` via the parent's `useEffect(() => bridge.emitChange(), [comments])`. Net: every mutation renders subscribers twice. Pre-existing; not caused by the plan-comments-redesign. Drop the in-bridge `notify()` call and rely on the post-refetch `emitChange` path the day the bridge is next touched. Filed 2026-06-07.
- **Mermaid DOM-injection effect colocated in `plan-editor.tsx`.** The 50-line `useEffect` that renders `pre > code.language-mermaid` into SVG siblings is a separate concern from the BlockNote wiring that owns the rest of the file. Extract to `use-mermaid-previews.ts` the next time `plan-editor.tsx` opens for a real reason. Filed 2026-06-07.
- **`unloadBeacon` HTTP call inlined in `thread-view.tsx`.** A `fetch(..., { keepalive: true })` lives inside the React component. Side effects don't hide in UI files per CLAUDE.md rule 19. Move to `apps/console/lib/unload-beacon.ts` the next time `thread-view.tsx` opens for a real reason. Filed 2026-06-07.
- **`comments.anchor_offset_hint` column is dead schema.** Defined in `apps/console/db/schema.ts:91`; never written, never read. Was a remnant from the pre-BlockNote anchor model. Dropping it is a destructive migration (drop a column); requires explicit Dev approval. Schedule for a follow-up PR that asks the question explicitly. Filed 2026-06-07.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "AGENTS: file spotted-but-not-fixed items deferred from comments redesign"
```

---

## Task 9: Code review pass

**Files:** none (review only)

CLAUDE.md mandates this for every meaningful unit of work. Both agents run in parallel; address findings inline.

- [ ] **Step 1: Run code-simplifier and code-reviewer in parallel**

Send a single message with two `Agent` tool calls:

- `code-simplifier:code-simplifier` — scope: every file touched by T1–T8 on this branch. Goal: find code that could be deleted, helpers that could be inlined, abstractions with one caller, layers that pass through without adding anything.
- `everything-claude-code:code-reviewer` — scope: same set. Goal: quality, security, maintainability against Tempo's binding conventions.

- [ ] **Step 2: Address findings**

For each finding, do one of:
- Fix inline (commit per fix or rolled into the surrounding task)
- Justify with a one-line comment in the code
- File under AGENTS.md → "Spotted but not fixed" with a brief rationale

- [ ] **Step 3: Final smoke test**

```
bun run typecheck && bun run lint && bun run build
```

Then `bun run --filter @tempo/console dev`. Walk through the full user journey:
1. Open a Thread with an existing Plan.
2. Add a comment to Section 2. Card appears, rail icon appears.
3. Connect Agent CLI. Ask Agent to remove Section 4.
4. After Agent's write: Section 2's comment is still visible inline AND in the rail.
5. Resolve a comment. It disappears from the rail. Toggle "Resolved". It reappears with struck-through icon.
6. Unresolve. Back to normal.
7. Edit the Plan to delete the anchored text of a different comment. Its icon moves to the Orphaned section.
8. Open an orphan icon's card via the rail — wait, the design says orphans don't scroll-to. Confirm the click is a no-op visually (the card is reachable from elsewhere — TBD if we add the orphan modal later).
9. Delete a comment via the card. Confirm dialog → delete. Card and rail icon vanish. Refresh — still gone.

- [ ] **Step 4: Update spec → plan trace if anything changed**

If the review surfaced a structural change to the implementation, edit the spec at `docs/superpowers/specs/2026-06-07-plan-comments-redesign-design.md` to keep the documentation honest. Otherwise: nothing to do.

- [ ] **Step 5: Final commit (if any inline fixes landed)**

```bash
git add -A
git commit -m "review: address code-simplifier / code-reviewer findings"
```

If no fixes landed, no commit. Done.

---

## Done state

- Comment marks survive every Agent write (the bug is fixed).
- The encode/decode/reconcile/server-editor pipeline is gone.
- The Plan editor has a right-side rail of comment icons with hide-resolved + Orphaned section.
- The Dev can delete a comment (Agent cannot).
- Deferred cleanups are filed in `AGENTS.md`.
- code-simplifier + code-reviewer ran clean (or findings were addressed).
