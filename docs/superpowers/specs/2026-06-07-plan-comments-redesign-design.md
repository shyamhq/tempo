# Plan — Make comments survive Agent rewrites, add a right-side gutter, allow delete

## Problem

Three problems in one file family:

1. **Comments silently disappear when the Agent writes the Plan.** The root cause is `apps/console/server/plan.ts:172–186` (`stripCommentMarks`) and the surrounding pipeline. `writePlanFromAgent` reads the previous PM JSON, deletes every `comment` mark via `stripCommentMarks`, converts the comment-free PM JSON to blocks, sends through the Markdown encoder, accepts the Agent's annotated Markdown, decodes back to blocks, then re-emits PM JSON via `serverPlanEditor._blocksToProsemirrorNode`. The server's `ServerBlockNoteEditor` is built from `planSchema` only (`apps/console/server/plan/server-editor.ts`) — no `CommentsExtension`, no `comment` mark in its schema — so the re-emitted PM JSON cannot carry comment marks. The DB is overwritten with a mark-free document on every Agent write. The next SSE ping triggers `applyPmJson` → `setContent(pmJson)` on the client, which replaces the live editor with the mark-free version. Every Section 2 comment dies because Section 4 was edited; every comment dies on every Agent write. BlockNote's docs corroborate: the `comment` mark is declared with `blocknoteIgnore: true`, so the Markdown round-trip strips it by design. The fix is to stop routing the Agent's edits through Markdown.

2. **The architecture around the bug is overengineered.** A four-file pipeline (`encode.ts`, `decode.ts`, `reconcile-ids.ts`, `server-editor.ts`) exists to translate between the at-rest PM JSON format and the Agent's Markdown wire format. The pipeline's stated job is to preserve "opaque" inline styles across the round-trip via inline `<x-mark>` sentinels — but `commentThread` in `RESTORABLE_STYLE_KEYS` is dead code (comment marks are stripped before this code runs), `reconcileIds` has one caller, and `server-editor.ts` is a one-line module. Delete the wire format, delete the pipeline.

3. **Comments can be invisible even when not orphaned.** Tempo today renders comments only inline (via `FloatingThreadController`). A thread with a small anchor in a long Plan is hard to find; a thread whose anchor genuinely vanished (Dev or Agent deleted the underlying text) has no fallback surface. Notion solves both with a right-side comment rail. We want the same: every open thread shows as an icon in a right rail, positioned next to its anchor block, falling back to an "Orphaned" section when the anchor is gone. Resolved threads are hidden behind a toggle. Threads can also be deleted (a real destructive action the Dev needs).

## The smallest concrete change

One coordinated change. Three parts.

### Part 1 — Switch the MCP wire format from Markdown to PM JSON

