# Plan — Orphaned comments anchor by block ID (inline broken-anchor gutter)

**Date:** 2026-06-08
**Branch:** feat/blocknote (extend)
**Author:** Dev + Claude

---

## Problem

The current comment gutter (`plan-comment-gutter.tsx`) treats a comment as orphaned the moment its `comment` mark disappears from the PM doc, then dumps every orphan into a bottom strip with the literal label "ORPHANED" colliding with the icons. Two real problems:

1. **Orphans lose their place on the page.** A reader scanning the plan can no longer tell which paragraph a stale comment was about. The only recovery is the stored `plan_quote`, which the gutter doesn't surface at all.
2. **The orphan strip layout is broken.** The "ORPHANED" label sits on top of the icon (see screenshot the Dev shared) because both are absolute-positioned in the same 40px rail with no breathing room.

Prototype `prototype-comment-gutter.html` variant 3 ("inline broken-anchor") is the picked direction: orphans stay at the position of the **block they used to live in**, with a strong visual (dashed amber border + ✕ badge + broken-link strokes) so the reader sees "this comment was about this block, but the anchor text is gone." The remaining engineering question — *how do we know which block it used to live in once the mark is deleted* — is answered by persisting a `anchor_block_id` on the comment at creation time and reading it back in the gutter.

## Smallest concrete change

Add one column. Plumb it through three layers. Use it in the gutter.

