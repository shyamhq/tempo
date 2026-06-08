# Plan — Agent Plan-wire cost (per-block HTML CRUD)

**Spec:** `docs/superpowers/specs/2026-06-07-agent-plan-wire-cost-design.md` — APPROVED.
**Date:** 2026-06-07
**Execution model:** Dispatch each task as a Sonnet subagent. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` (both Sonnet) before each commit.

The order below is the dependency order. Tasks 1, 2, and 3 can run in parallel (no cross-imports between them). Then Tasks 4 and 5 (both depend on 1; 4 also depends on 3). Then Tasks 6 and 7 (depend on 1 + 5 and 1 + 4 respectively). See §"Subagent dispatch suggestion" at the bottom for the canonical wave plan.

---

## Task 1 — Update contracts

**Files:**
- `packages/contracts/src/primitives.ts` (modify)
- `packages/contracts/src/mcp.ts` (modify)
- `packages/contracts/src/http.ts` (do NOT modify — verify untouched)

**Changes:**

1. In `primitives.ts`:
   - Add `AgentBlock = z.object({ id: z.string(), html: z.string() })`.
   - Add `AgentPlanBlocks = z.object({ blocks: z.array(AgentBlock) })`. **No `cursor` field for MVP** (spec §Uncertainties #3 defers it).
   - Replace `AgentPlanState`. Today (lines 70-73): `{ status: ThreadStatus, body: AgentPlanBody.nullable() }`. New: `z.object({ status: ThreadStatus, updated_at: z.string().nullable(), updated_by: Actor.nullable() })`. Use the existing symbol names `ThreadStatus` (line 30) and `Actor` (line 32) — there is no `PlanStatus` or `PlanActor` in this file. The `body` wrapper goes away; `updated_at` and `updated_by` become top-level nullable fields.
   - Delete `AgentPlanBody`. Verify with `grep -r AgentPlanBody packages/ apps/` first — it should be unreferenced after this change. If any consumer remains, fix it in the file the consumer lives in (track under the task that owns that file).

2. In `mcp.ts`:
   - Update `PullPlanOutput` to wrap `AgentPlanBlocks` (not `pm_json`).
   - Remove `WritePlanInput` and `WritePlanOutput`.
   - Update the `McpTool` enum (`mcp.ts:90-98`): remove `'tempo_write_plan'`; add `'tempo_update_block'`, `'tempo_add_blocks'`, `'tempo_delete_block'` (keep `'tempo_pull_plan'`).
   - Do **not** add a `block_not_found` variant to `McpErrorCode` (mcp.ts:101-109). The route handlers map `BlockNotFoundError` to HTTP 404; the Agent-side error parser falls through to the generic envelope. This is intentional — keeps the enum small for MVP. Documented in §Uncertainties of this plan.
   - Add three new input/output pairs:
     - `UpdateBlockInput = z.object({ block_id: z.string(), html: z.string() })`, `UpdateBlockOutput = z.object({ ok: z.literal(true) })`.
     - `AddBlocksInput = z.object({ reference_id: z.string().nullable(), position: z.enum(["before", "after", "end"]), blocks: z.array(z.string()).min(1) })`, `AddBlocksOutput = z.object({ ok: z.literal(true), ids: z.array(z.string()) })`.
     - `DeleteBlockInput = z.object({ block_id: z.string() })`, `DeleteBlockOutput = z.object({ ok: z.literal(true) })`.
   - Do not add a `warnings` field — spec §Uncertainties #6 commits to no in-band warning channel for MVP.

3. In `http.ts`: do not touch. `WritePlanRequest` and `WritePlanResponse` stay as today.

**Verification:**
- `bun run typecheck` from the repo root. Type errors in `apps/console`, `apps/agent`, etc. are expected at this point — they're the downstream signal that later tasks need to handle. Note them but don't fix here.

**Layer placement:** Contracts only. No DB, no business logic.

---

## Task 2 — Add `@blocknote/server-util` dependency

**File:** `apps/console/package.json` (modify via Bun).

**Changes:**
- Run `bun add -F @tempo/console @blocknote/server-util@0.51.4` from the repo root. The version must match the existing `@blocknote/core` version (currently `0.51.4`).
- After install, verify `apps/console/next.config.ts:13` already contains `'@blocknote/server-util'` in `serverExternalPackages`. Do not duplicate. Add `'jsdom'` to the same array if it is not already listed.

**Verification:**
- `bun install` runs clean.
- `cat apps/console/next.config.ts` shows both `@blocknote/server-util` and `jsdom` in `serverExternalPackages`.

---

## Task 3 — Server-side conversion module

**File:** `apps/console/server/plan/block-html.ts` (new).

**Changes:**

1. Create the directory `apps/console/server/plan/` if it does not exist.

2. New file `block-html.ts` exporting two async functions:

```ts
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import type { PartialBlock } from '@blocknote/core';
import { planSchema } from '@/lib/plan-schema';