The Agent reads and writes the Plan as the same shape the DB stores: a ProseMirror document JSON object (Tempo's `Plan.body.pm_json`). The Agent receives the full document including `comment` marks; the tool description tells it that `marks` arrays carry inline annotations and must be preserved verbatim on any text run the Agent does not intend to change. Comments survive untouched edits trivially: the Agent sees them, leaves them, sends them back.

- `packages/contracts/src/mcp.ts` — `PullPlanOutput` returns `pm_json: unknown` (the same shape as the on-the-wire HTTP response from `GET /api/threads/:id/plan`). `WritePlanInput` takes `pm_json: unknown`. The `markdown` field is gone from both. `AgentPlanState` in `packages/contracts/src/primitives.ts` switches its body discriminator from `markdown` to `pm_json`.
- `apps/agent/src/mcp-server.ts` — tool descriptions for `tempo_pull_plan` / `tempo_write_plan` revised. The body of the change is the tool description's guidance: "Preserve every `marks` array on text runs you are not rewriting. Marks carry the Dev's anchored comments; if you drop them, the comments orphan."
- `apps/agent/src/http-client.ts` — `pullPlan` / `writePlan` swap from string-body to JSON-body shapes.
- `apps/console/server/plan.ts` — `getPlanForAgent` returns the stored PM JSON verbatim. `writePlanFromAgent(threadId, pmJson)` calls `writePlan(threadId, pmJson, 'agent')` after validating it is a non-null object (existing guard).

### Part 2 — Delete the encode/decode/reconcile/server-editor pipeline

- Delete `apps/console/server/plan/encode.ts`, `decode.ts`, `reconcile-ids.ts`, `server-editor.ts`.
- Delete `stripCommentMarks` from `apps/console/server/plan.ts` (no longer called).
- Delete `RESTORABLE_STYLE_KEYS.commentThread` (the file containing it is gone, this is a tail consequence).
- Remove `@blocknote/server-util` from `apps/console/package.json`. No server code constructs a BlockNote editor anymore.

### Part 3 — Right-side comment gutter

A new component `apps/console/components/thread/editor/plan-comment-gutter.tsx` rendered as a sibling of `BlockNoteView` inside the Plan area. The gutter:

- Subscribes to the `CommentThreadBridge` (`bridge.subscribe(cb)`) to get the current `Map<commentId, ThreadData>`.
- On every editor transaction (`useEffect` keyed on `editor.document`) and on every `ResizeObserver` callback for the editor root, recomputes one anchor record per non-resolved thread: `{ commentId, top: number | null }`. `top` is derived by walking the live PM doc for the first text node carrying a `comment` mark with the matching `threadId` and calling `editor._tiptapEditor.view.coordsAtPos(pos)`; `null` means orphan (no matching mark anywhere in the doc).
- Renders one icon per thread, absolutely positioned at `top` in a fixed-width right rail. Orphans go in a labelled `── Orphaned ──` section at the bottom of the rail, in `created_at` order.
- A small "Show resolved" checkbox at the top of the rail. When checked, resolved threads appear with a struck-through icon, mixed back into the same positional/orphan logic. Default off.
- Clicking an icon focuses the corresponding floating thread card (the existing `FloatingThreadController` path). For orphans, clicking opens the card as a centred modal-like overlay (no editor anchor exists).

The rail is the only place in the UI that knows how to enumerate threads' DOM positions; `FloatingThreadController` still handles per-anchor cards. No second source of truth.

### Part 4 — Delete a comment

A new endpoint and bridge method. The Agent does not get a delete tool; only the Dev (via the gutter or the open thread card) can delete.

- `DELETE /api/comments/:id` — added as `export async function DELETE` to the existing route file at `apps/console/app/api/comments/[id]/route.ts` (creating it if absent) per Next.js App Router HTTP-verb handler convention, matching the noun-not-verb path style of the surrounding routes (`/resolve`, `/unresolve`, `/replies` are sub-resources, not verbs in the parent path; the destructive action uses the HTTP method itself). Hard-deletes the comment row; replies and attachments cascade via the existing schema cascade (or, where absent, the same explicit delete tx pattern `deleteThread` uses in `apps/console/server/threads.ts`). Emits new event `comment_deleted` `{ comment_id }`.
- `apps/console/server/comments.ts` — `deleteComment(commentId): Promise<void>`. Reads the thread_id (for the event), runs `db.delete(comments).where(eq(comments.id, commentId))` (with replies + attachments delete in the same transaction to match the project's manual-cascade convention — see AGENTS.md "Spotted but not fixed" on SQLite foreign keys), appends `comment_deleted`.
- `packages/contracts/src/events.ts` — add `comment_deleted` `{ kind: 'comment_deleted', comment_id: CommentId }` to the discriminated union and to the kinds enum.
- `apps/console/lib/api-client.ts` — `deleteComment(id)` issues `fetch(\`/api/comments/${id}\`, { method: 'DELETE' })`.
- `apps/console/components/thread/editor/comment-thread-bridge.ts` — implement `deleteThread({ threadId })` (BlockNote's name maps to Tempo's "delete the comment"). Replace the `throw new Error('deleteThread is not supported')` with a real call to `api.deleteComment(threadId)`, then `invalidate()` + `notify()`. `deleteComment({ threadId, commentId })` (single-reply delete) keeps the throw — Tempo doesn't model individual reply deletion in this phase.
- Add a "Delete thread" action to `PlanCommentCard` (existing file) and to the gutter icon's hover/context menu. Confirm dialog: "Delete this comment and all replies? This cannot be undone."

When a comment is deleted, the `comment` mark referencing its id becomes an orphan on next render (BlockNote's `updateMarksFromThreads` sets `orphan: true`). The next Dev edit can naturally strip it; we don't actively scrub marks server-side.

### Part 5 — Cleanup forced by Parts 1–4

Only the cleanup items that Parts 1–4 *cause* are in this PR. The other items the audit surfaced are unrelated drive-by cleanups; per CLAUDE.md ("Don't touch unrelated code") they belong under AGENTS.md → "Spotted but not fixed" instead.

| # | Where | Action | Why this PR |
|---|---|---|---|
| 1 | `RESTORABLE_STYLE_KEYS` | Deleted with `encode.ts`. | Part 2 deletes the file. |
| 2 | `plan.ts` mixing DB reads with business rules | `readPlanRow` and `parsePmJson` move to `apps/console/server/db-queries/plans.ts`. `plan.ts` keeps only orchestration. | Part 1 changes every caller of `readPlanRow`. Per CLAUDE.md rule 19, when these functions are touched they must be in the correct layer. |

**Items deferred to AGENTS.md → "Spotted but not fixed"** (filed in the same commit that lands this PR):

- Duplicated `extractText` in `comment-thread-bridge.ts` and `plan-comment-card.tsx`. The two copies differ in their `BlockLike` typing; not structurally identical. Two callers does not justify a shared helper.
- Bridge `notify` + `invalidate` double-fire after mutations. Pre-existing quirk; not caused by any change here.
- Mermaid DOM effect colocated in `plan-editor.tsx`. The file is touched only to mount the gutter; the mermaid concern was here before this PR and stays.
- `unloadBeacon` HTTP call inlined in `thread-view.tsx`. `thread-view.tsx` is touched only to wire the gutter; the beacon was here before this PR.
- `comments.anchor_offset_hint` column. Dead schema (audit confirmed). **Deferred from this PR's scope** — dropping a column requires explicit Dev acknowledgment per AGENTS.md rule 24 and the Dev's "rest is ok go ahead" approval in this session did not enumerate the migration. Filed for a follow-up PR that asks the destructive question explicitly.

### What gets deleted (deletion test)

- `apps/console/server/plan/encode.ts`, `decode.ts`, `reconcile-ids.ts`, `server-editor.ts` — the entire Markdown pipeline. If we kept these files and only changed the wire, every Agent write would still strip comment marks. They are inseparable from the bug.
- `apps/console/server/plan.ts` `stripCommentMarks` — workaround whose only purpose was to placate the now-deleted `_prosemirrorJSONToBlocks`.
- `@blocknote/server-util` from `package.json` — no server-side BlockNote instance exists anymore.

For each new module added: if we deleted it in six months, would its complexity reappear elsewhere?

- `plan-comment-gutter.tsx` — yes, the gutter is the user-visible artifact; it cannot be inlined into the editor without recreating the same coordinate-measurement loop in two places.
- `db-queries/plans.ts` — required by CLAUDE.md rule 19. Not optional. The DB query functions exist regardless; this is a layer move.

### Where the new code lives (layer placement)

| File | Layer | Responsibility |
|---|---|---|
| `apps/console/server/db-queries/plans.ts` | server/db | Drizzle reads/writes for the `plans` table: `readPlanRow`, `updatePlanBody`, `parsePmJson`. |
| `apps/console/server/plan.ts` | server | Thin orchestration: `getPlan`, `writePlan`, `getPlanForAgent`, `writePlanFromAgent`, `requestPlanRecheck`. Calls into db-queries and event-log. |
| `apps/console/server/comments.ts` | server | Adds `deleteComment(commentId)`. |
| `apps/console/app/api/comments/[id]/route.ts` | route | Adds `export async function DELETE` next to any existing handlers in the file; thin: validate id, call `deleteComment`, return `{ ok: true }`. |
| `apps/console/components/thread/editor/plan-comment-gutter.tsx` | UI | Right-side rail of comment icons; reads from the bridge, measures DOM, renders absolute-positioned icons. |
| `packages/contracts/src/mcp.ts` | contracts | `PullPlanOutput` / `WritePlanInput` switch to `pm_json`. |
| `packages/contracts/src/primitives.ts` | contracts | `AgentPlanState.body` discriminator switches from `markdown` to `pm_json`. |
| `packages/contracts/src/events.ts` | contracts | Add `comment_deleted` event kind. |

### Implementation order

Each step ends at a working state.

1. Contracts change: `PullPlan*`, `WritePlan*`, `AgentPlanState`, `comment_deleted` event. Build will fail until consumers update — that's the point; one change pulled through.
2. Layer move: `readPlanRow` and `parsePmJson` move from `server/plan.ts` to `server/db-queries/plans.ts`. Pure refactor at this point — no behaviour change yet.
3. `server/plan.ts` switches `getPlanForAgent` / `writePlanFromAgent` to PM JSON. `stripCommentMarks` and the pipeline imports go. Console GET/POST untouched (already PM JSON native).
4. `apps/agent/src/mcp-server.ts` + `http-client.ts` updated to the new MCP shapes and tool descriptions.
5. Delete `server/plan/{encode,decode,reconcile-ids,server-editor}.ts`. Drop `@blocknote/server-util`.
6. Delete comment: `comments.deleteComment`, `DELETE` handler on `/api/comments/[id]/route.ts`, contract event, api-client, bridge `deleteThread`, card action.
7. Gutter: `plan-comment-gutter.tsx`, wire into `plan-editor.tsx`. Resolved checkbox. Orphan section.
8. File deferred items under AGENTS.md "Spotted but not fixed" (the five entries listed in Part 5).
9. Run `code-simplifier` and `code-reviewer` per AGENTS.md §21–22.

## Alternatives considered

### A. Per-block MCP operations (`tempo_update_block`, `tempo_insert_blocks_after`, `tempo_delete_blocks`)

The Agent reads the blocks tree, then issues per-block edits. Untouched blocks don't appear in any request, so their marks are physically preserved.

Tradeoffs:
- Best preservation of unedited blocks — they aren't in the wire payload at all.
- Worst preservation on edited blocks: the Agent emits a whole new `content` array, and the comment mark must be re-stamped by hand. If the Agent rewrites the paragraph that holds a comment, the comment orphans even though the Agent could have preserved its anchor by understanding the mark.
- Three MCP tools instead of two. Partial-success failure modes when the Agent issues a sequence and a later op fails on a stale id.
- Larger Agent prompt change. The current single-tool model maps to "read; edit; write"; this maps to "read; emit a script of ops."

Rejected because the failure mode (silent style loss on edited blocks) is exactly the problem we're trying to remove, and because the multi-op protocol's failure modes are harder to recover from than a single document write.

### B. Keep the Markdown wire, but only round-trip the edited regions

Server reads the previous PM JSON, splits it into "kept" and "edited" regions via a structural diff against the Agent's new Markdown, only runs the Markdown round-trip on the edited regions, grafts the result back into the untouched PM tree (which keeps its marks).

Tradeoffs:
- Preserves the Markdown ergonomics on the Agent side — no prompt change.
- The "structural diff + graft" code is the maximalist version of the encode/decode/reconcile-ids pipeline we just deleted. It needs block-id matching, anchor reattachment, fuzzy substring matching across the boundary, and a story for "what counts as the same block after the Agent renamed it."
- Highest hidden-failure risk: feels fine on small edits, breaks on near-duplicate paragraphs, breaks on whole-section rewrites that retain a few unchanged sentences.

Rejected because it preserves the smell that caused the bug and adds two more layers of fuzzy logic.

### C. Register `CommentsExtension` server-side so the existing pipeline preserves marks

Add the BlockNote `CommentsExtension` to `serverPlanEditor` so `_blocksToProsemirrorNode` knows the `comment` mark and round-trips it correctly. Delete `stripCommentMarks`. Keep the Markdown pipeline.

Tradeoffs:
- Smallest possible diff: a few lines in `server-editor.ts`.
- The `comment` mark is `blocknoteIgnore: true`. Even with the extension registered, `blocksToMarkdownLossy` would still strip it on the way out. Registering the extension would fix the `_blocksToProsemirrorNode` import-time failure but not the lossy step.
- Leaves the encode/decode/reconcile-ids pipeline in place — the same overengineering the deletion test rejects.

Rejected because it doesn't actually fix the bug, and because it keeps the pipeline whose existence was the smell.

### D. Notion-style gutter via `Decoration.widget` instead of absolute positioning

Render each gutter icon as a ProseMirror `Decoration.widget` attached to the comment-marked text node. ProseMirror handles position mapping, scroll sync, and re-rendering for free; no `coordsAtPos` loop.

Tradeoffs:
- Cheaper to implement correctly (no rAF / ResizeObserver loop).
- Decorations live in the editor's DOM tree, not in a sibling rail. To get a fixed right column you would need to overlay decorations on a transparent layer aligned with the editor, or accept that icons appear in-line with text. Neither matches the Notion-style fixed right rail.
- Orphans cannot be represented — a decoration without a backing node has nowhere to live.

Rejected because the visual is the spec ("right side gutter where all the comments as icon could be visible just like Notion"), and orphan rendering is half the value.

## Uncertainties

- **Agent prompt cost of PM JSON.** PM JSON is more tokens than Markdown for the same content; harder for the LLM to edit without dropping `marks` arrays. **Mitigation:** strip non-essential fields from the PM JSON on the way out (`HTMLAttributes`, default `styles: {}` objects, etc.) inside `getPlanForAgent` before responding. **Verification:** measure prompt size on a representative Plan before/after; if the increase pushes a typical thread past comfortable context for `claude-opus-4-7` (>30k tokens for the Plan alone), reconsider per-block ops as a follow-up.
- **`coordsAtPos` jitter.** Mermaid render and font load shift block tops after the initial measurement. The gutter recomputes on `ResizeObserver` of the editor root, but a per-block observer would be more accurate. **First implementation:** root-only ResizeObserver, rAF-batched. **Mitigation:** if jitter is visible, upgrade to per-block ResizeObservers tracked through a `WeakMap<HTMLElement, IntersectionObserver>`.
- **Orphan detection cost on long Plans.** Walking the PM doc on every transaction to find each thread's anchor is O(threads × doc-size). For a 200-block Plan with 30 comments that is ~6000 traversals per keystroke. **Mitigation:** memoise the doc-walk by `editor.document` identity; share one walk that builds `Map<threadId, pos>` for all threads, then derive `top` per-icon. Verification: log scan time during the first weeks of use.
- **`comment_deleted` event side effects.** Existing comment subscribers (`use-thread-events.ts` `onCommentResolved`, the Agent's poll path) may need handlers for `comment_deleted`. **Verification step:** grep for every event-kind handler and add a `case 'comment_deleted'` that does the right thing (invalidate the comments query; the Agent's poll does not need to act on it since the Agent never wrote it).
- **Bridge `deleteThread` vs `deleteComment` semantics.** BlockNote's `ThreadStore` has both. We implement `deleteThread` (delete the whole annotation). `deleteComment` (delete a single message within a thread) stays as a throw — Tempo doesn't model per-reply deletion in this phase. **Open: does BlockNote's default UI surface either action?** With `comments={false}` on `BlockNoteView` and our own card components, the default UI is gone, so no user can trigger them; the throws are belt-and-braces.

### Verified against installed packages

These were uncertainties on a prior draft; the verification was done by reading the installed package source on disk before submitting this revision.

- **`view.coordsAtPos(pos, side?)` exists and returns `{ left, right, top, bottom }`.** Verified in `node_modules/.bun/prosemirror-view@1.41.8/.../prosemirror-view/dist/index.d.ts`. Safe to use.
- **The `comment` ProseMirror mark exposes the thread id via attribute `threadId`** (rendered as `data-bn-thread-id`). Verified in `node_modules/.bun/@blocknote+core@0.51.4+.../node_modules/@blocknote/core/src/comments/mark.ts`. The gutter's doc-walk matches on `mark.attrs.threadId`.

## Destructive actions

- The PR deletes four server files (`encode.ts`, `decode.ts`, `reconcile-ids.ts`, `server-editor.ts`) and removes `@blocknote/server-util` from `package.json`. These were added by the previous BlockNote migration; the audit (and the Dev's own framing this session) confirms no other callers.
- The PR changes the MCP wire format for the Plan from Markdown to PM JSON. Existing Plan data in the DB is unaffected (it is already PM JSON at rest). The change is on the Agent boundary only.
- `deleteComment` hard-deletes a row plus its replies plus its attachments. This is a Dev-initiated action with a confirm dialog ("Delete this comment and all replies? This cannot be undone."). The Agent does not get a delete tool.

**Not in this PR (deferred for explicit Dev approval):** dropping `comments.anchor_offset_hint`. Filed under AGENTS.md → "Spotted but not fixed". The column is dead but the destructive-action gate (AGENTS.md rule 24) is independent of "is there production yet"; it requires explicit, enumerated Dev approval, which this session did not give for this specific drop.

No `git push`, no deploy, no package publish, no force-push, no branch deletion, no external messages are part of this plan.

Dev acknowledgment, quoted from this session:

> resolved will be hidden unless the User tick the check mark to show the resolved comments. and user can unresolve too. while we are working here. Lets also provision a way to delete a comment. rest is ok go ahead.

"Rest" refers to the previous turn's enumerated proposal: PM JSON wire (Approach A); delete `encode.ts` / `decode.ts` / `reconcile-ids.ts` / `server-editor.ts` / `stripCommentMarks`; drop `@blocknote/server-util`; the gutter as designed; the resolved-checkbox; and orphan handling. That is the explicit scope of approval for the destructive parts of this PR.

## Vocabulary check

Inside CONTEXT.md vocabulary: Plan, Comment, Reply, Agent, Dev, Console, Thread. BlockNote's "thread" stays scoped as "comment thread" in code identifiers (`comment-thread-bridge.ts`, `PlanCommentCard`). The gutter is "comment gutter," never "comment sidebar" (BlockNote's `ThreadsSidebar` is a different component we are not using).

**"Comment gutter" is an implementation-layer UI noun, not a product noun.** It names a specific Console component (`plan-comment-gutter.tsx`) and the visual region it owns; it does not name a product surface a Dev would talk about ("my Plan's gutter" is meaningless to a Dev — they say "the rail of comment icons" or just "the comments"). No CONTEXT.md addition is required.

Module / file boundaries: `db-queries/plans.ts` is a seam (depth 1, leverage: every Plan reader/writer). `plan.ts` is the orchestrator (depth 1 above it). `plan-comment-gutter.tsx` is a leaf UI component (depth 0, one consumer).