1. **DB:** add `anchor_block_id TEXT` to `comments` (nullable; populated on insert, never updated) **and drop the dead `anchor_offset_hint` column** in the same migration — see "Dead column dropped in same migration" below.
2. **Capture at creation:** in `comment-thread-bridge.ts` `captureAnchor` (already invoked before BlockNote stamps the mark), additionally walk up the PM selection to the enclosing `blockContainer` and return its `attrs.id`. Pass it through to `createComment`.
3. **Contracts / API / server:** add `anchor_block_id: string | null` to `Comment` Zod schema and `CreateCommentRequest`. **Convert `createComment` (in `server/comments.ts`) from positional args to an options object** — see "Server signature refactor" below. Persist on insert. Surface on read.
4. **Gutter:** in `plan-comment-gutter.tsx`, change the orphan branch — instead of `null` position, look up `anchor_block_id` in the current PM doc via the existing block-id index BlockNote already maintains. If the block is still present, return its top as the orphan's position. If the block is also gone, fall back to the bottom-of-rail footer bucket (variant 1 fallback, kept for the "block deleted too" edge case).
5. **Gutter visual:** restyle the orphan `GutterIcon` per prototype variant 3 — dashed amber border + ✕ badge. (The prototype's "broken-link strokes" are dropped — see "Orphan gutter visual" below.) Popover surfaces `plan_quote` so the reader can read what the comment was about even when the text is gone.

No fuzzy quote-search, no client-side last-known-position memory, no PM step mapping. Block IDs are the single source of truth.

## Dead column dropped in same migration

`comments.anchor_offset_hint` (schema.ts:91) is a dead column from the pre-BlockNote anchor model, already flagged in AGENTS.md "Spotted but not fixed" (2026-06-07). Never read, never written, never surfaced in any contract. Leaving it in while adding `anchor_block_id` next to it would force every future reader to disambiguate two nullable anchor columns.

**Decision: drop it in the same migration.** Single migration `0014_comment_anchor_block_id.sql` does both:

```sql
ALTER TABLE comments ADD COLUMN anchor_block_id TEXT;
ALTER TABLE comments DROP COLUMN anchor_offset_hint;
```

(SQLite 3.35+ supports `DROP COLUMN` natively, and libSQL inherits this. Verify SQLite version in CI; if for some reason the runtime can't do native drop, fall back to the 12-rules table-rebuild pattern in the same migration file.)

The Dev's destructive-action acknowledgment in this conversation explicitly covers the drop — see "Destructive-action acknowledgment" below.

Update AGENTS.md to remove the dead-column entry from "Spotted but not fixed" as part of the same commit.

## Server signature refactor

`createComment` in `apps/console/server/comments.ts:14-20` is positional:

```ts
createComment(threadId, plan_quote, plan_context, first_reply_text?, attachment_ids = [])
```

Adding `anchor_block_id` as a sixth positional arg between `plan_context` and `first_reply_text` is a foot-gun (`first_reply_text?: string` followed by `attachment_ids: string[] = []` is already at the threshold). Convert to an options object in this change:

```ts
type CreateCommentInput = {
  threadId: string;
  plan_quote: string;
  plan_context: string;
  anchor_block_id: string | null;
  first_reply_text?: string;
  attachment_ids?: string[];
};
export async function createComment(input: CreateCommentInput): Promise<Comment> { ... }
```

The only call site is `apps/console/app/api/threads/[id]/comments/route.ts` — single edit. The client side (`api-client.ts:126`) is already object-based via `CreateCommentRequest`; no client change.

## Files

| Path | Purpose | Layer |
|---|---|---|
| `apps/console/db/migrations/0014_comment_anchor_block_id.sql` | Two statements: `ALTER TABLE comments ADD COLUMN anchor_block_id TEXT;` (nullable; backfill is no-op — existing rows stay NULL → fall through to footer bucket) and `ALTER TABLE comments DROP COLUMN anchor_offset_hint;` (dead since pre-BlockNote anchor model; never read or written). | DB migration |
| `apps/console/db/schema.ts` | Add `anchor_block_id: text('anchor_block_id')` and remove `anchor_offset_hint`. | DB schema |
| `packages/contracts/src/primitives.ts` | Add `anchor_block_id: z.string().nullable()` to `Comment` schema. | Contract |
| `packages/contracts/src/http.ts` | Add `anchor_block_id: z.string().nullable().optional()` to `CreateCommentRequest`. Optional on the wire — legacy clients can omit; server treats `undefined` and explicit `null` as "unknown anchor". | Contract |
| `apps/console/server/comments.ts` | Convert `createComment` to a `CreateCommentInput` options-object signature (see "Server signature refactor"); add `anchor_block_id` to the insert; surface in `shapeComment`. | Business rules (server) |
| `apps/console/app/api/threads/[id]/comments/route.ts` | Read `anchor_block_id` off the parsed body and forward to `createComment`. (Thin route handler — pure plumbing.) | Route handler |
| `apps/console/lib/api-client.ts` | `createComment` already takes a typed body — TS picks up the new optional field automatically once the contract changes. No edit unless the signature is positional. (Verify.) | Client API |
| `apps/console/components/thread/editor/comment-thread-bridge.ts` | `captureAnchor` now returns `{ quote, context, blockId }`. Walk up `editor._tiptapEditor.state.selection.$from` until the parent node is `blockContainer`, read `node.attrs.id`. Forward `blockId` to `api.createComment`. | Editor adapter |
| `apps/console/components/thread/editor/plan-comment-gutter.tsx` | Change `walkPmDocForCommentMarks` to also collect a `blockId → top` map (one pass). In the orphan branch (mark not found), look up `comment.anchor_block_id` in that map → use its top. Drop the "first-orphan label colliding with first-orphan icon" code path; orphans either render inline at their block top, or fall through to a true footer bucket when the block is also gone. Restyle `GutterIcon` orphan variant per prototype variant 3. | UI |
| `prototype-comment-gutter.html` | Delete once production gutter is verified. | Cleanup |

No edits to: agent prompt, MCP server, `comments.ts` MCP tool descriptions (the agent never creates Comments; the Dev does, in the editor). No edits to replies / resolve / delete paths.

## Where the block ID comes from

BlockNote's PM schema wraps every block in a `blockContainer` node with `attrs.id` (verified in the live doc JSON for `thr_01KTKEG5NN4KN21NSXB9HFJ59X`: every block has `"attrs":{"id":"f4088b94-2b45-478d-b716-65fbed831757"}` etc.). The bridge's `captureAnchor` already runs at the right moment — *before* BlockNote stamps the `comment` mark on the selection — so the PM selection still points into the block the user is annotating. Walking `state.selection.$from` upward to depth 1 (or the first node whose type is `blockContainer`) yields the enclosing block. That's the anchor_block_id.

```ts
// In comment-thread-bridge.ts, inside captureAnchor (called by the Dev hook
// that wires the bridge to the editor — see plan-editor.tsx for the existing
// wire-up):
const $from = editor._tiptapEditor.state.selection.$from;
let blockId: string | null = null;
for (let d = $from.depth; d > 0; d--) {
  const n = $from.node(d);
  if (n.type.name === 'blockContainer') {
    blockId = (n.attrs.id as string | undefined) ?? null;
    break;
  }
}
return { quote, context, blockId };
```

If the selection happens to be at the top of the doc (depth 0) or in a context without a `blockContainer` ancestor, `blockId` stays null — that comment becomes orphan-without-a-fallback-block on day one, which is the same behaviour as today for those cases.

## Where the block ID is read back

In `plan-comment-gutter.tsx`, the existing `walkPmDocForCommentMarks` descends the doc once and returns `Map<commentId, pos>`. Extend it to return a second map `Map<blockId, pos>` from the same walk (one extra check per `blockContainer` node):

```ts
function walkPmDoc(editor): { byCommentId: Map<string, number>; byBlockId: Map<string, number> } {
  const byCommentId = new Map<string, number>();
  const byBlockId = new Map<string, number>();
  editor._tiptapEditor.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'blockContainer') {
      const id = node.attrs.id as string | undefined;
      if (id) byBlockId.set(id, pos);
      return; // children visited next anyway
    }
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment') continue;
      const tid = mark.attrs.threadId as string | undefined;
      if (typeof tid === 'string' && !byCommentId.has(tid)) byCommentId.set(tid, pos);
    }
  });
  return { byCommentId, byBlockId };
}
```

Then, when a comment isn't in `byCommentId`, look up `comment.anchor_block_id` in `byBlockId` → `editor._tiptapEditor.view.coordsAtPos(pos)` → set the orphan's `top` to that block's top. If `anchor_block_id` is null or the block is also gone, mark `top = null` and rely on the footer bucket fallback (kept exactly because of this case — sometimes the agent rewrites a whole section and both the mark and the enclosing block disappear).

## Orphan gutter visual (prototype variant 3, distilled)

The current `GutterIcon` already takes an `orphaned?: boolean` prop. Update the styling branch:

```tsx
// Inside GutterIcon, when orphaned:
className = `${base} bg-warn-soft border-2 border-dashed border-warn text-warn`;
// Add a small ✕ badge in the bottom-right corner (absolute):
{orphaned && <span aria-hidden className="absolute -bottom-1 -right-1 size-3 rounded-full bg-warn text-white text-[8px] font-bold leading-none flex items-center justify-center border-2 border-bg">×</span>}
```

(`warn` colour token is already in DESIGN.md — verify exact name before edit; if it's `--accent-amber` or `--warn-deep` etc., use the real token.)

**The prototype's "broken-link strokes" are dropped.** They were `::before` / `::after` dashes pointing back at the doc; in the live 40px-wide gutter sitting at `right: 0` they collide with the gutter edge and don't earn their visual weight. Dashed amber border + ✕ badge alone reads clearly as "unmoored."

The hover popover on `GutterIcon` currently shows nothing beyond a `title` tooltip. Extend it (or the click-opened `PlanCommentCard`) to display `plan_quote` is **out of scope for this plan** — see Out of scope §1. This plan ships the gutter positioning + visual; the card surface change is a separate, follow-up plan.

## Backfill for existing comments

Existing rows have `anchor_block_id = NULL`. They're treated as "anchor block unknown" → if the comment's `comment` mark is still in the doc, render anchored as today; if the mark is gone, fall through to the footer bucket. **No backfill job.** The agent regenerates plans frequently in active threads, and stale orphans-without-block-id are exactly the comments where the dev would manually decide to resolve or delete. Newly-created comments after this lands will have the column populated. The bucket persists for the long tail.

## Alternatives considered

1. **Client-only last-seen-top snapshot (Option 1 from the design conversation).** Rejected: lost on refresh; doesn't help anyone but the active session author.
2. **Fuzzy re-anchor by `plan_quote` (Option 3).** Deferred. Better UX (often eliminates the orphan entirely) but bigger surface — needs a confidence threshold, false-positive handling, and a UI when match is weak. Worth doing *after* Option 2 lands and we see how often the block-id approach already covers the case. Filing as Spotted but not fixed.
3. **PM step mapping to track positions across edits (Option 4 variants).** Rejected: client-only state, doesn't survive reload, fights the editor's own machinery.
4. **Zero-width keep-alive marker (Option 4 from design convo).** Rejected: fights BlockNote defaults, fragile against copy/paste, can litter the doc with markers.
5. **Store the full block PM JSON snapshot at creation, not just the ID.** Rejected: rewrites the role of `plan_quote` / `plan_context` (which already exist for this purpose), and turns a 24-byte ID into kilobytes per comment for marginal gain.
6. **Update `anchor_block_id` on every plan save based on where the mark currently lives.** Rejected: solves a non-problem — once the comment is created the anchor block is fixed; if the user moves the comment by editing, that's a fresh decision tree we don't need to model. Single insert-time write is sufficient.

## Uncertainties

1. **Whether every block-shaped node in the BlockNote schema (mermaidDiagram, alert, codeBlock, tables) is wrapped in a `blockContainer` with `attrs.id`.** Spot-checked against the live `thr_01KTKEG5NN4KN21NSXB9HFJ59X` JSON: yes for headings, paragraphs, mermaidDiagram, alert, table, codeBlock — all sit inside `blockContainer` with an `id`. Smoke-test with a comment on each block type during verification. If a particular block doesn't have an `id`, walking up further to the doc root yields `null` and the comment behaves like today.
2. **Whether `view.coordsAtPos(blockContainerStart)` returns a sane top for empty / oversized blocks (e.g. a mermaid block 400px tall).** Should: the block start position is the line-coord of its first child. If a comment was anchored on a block that's now collapsed/hidden, behaviour is whatever `coordsAtPos` returns — likely the top of the rendered area, which is correct enough.
3. **Which `blockContainer` to capture when the selection spans multiple blocks** (e.g. dev highlights from the end of a paragraph through to the next heading and creates a comment). **Default: use the first `blockContainer` ancestor of `state.selection.$from`** — the start of the selection. Rationale: the dev's anchor mental model is "where I started highlighting"; BlockNote's `comment` mark itself spans both blocks today, so when the mark survives nothing changes; when the mark dies, falling back to the *start* block matches how readers scan top-down. Verification: smoke-test a multi-block-selection comment, then delete only the end block, confirm the orphan lands on the start block.

## Deletion test (per CLAUDE.md / CONTEXT.md §2)

For each new module / column: "If we deleted this in 6 months, where does the complexity reappear?"

- `anchor_block_id` column — the orphan positioning regresses to today's broken-strip behaviour. Complexity reappears wherever the Dev would want to know "where did this comment used to live." **Earns its place.**
- The `byBlockId` map in the gutter walk — fused into the existing single-pass `descendants` traversal, not a separate data structure. Deletion would silently re-introduce the "orphan with no position" branch. **Earns its place; no new file.**
- New gutter visual (dashed border, ✕ badge) — pure CSS / className change inside the existing `GutterIcon` component, not a new module. **N/A.**
- The new `0014` migration — irreversible on production, but trivial (`ADD COLUMN ... NULL`) and tested by the dev's local migrate. **Earns its place.**

## Destructive-action acknowledgment

One **schema migration** with two statements:

1. `ALTER TABLE comments ADD COLUMN anchor_block_id TEXT` — additive, nullable, no data loss.
2. `ALTER TABLE comments DROP COLUMN anchor_offset_hint` — **destructive**: drops a column. Data loss is nil in practice because the column is dead (never read or written by any code; verified by grep against the repo — see Alternatives §1), but it is irreversible without a migration revert.

The Dev runs `bun run --filter @tempo/console db:migrate` locally; no production DB is touched in this PR. No `git push`, no deploy, no force-push, no package publish, no `rm -rf`.

Dev acknowledgments (both quoted verbatim from this conversation):

> *"ok go with option 2. draft a plan and use this gutter UI. we have worked on for reference."* — authorises adding `anchor_block_id`.
>
> *"ok go ahead. and feel free to drop the dead column."* — authorises the destructive drop of `anchor_offset_hint`.

## Out of scope (deliberate)

1. **Surfacing `plan_quote` inside `PlanCommentCard`** (the click-opened card). A real UX improvement for every comment — anchored *and* orphaned — but it doesn't trace to "orphans lose their place on the page" and pulling it in conflates two changes. File as a follow-up plan after this lands.
2. **Fuzzy re-anchor by `plan_quote`.** Filed as Alternative 2 above; revisit after we see how often block-id alone suffices.
3. **A "resolve all orphans" bulk action.** The dev has resolve/delete on each one already; bulk is yagni until we see ≥5 orphans in a single thread regularly.
4. **Persisting `anchor_block_id` retroactively for existing comments.** Backfill section above.
5. **Updating the agent's MCP plan-write tools to preserve block IDs across rewrites.** That's a separate edge case (agent regenerates a whole plan with fresh IDs → every existing comment goes orphan). Tracked as Spotted but not fixed; the block-id strategy *plus* the fuzzy re-anchor follow-up is the real fix.
6. **A new colour token for orphan amber.** Reuse the existing `warn` / `accent-amber` token in DESIGN.md.
7. **Promoting prototype variants 1 & 2 to live behind a flag.** Variant 3 is the pick; the other two are deleted with the prototype HTML file.
8. *(No longer out of scope — the dead `anchor_offset_hint` column is dropped in this plan; see "Dead column dropped in same migration.")*

## Sequence

1. Write `apps/console/db/migrations/0014_comment_anchor_block_id.sql` (both statements: ADD + DROP) + update `apps/console/db/schema.ts` (add `anchor_block_id`, remove `anchor_offset_hint`) + update `AGENTS.md` "Spotted but not fixed" to remove the now-fixed dead-column entry. Run `bun run --filter @tempo/console db:migrate` locally; confirm `anchor_block_id` appears and `anchor_offset_hint` is gone.
2. Update `packages/contracts/src/primitives.ts` (Comment schema) and `packages/contracts/src/http.ts` (CreateCommentRequest). Run `bun run typecheck` — expect failures in `server/comments.ts`, `api/threads/[id]/comments/route.ts`, `lib/api-client.ts`, `comment-thread-bridge.ts`, gutter, anywhere else.
3. Update `apps/console/server/comments.ts` — convert `createComment` to the `CreateCommentInput` options object (see "Server signature refactor"), add `anchor_block_id` to the insert, update `shapeComment` to surface it.
4. Update `apps/console/app/api/threads/[id]/comments/route.ts` to call `createComment({ … })` with the new options object and forward `anchor_block_id` from the parsed body.
5. Update `apps/console/components/thread/editor/comment-thread-bridge.ts`: extend `captureAnchor` return shape to `{ quote, context, blockId }`, walk up to the first `blockContainer` ancestor of `state.selection.$from`, forward `blockId` to `api.createComment`.
6. Update `apps/console/components/thread/editor/plan-comment-gutter.tsx`: fuse the second map into `walkPmDoc` (rename from `walkPmDocForCommentMarks`), change the orphan branch to read `anchor_block_id` from each `Comment`, restyle `GutterIcon` orphan variant per "Orphan gutter visual," drop the colliding ORPHANED label code path.
7. Smoke-test in the browser with chrome-devtools MCP on `thr_01KTKEG5NN4KN21NSXB9HFJ59X` and a freshly-created thread:
   - Create a new comment → confirm `anchor_block_id` is persisted (check sqlite directly).
   - Edit the anchored text but keep the block → comment stays anchored at the same line.
   - Delete the anchored text but keep the block → comment goes orphan, icon appears at block top with dashed amber + ✕ badge.
   - Delete the whole block → comment falls through to the footer bucket.
   - Multi-block-selection comment → delete only the end block → orphan lands on the *start* block (uncertainty #3 verification).
   - Refresh page → all states survive.
8. Delete `prototype-comment-gutter.html` (and any sibling notes).
9. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` in parallel (single message). Address findings.
10. Commit to `feat/blocknote` after Dev confirms.

---

End of plan.