export async function blockToHtml(block: PartialBlock<typeof planSchema.blockSchema>): Promise<string> {
  const editor = ServerBlockNoteEditor.create({ schema: planSchema });
  return editor.blocksToHTMLLossy([block]);
}

export async function htmlToBlock(html: string): Promise<PartialBlock<typeof planSchema.blockSchema>> {
  const editor = ServerBlockNoteEditor.create({ schema: planSchema });
  const blocks = await editor.tryParseHTMLToBlocks(html);
  // Spec §Plan step 3 + uncertainty #6: if the parser produces zero blocks for a non-empty input,
  // return an empty paragraph block so the document stays valid. The Agent will see the
  // degraded state on the next pull and self-correct.
  if (blocks.length === 0) {
    return { type: 'paragraph', content: [] };
  }
  // Multiple blocks from one HTML string: take the first. The Agent emits one HTML per
  // tempo_update_block call; if it accidentally emits multiple blocks, we keep only the first.
  return blocks[0];
}
```

3. **Do not** add a module-level `ServerBlockNoteEditor` singleton in MVP. Per-call construction is documented in the spec as acceptable (~10-50ms); if profiling later shows otherwise, a singleton with reset-between-uses is the documented escape hatch.

**Verification:**
- `bun run typecheck --filter @tempo/console` — passes for this file.
- The exact import path for `planSchema` matches the existing schema export. Verify by reading `apps/console/lib/plan-schema.ts` first.

**Layer placement:** `server/<domain>/` utility. Isolates jsdom + BlockNote setup. No DB, no HTTP. Deletion test: if removed, every plan-ops orchestrator (4 places) would inline the same setup — strictly worse. The module pays for itself.

---

## Task 4 — Extend `apps/console/server/plan.ts` with block-level orchestrators

**Files:**
- `apps/console/server/plan.ts` (modify)
- `apps/console/app/api/sessions/[id]/state/route.ts` (modify — drop Plan body from attach)

**Depends on:** Tasks 1, 2, 3.

**Changes to `plan.ts`:**

1. Import `blockToHtml`, `htmlToBlock` from `./plan/block-html`.

2. Add `async function getPlanBlocks(threadId: string): Promise<AgentPlanBlocks>`:
   - Read the PM JSON via the existing `readPlanRow(threadId)` (do not duplicate the DB call).
   - For each top-level block in the PM JSON, find its `attrs.id`. BlockNote's stored shape guarantees every `blockContainer` carries one — but if a block is found without `attrs.id` (corrupted import, partial migration, etc.), **log via Pino and skip the block** rather than failing the whole call. The Dev sees a missing block in the gutter and can repair manually.
   - Convert each block to HTML via `blockToHtml`. Return `{ blocks: [{ id, html }, ...] }`.
   - Suffix each `id` with `$` on output. The spec §"MCP surface" calls for this so the model treats IDs as opaque tokens.

3. Add `async function updateBlock(threadId: string, blockId: string, html: string, actor: Actor): Promise<void>`:
   - Strip the `$` suffix from `blockId` first. If the stripped ID does not match any `blockContainer.attrs.id` in the stored doc, throw `BlockNotFoundError` (new — define alongside the existing `ThreadNotFoundError` and `InvalidPlanBodyError` error classes in `plan.ts`).
   - Read PM JSON, convert the incoming HTML to a `PartialBlock` via `htmlToBlock`, splice the new block in (preserving the existing `attrs.id`), write PM JSON back.
   - Append `plan_edited_by_agent` event the same way `writePlan` does today.

4. Add `async function addBlocks(threadId: string, referenceId: string | null, position: 'before' | 'after' | 'end', htmlBlocks: string[], actor: Actor): Promise<{ ids: string[] }>`:
   - For each HTML string, run `htmlToBlock`; collect resulting `PartialBlock`s.
   - Locate the reference block (or treat `null` + `position: "end"` as "append to doc end" / `null` + `position: "before"` as "prepend"). If `referenceId` is non-null but not found, throw `BlockNotFoundError`.
   - Assign fresh UUIDs to each new block's `attrs.id`. Splice into the PM JSON at the requested position.
   - Append `plan_edited_by_agent` event. Return `{ ids: [...] }` (new block IDs, `$`-suffixed).

5. Add `async function deleteBlock(threadId: string, blockId: string, actor: Actor): Promise<void>`:
   - Strip `$` suffix. Remove the block with matching `attrs.id` from the PM JSON. Throw `BlockNotFoundError` if absent.
   - If the resulting document has zero blocks, insert a single empty paragraph (the editor requires a non-empty doc).
   - Append `plan_edited_by_agent` event.

6. Adjust `getPlan` (the Dev path). Today it returns `Plan` with `pm_json`. **Unchanged.** No edits.

7. Verify `writePlan` (the Dev path) is unchanged. No edits.

**Changes to `app/api/sessions/[id]/state/route.ts`:**

- Today's route calls `getPlan(thread.id)` (lines 16-29) which returns `{ status, updated_at, updated_by, pm_json }`. That return shape exceeds what the new `AgentPlanState` needs.
- Add a new small accessor in `apps/console/server/plan.ts` named `getPlanState(threadId): Promise<AgentPlanState>` that reads via the existing `readPlanRow(threadId)` helper and returns only `{ status, updated_at, updated_by }` — no `pm_json` parse, no body conversion. The status/updated_at/updated_by come from `readPlanRow`'s join (see `apps/console/server/plan.ts:9-28` for the existing pattern).
- In the attach route, replace the `getPlan(thread.id)` call with `getPlanState(thread.id)`. The shape now exactly matches the new `AgentPlanState`.
- Do **not** read `thread.plan_status` / `thread.plan_updated_at` etc. directly — those columns live on the `plans` table, not `threads`. Go through `readPlanRow`.

**Verification:**
- `bun run typecheck --filter @tempo/console` passes.
- Open `apps/console/server/plan.ts` and re-read end-to-end. All four new orchestrators read PM JSON, mutate, write back — they do not bypass `writePmJson` or whatever the existing helper is called.

**Layer placement:** Business logic in `server/<domain>/`. Existing module, growing four functions. The attach-route edit is route-handler thin (Zod-out, no business logic).

---

## Task 5 — Update Agent HTTP client

**File:** `apps/agent/src/http-client.ts` (modify).

**Depends on:** Task 1 (contracts).

**Changes:**

- Replace `getPlan(threadId)` and `writePlan(threadId, pm_json)` with:
  - `getPlanBlocks(threadId): Promise<AgentPlanBlocks>` — GET `/api/threads/:id/plan/blocks`.
  - `updateBlock(threadId, blockId, html): Promise<void>` — PUT `/api/threads/:id/plan/blocks/:blockId` with `{ html }`.
  - `addBlocks(threadId, referenceId, position, blocks): Promise<{ ids: string[] }>` — POST `/api/threads/:id/plan/blocks` with `{ reference_id, position, blocks }`.
  - `deleteBlock(threadId, blockId): Promise<void>` — DELETE `/api/threads/:id/plan/blocks/:blockId`.

- No explicit Agent-side reader of `AttachOutput.plan.body.pm_json` exists today — `apps/agent/src/mcp-server.ts:37` fetches `AttachState` and passes it straight to `wrapWithImages(state, images)` (line 39), which serialises the whole thing to the LLM. So the type change in Task 1 (flat `AgentPlanState`) propagates without any explicit field-access edit on the Agent side; the implementer should still run `bun run typecheck --filter tempo-agent` to confirm no hidden access broke.

**Verification:**
- `bun run typecheck --filter tempo-agent` passes.

---

## Task 6 — Update the MCP tool definitions

**File:** `apps/agent/src/mcp-server.ts` (modify).

**Depends on:** Tasks 1, 5.

**Changes:**

1. Replace `tempo_pull_plan` and `tempo_write_plan` (lines 44-61 today) with four new tools. Use short prose-shaped descriptions — no `marks` array gymnastics:

```ts
tempo_pull_plan: {
  description:
    "Read the current Plan as a flat list of blocks. Each block has an opaque id (ending in `$`) and an HTML content string. " +
    "Use this when you want to inspect the Plan or before any edit.",
  // input: empty
  // output: { blocks: AgentBlock[] }
}

tempo_update_block: {
  description:
    "Replace one block's content. Provide the block id from tempo_pull_plan and the new HTML. " +
    "The editor preserves Comments anchored to blocks you do not touch; Comments anchored to text inside this block may surface in the Dev's Orphaned list — that is expected.",
  // input: UpdateBlockInput
  // output: UpdateBlockOutput
}

tempo_add_blocks: {
  description:
    "Insert one or more new blocks. `reference_id` is the id of an existing block (or null + position:'end' to append). " +
    "`position` is 'before', 'after', or 'end'. `blocks` is an array of HTML strings, one per new block.",
  // input: AddBlocksInput
  // output: AddBlocksOutput
}

tempo_delete_block: {
  description:
    "Remove one block by id.",
  // input: DeleteBlockInput
  // output: DeleteBlockOutput
}
```

2. The `tempo_attach` tool's `plan` field in its output stays — but now references the flat `AgentPlanState`. Verify it serialises clean.

**Verification:**
- `bun run typecheck --filter tempo-agent` passes.
- Read `apps/agent/src/mcp-server.ts` end-to-end after edits. The four new descriptions are short, prose-shaped, and contain no "preserve every marks array" instruction.

---

## Task 7 — New Console routes

**Files (new):**
- `apps/console/app/api/threads/[id]/plan/blocks/route.ts`
- `apps/console/app/api/threads/[id]/plan/blocks/[blockId]/route.ts`

**Depends on:** Tasks 1, 4.

**Changes:**

1. `blocks/route.ts`:
   - `GET` → call `getPlanBlocks(id)`. Return `AgentPlanBlocks`.
   - `POST` → Zod-parse `AddBlocksInput`, call `addBlocks(...)`. Return `AddBlocksOutput`.
   - Both behind the existing Agent auth helper (whatever `plan/route.ts` uses today).

2. `blocks/[blockId]/route.ts`:
   - `PUT` → Zod-parse `{ html }` from `UpdateBlockInput` (block_id comes from the URL), call `updateBlock(...)`. Return `UpdateBlockOutput`.
   - `DELETE` → call `deleteBlock(id, blockId, actor)`. Return `DeleteBlockOutput`.
   - On `BlockNotFoundError`, return 404 with the existing error envelope shape.

3. Both route files are thin: parse → call server module → format response. Match the style of `apps/console/app/api/comments/[id]/route.ts`.

**Verification:**
- `bun run typecheck --filter @tempo/console` passes.
- Hit each endpoint with `curl` against `bun run dev` with a valid Agent token. Expect 200 + the expected JSON for happy paths, 404 for `BlockNotFoundError`, 400 for Zod errors.

**Layer placement:** Route handlers, thin. Deletion test: combining all of these into one route file with action-string dispatch would break Next.js App Router convention and force ad-hoc routing in each handler — strictly worse. The split pays for itself.

---

## Task 8 — Pre-commit review per task

For each commit (Tasks 1+2 can be one commit, 3, 4, 5, 6, 7 each separately if you prefer small commits; or bundle the whole change as one commit at the end — Dev's call):

1. Run `code-simplifier:code-simplifier` agent (Sonnet) on the staged diff.
2. Run `everything-claude-code:code-reviewer` agent (Sonnet) on the staged diff.
3. Address findings or file them under `AGENTS.md` "Spotted but not fixed" with a one-line reason.
4. Commit.

These are launched in parallel — one message, two `Agent` tool calls.

---

## Task 9 — Manual verification

After all code lands and `bun run typecheck` is green:

1. Start `bun run dev`.
2. Open a Thread in the Console, attach a couple of anchored Comments to specific paragraphs in the Plan.
3. Run `tempo-agent connect <token>` (or whatever the local invocation is).
4. Ask the Agent to: (a) rewrite one paragraph that has a Comment on it, (b) rewrite one paragraph that does not.
5. Confirm:
   - The Agent completes in one turn, no Python / jq output.
   - The un-commented edit lands without disturbing other Comments.
   - The Comment on the rewritten paragraph appears in the gutter's Orphaned section.
   - Pino logs show the four new MCP tool calls (no `tempo_pull_plan` returning 50 KB, no `tempo_write_plan`).
6. Measure: rough wall-clock for one edit cycle. Spec target is "feels fast" (subjective — Dev judgment).
7. Sample one `htmlToBlock` call's wall-clock from Pino logs (add a temporary log if needed) to verify the ~10-50ms jsdom-instantiation ballpark. Remove the temporary log before final commit.

---

## Uncertainties (carried forward from spec or new in plan)

1. **`AgentPlanBlocks` has no `cursor` field for MVP.** Spec §Uncertainties #3 defers cursor semantics. Implementer should not add it speculatively.
2. **Every `blockContainer` is assumed to have `attrs.id`.** xl-ai's design rests on this; our stored PM JSON is produced by the same editor and should match. The fallback (log + skip) in `getPlanBlocks` (Task 4) is defensive only — if it ever fires in real use, treat as a data bug.
3. **`McpErrorCode` is not extended.** A 404 on `BlockNotFoundError` falls through to the generic Agent-side error envelope. If real-world use shows the Agent needs to distinguish "block missing" from "internal error" to self-correct, add the enum value in a follow-up — additive contract change.
4. **Per-call jsdom construction cost (~10-50ms).** Acceptable for Plan edits; documented escape hatch is a module-level singleton. Task 9 includes a one-shot measurement to confirm the ballpark.

## Deletion notes

- `AgentPlanBody` (today in `primitives.ts`) becomes unused after Task 1. Delete it in Task 1.
- The current MCP tool descriptions' "KEEP THE `marks` ARRAY EXACTLY AS YOU FOUND IT" instruction goes away (Task 6) — that's the structural cure to the script-writing behaviour.
- No DB migration, no column changes, no destructive operations.

## Spotted-but-not-fixed candidates

- The `anchor_offset_hint` column on the comments table is noted as dead in `AGENTS.md`. This plan does not touch it.
- The Console `/api/threads/[id]/plan` Dev POST still takes the entire PM JSON. That's outside this spec's scope (still works fine for the Dev's editor save flow).

## Subagent dispatch suggestion

- Tasks 1, 2, 3 can be dispatched in parallel (independent files, no cross-imports). Tasks 4, 5 then run in parallel (they import from 1+3 and 1, respectively). Tasks 6, 7 then run in parallel (import from 1, 4, 5). Task 8 runs per commit. Task 9 is the Dev's manual check.

Each subagent should be Sonnet. Tell each subagent: "Read the spec and this plan first. Implement only your numbered task. Do not touch files outside its file list. If you discover a file outside the list that must change, stop and report."
