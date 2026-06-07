# Plan — Replace the Tiptap Plan editor with BlockNote

## Problem

Tempo's Plan is the artifact. It currently lives as a Tiptap (ProseMirror) editor over a Markdown column (`plans.body_markdown`), with two project-local extensions: `ConfluenceCodeBlock` (renders mermaid + language labels) and `CommentMark` (anchored comments). The Agent reads and writes Markdown via two MCP tools.

This shape has three real costs:

- Comments anchor via `plan_quote + plan_context` substring search and orphan whenever the Agent rewrites the surrounding text. There is no stable identity per block.
- Anything beyond Markdown grammar (text colour, custom marks, future custom blocks) cannot survive in the data model — Markdown is the source of truth and lossy by definition.
- The right-side "comment trail" panel in the current Tempo UI duplicates information already in the document and is, by the Dev's own report, a source of confusion.

We also have a working BlockNote prototype at `/playground` that exercises the editor, the comment marks, and the floating thread / composer UI replacements. The Dev wants to lift that mental model into the real Plan editor — polished against Tempo's visual language, with comments shown inline (BlockNote's default behaviour) and no separate trail panel.

## The smallest concrete change

One coordinated change that replaces the entire Plan editing layer end-to-end. The change is large but indivisible: half of it (Console BlockNote + blocks storage but markdown over MCP) would silently lose Dev styling on every Agent edit; the other half (sentinels over MCP but Tiptap on the Console) makes no sense. We ship it together.

What changes:

1. **Storage** — `plans.body_blocks` (TEXT, JSON string) replaces `plans.body_markdown`. One Drizzle migration drops the old column and adds the new. **Destructive: drops `body_markdown`. No production yet; AGENTS.md confirms data-loss is acceptable in this phase.**
2. **Schema** — a shared `planSchema` module exports a `BlockNoteSchema.create().extend(...)` constructed identically for client and server. Defines the custom block `confluenceCodeBlock` (mermaid + language label, replacing the Tiptap version) and registers BlockNote's built-in `CommentsExtension` style for inline comment threads.
3. **MCP server** — `tempo_pull_plan` and `tempo_write_plan` keep the same names but the wire payload becomes **annotated Markdown** (Markdown + inline `<x-mark id="…">…</x-mark>` sentinels) with a server-side sidecar map per request. Tool descriptions instruct the Agent to keep paired sentinels balanced and to let the markers travel with the wrapped text.
4. **HTTP routes** — `GET/POST /api/threads/[id]/plan` swap to blocks JSON. Console reads/writes the same shape natively; no encoder/decoder runs on the Console path.
5. **Comments** — switch from the `plan_quote + plan_context` re-anchor algorithm to BlockNote's native inline `commentThread` style. The comment is identified by `comment.id`; its anchor is "every inline run currently tagged with that id." Multi-block ranges are multiple inline tags sharing one id. The `plan_quote + plan_context` columns stay populated as a re-anchor fallback for when the Agent's edit corrupts a sentinel, and as the durable record on the DB side.

   **Comment creation flow** (Dev side, end-to-end):
   1. Dev selects text in the BlockNote editor and submits the floating composer.
   2. Client captures the selection's plain-text quote and a ±60-char context window from the editor (the same shape `anchor-find.ts` uses today).
   3. Client calls `POST /api/threads/:id/comments` with the existing `CreateCommentRequest` shape — `{ plan_quote, plan_context, first_reply_text?, attachments[] }` per `packages/contracts/src/http.ts:171-176`. The contract does not change. The Dev's submitted text goes into `first_reply_text`, not `body` (BlockNote's CommentsExtension calls this field "body" internally; the bridge translates the field name). Server inserts the comment + reply atomically, appends the `comment_added` event, returns the comment.
   4. On the response, the client calls `editor.addStyles({ commentThread: comment.id })` over the captured selection range. BlockNote stamps the inline style on every text run inside the selection (in every block the selection covers).
   5. The change to the editor document fires the standard debounced save, which `POST`s the new blocks JSON to `/api/threads/:id/plan`. The blocks now carry the `commentThread` style on the right inline runs.

   The DB is the source of truth for the comment's identity; the BlockNote style is the fast-path anchor; `plan_quote + plan_context` is the fallback when the style is gone.

   **Comment ↔ Reply mapping for BlockNote's `ThreadStore` interface.** BlockNote's CommentsExtension calls its annotation entity a "thread" and a "comment on a thread" is a second message on it. The mapping to Tempo's vocabulary:

   | BlockNote `ThreadStore` method | Tempo HTTP endpoint | Maps to Tempo noun |
   |---|---|---|
   | `createThread(initialComment)` | `POST /api/threads/:id/comments` (existing) | `Comment`. BlockNote's `initialComment.body` → Tempo's `first_reply_text`. Field name is translated in the bridge. |
   | `addComment(threadId, comment)` | `POST /api/comments/:id/replies` (existing) | `Reply` (subsequent message) |
   | `resolveThread(threadId)` | `POST /api/comments/:id/resolve` (existing) | flip `resolved_by` |
   | `unresolveThread(threadId)` | `POST /api/comments/:id/unresolve` (existing) | clear `resolved_by` |
   | `updateComment` | not implemented in Tempo | throw `not_supported` |
   | `deleteThread` / `deleteComment` | not implemented in Tempo | throw `not_supported` |

   All four supported endpoints already exist on disk. The bridge module does not need new server-side routes; it only maps BlockNote's method names onto our existing API.
6. **Editor surface** — the entire Tiptap stack under `apps/console/components/thread/editor/` is replaced by a BlockNote stack ported from `components/playground/` and re-skinned for the real Plan view. The separate comment-trail panel (rendered by `comments-canvas.tsx`) is deleted; comments show inline via `FloatingComposerController` + `FloatingThreadController` styled to match Tempo's existing card aesthetic. Orphaned-comments UI is removed (orphans are rare under the new model, and when they happen we surface them in the existing thread-level notifications rather than a stacked panel).
7. **ConfluenceCodeBlock parity** — re-implemented as a BlockNote custom block via `createReactBlockSpec`, preserving mermaid rendering and the language label. Round-trips through Markdown as a fenced code block with the language tag, which BlockNote's default Markdown parser already handles.
8. **Realtime** — unchanged. The event-log SSE / long-poll surface emits the same `plan_edited_by_*` ping events; the client invalidates the query and refetches the blocks JSON. No Yjs, no collab provider in this phase. Last-write-wins.
9. **Playground** — deleted. It existed to prove the BlockNote model; the real editor supersedes it.

What stays unchanged:

- Discussion editor (`MarkdownText` + textarea), new-thread composer, attachments tray, MCP transport (stdio), event-log schema, SSE / long-poll handlers, Approve / freeze flow (the readonly flag flips on a different editor — that's all), the Agent CLI's overall loop.

### Where the new code lives (layer placement)

| File | Layer | Responsibility |
|---|---|---|
| `apps/console/lib/plan-schema.ts` | shared (lib) | `planSchema` constructor; imported by both `ServerBlockNoteEditor` (in route handlers and the MCP server) and the client `useCreateBlockNote` hook. Lives in `lib/` because `apps/console/server/**` is server-only per AGENTS.md rule 19, and this module legitimately needs both sides. |
| `apps/console/server/plan/encode.ts` | server | `encodeForAgent(blocks) → { markdown, sidecar }`. Two-pass: (1) `serverEditor.blocksToMarkdownLossy(blocks)`, (2) walk blocks again, locate styled ranges in the resulting Markdown by substring + context (port of `anchor-find.ts`), inject `<x-mark>` tags. |
| `apps/console/server/plan/decode.ts` | server | `decodeFromAgent(markdown, sidecar) → blocks`. Strip sentinels, capture text ranges, parse clean Markdown via `serverEditor.tryParseMarkdownToBlocks`, re-attach styles by splitting inline runs at range boundaries, reconcile block IDs against the pre-edit tree. |
| `apps/console/server/plan/reconcile-ids.ts` | server | Pure function: given pre-edit blocks and post-parse blocks, assign stable IDs to blocks whose text content matches. New blocks keep their fresh IDs. |
| `apps/console/server/plan.ts` (existing) | server | `getPlan` / `writePlan` updated to read/write blocks JSON. New variants `getPlanForAgent` / `writePlanFromAgent` apply the encoder/decoder around the MCP boundary. |
| `apps/console/components/thread/editor/plan-editor.tsx` | UI | Replaces the Tiptap surface. Mounts BlockNote with `planSchema`, the `CommentsExtension`, and our `PlanCommentComposer` / `PlanCommentCard` cards. |
| `apps/console/components/thread/editor/comment-thread-bridge.ts` | UI | Implements BlockNote's `ThreadStore` interface, bridging its method names (`createThread`, `addComment`, `resolveThread`, `unresolveThread`) to our existing Tempo Comment + Reply REST endpoints per the mapping table above. The file name uses BlockNote's own term ("comment thread") with the `-bridge` suffix to make the role unambiguous and avoid colliding with Tempo's `Thread` noun. |
| `apps/console/components/thread/editor/confluence-code-block.tsx` | UI | BlockNote `createReactBlockSpec` re-implementation of the existing extension. |
| `apps/console/components/thread/editor/plan-comment-composer.tsx` | UI | Re-skinned port of `playground-composer-card.tsx`. Renamed from `tempo-floating-composer` to use the product noun (`comment`) rather than a `Tempo` prefix that adds no information. |
| `apps/console/components/thread/editor/plan-comment-card.tsx` | UI | Re-skinned port of `playground-thread-card.tsx`. Renamed from `tempo-floating-thread` for the same reason and to avoid the `Thread` collision. |
| `apps/console/db/migrations/0011_*.sql` | DB | Drop `body_markdown`, add `body_blocks`. |
| `packages/contracts/src/http.ts` | contracts | `WritePlanRequest.body` becomes `{ blocks: PartialBlock[] }`. `PlanBody` becomes `{ blocks, updated_at, updated_by }`. |
| `packages/contracts/src/mcp.ts` | contracts | Unchanged signatures; `markdown` field on both tools is now the annotated form. Tool descriptions revised in `mcp-server.ts`. |

### What gets deleted (deletion test)

- `apps/console/components/thread/editor/{plan-editor-surface.tsx, use-plan-editor.ts, use-plan-save.ts, plan-editor-extensions.ts, confluence-code-block.ts, comment-mark.ts, anchor-find.ts, comments-canvas.tsx}` — Tiptap surface and the comment-trail panel.
- `apps/console/app/playground/` and `apps/console/components/playground/` — the prototype.
- `plans.body_markdown` column.

For each new file added: if we deleted it in six months, would its complexity reappear elsewhere?

- `encode.ts` / `decode.ts` — Yes, it would have to live somewhere. This is the only place in the codebase that knows the wire format. Cannot inline.
- `reconcile-ids.ts` — Yes. Without it, comments detach on every Agent edit. Pure function with one caller, but the caller's correctness depends on it.
- `schema.ts` — Yes. Must be shared between server and client; can't be inlined.
- `comment-thread-bridge.ts` — Yes. CommentsExtension can't function without a `ThreadStore`, and the only first-party implementation (`YjsThreadStore`) is in-memory; we need our DB-backed one.
- `plan-comment-composer.tsx` / `plan-comment-card.tsx` — Yes. They replace BlockNote's default UI to match Tempo's card aesthetic, which is a Console-wide concern.
- `confluence-code-block.tsx` — Yes, if we want mermaid + language labels to keep working. (Could be deleted if we decide vanilla BlockNote code blocks are enough — see Uncertainties.)

### Implementation order

Each step is independently buildable and stops at a working state.

1. Add `body_blocks` column (keep `body_markdown` alive for one beat to ease the cutover). Migration only.
2. Build `schema.ts` and the empty `ConfluenceCodeBlock` custom block. Verify `ServerBlockNoteEditor.create({ schema })` works from a route handler. Add `serverExternalPackages` to `next.config.ts`.
3. Build `encode.ts` and `decode.ts` with unit-checkable pure-function seams. Round-trip the playground's sample doc through both and verify byte identity on no-op.
4. Build `reconcile-ids.ts` and wire it into `decode.ts`.
5. Swap the HTTP routes to blocks JSON. Console still on Tiptap at this point — it breaks. That's fine, we keep moving.
6. Build the new BlockNote editor surface, the thread store, and the floating composer/thread cards. Console works again.
7. Swap the MCP path. Agent now reads annotated Markdown. Update tool descriptions in `mcp-server.ts`.
8. Drop `body_markdown`, delete the Tiptap files, delete the playground.
9. Run `code-simplifier` and `code-reviewer` per AGENTS.md §21–22.

## Alternatives considered

### A. Blocks JSON as the MCP wire format (Agent emits `PartialBlock[]`)

The Agent would call `tempo_pull_plan` and receive a blocks tree; it would write a tree back. No encoder/decoder, no sentinel parsing, no block-id reconciliation.

Tradeoffs:

- Lossless by construction. Pink survives Agent edits perfectly — no model-discipline risk.
- The Agent prompt has to teach Claude Code to emit `PartialBlock[]` JSON for one tool while keeping Markdown for replies and discussion. Per-call payload becomes larger (JSON noise around the same content).
- The "style follows the edited text" property is lost. If the Dev colours `rock-solid` pink and the Agent rewrites it to `bulletproof`, the Agent has to know to re-apply `textColor: "pink"` to the new inline run. Same model-discipline burden as the sentinel approach, just in a different shape.
- Multi-step partial-success problem becomes acute if we go further and split into per-block ops (which the BlockNote AI extension does internally) — we'd need error-paths for stale block IDs mid-sequence.

Rejected because it forces a larger Agent prompt change without solving the model-discipline problem the sentinel approach already handles, and because it gives up the "style follows the edit" property.

### B. Per-block MCP operations (`tempo_update_block`, `tempo_insert_blocks_after`, `tempo_delete_blocks`)

Mirrors BlockNote's own AI extension protocol. Each operation targets one block by id; untouched blocks are untouched by construction.

Tradeoffs:

- Best preservation of untouched blocks — they're physically not in the request.
- Worst preservation of styling on *edited* blocks: the Agent emits a whole new `content` array for that block and we rely on model discipline to re-apply `styles` to unchanged runs. There's no quote+context fallback because there's no quote.
- Larger MCP surface (3+ tools instead of 1). Race conditions on partial-success.
- Drops the "style follows the edited text" win that sentinels give us.

Rejected because the failure mode on edited blocks is silent style-loss with no fallback, and because the protocol is materially more complex without buying us the property we care about.

### C. Keep Markdown at rest, hydrate to BlockNote on load

Storage stays `body_markdown`. Console parses it into BlockNote on load and serialises back on save. MCP unchanged.

Tradeoffs:

- Cheapest migration.
- Custom blocks (`confluenceCodeBlock` with mermaid) and any future custom inline content don't survive a load/save round-trip. The Dev's edits get silently downgraded every save. This is the same problem as today, just dressed in a new editor.
- The "Dev can style things" promise becomes a lie immediately.

Rejected because it doesn't actually solve any of the problems that motivated the migration.

### D. HTML as the MCP wire format

`blocksToFullHTML` / `tryParseHTMLToBlocks` round-trip custom styles and custom inline content cleanly because BlockNote does expose HTML serializer hooks. The Agent would receive HTML, edit HTML, write HTML back.

Tradeoffs:

- Lossless for the storage round-trip, no sentinels needed.
- HTML is 3–5× the token cost of Markdown for the same content, and LLMs are materially less fluent in HTML editing than Markdown editing. Bad failure modes (unclosed tags, attribute corruption) on heavier edits.
- The Agent's existing mental model (chat-style Markdown for replies, Plan editing in Markdown) breaks across surfaces.

Rejected on cost and ergonomics, even though it's technically the most lossless option.

## Uncertainties

- **Sentinel tag survival through `tryParseMarkdownToBlocks`.** CommonMark passes inline HTML through as a known construct, but we have not verified that `<x-mark>` specifically doesn't get stripped or escaped by BlockNote's remark pipeline. **Verification step in the implementation: round-trip a fixture through `tryParseMarkdownToBlocks → blocksToMarkdownLossy` with the tags inline; confirm they survive. If they don't, switch the sentinel to HTML-comment form (`<!--x-mark:abc-->…<!--/x-mark:abc-->`), which CommonMark guarantees to preserve verbatim. Falls back further to `⟦x-mark:abc⟧…⟦/x-mark:abc⟧` Unicode brackets if comments get tidied.**
- **Block-id stability across `tryParseMarkdownToBlocks`.** Parsing Markdown always mints fresh block IDs. `reconcile-ids.ts` handles this for unchanged blocks via text matching. For blocks the Agent rewrote, we accept new IDs — comments anchored inside such blocks fall back to the quote+context path. Unverified: how often the matcher mis-attributes IDs on near-duplicate paragraphs (e.g. two short list items with similar text). **Mitigation: log every reconciliation outcome with similarity scores during the first weeks of use; tune threshold based on real data.**
- **`ThreadStore` interface shape.** The four supported method-to-endpoint mappings are listed in the comment-creation flow above. What is uncertain is the exact TypeScript signature of `ThreadStore` in `@blocknote/core/comments` (return types, sync vs. async, optional methods, what payload `addComment` expects). **Verification step: read the `ThreadStore` type from `@blocknote/core/comments` source directly when wiring `comment-thread-bridge.ts`. Build the bridge to the mapping table; if the interface has methods we have not listed, default them to throw `not_supported` and surface a console warning. If `updateComment` turns out to be required by some BlockNote default UI path we cannot disable, the fallback is to no-op it and lose the edit silently — comments-extension's own UI never exposes message editing in its default configuration.**
- **`ServerBlockNoteEditor` in a Next.js route handler.** Docs require `serverExternalPackages` in `next.config.ts`. Unverified: whether the editor instance is cheap to construct per request, or whether we need a module-level singleton. **First implementation uses a singleton; if it leaks state across requests we move to per-request.**
- **ConfluenceCodeBlock parity scope.** The current Tiptap version renders mermaid via a runtime mermaid bundle. Porting to BlockNote's `createReactBlockSpec` should be straightforward, but the existing component carries some accumulated styling we may not need verbatim. **Approach: re-implement against the contract (mermaid renders, language label shows), not against the existing JSX line-for-line.**
- **Playground deletion.** The Dev has used `/playground` to iterate on this design. Deleting it in the same change loses a useful demo surface. **Open question for the Dev:** delete with the migration, or keep until the real editor stabilises? Default: delete with the migration. The new editor IS the demo.

## Destructive actions

The migration deletes `plans.body_markdown`. **AGENTS.md confirms data-loss is acceptable in this phase ("No production yet, totally fine, we can do a big roll")** — quoting the Dev's most recent message verbatim:

> Also, we need to understand: do we need some migrations? How are we going to roll this out? I mean, there is no production yet, so it's totally fine. We can do a big roll that is totally fine.

The migration also deletes the entire `apps/console/components/thread/editor/` Tiptap stack and `apps/console/{app,components}/playground/`. The Dev explicitly asked for the existing interface to be "replaced completely" — quoting verbatim:

> we have already done some testing in that playground. Maybe something similar we want, but more polished, with whatever interface we are having currently, because that will get replaced completely.

No `git push`, no deploy, no package publish, no force-push, no branch deletion, no external messages are part of this plan.

## Vocabulary check

This plan stays inside the `CONTEXT.md` vocabulary: Plan, Comment, Reply, Agent, Dev, Console, Thread, Session, Handoff card; module / interface / implementation / depth / seam / adapter / leverage / locality. No drift into "component / service / API / boundary" for architecture-level talk. (UI components are still called components — that's React's word.)

### Vocabulary resolution: BlockNote's "thread" vs Tempo's `Thread`

BlockNote's CommentsExtension calls its annotation entity a "thread" — `createThread`, `addComment(threadId, …)`, `resolveThread`. Tempo's `Thread` is the top-level planning unit (CONTEXT.md). The collision is real and the playground papered over it with a code comment in `playground-thread-card.tsx`. The production code must resolve it:

- Tempo's planning unit stays `Thread`. Nothing renames.
- BlockNote's annotation entity, when it appears in our code, is called a **comment thread** — never just "thread." This matches its role: the unit containing one or more Tempo `Comment` + `Reply` records.
- File and identifier names follow this rule:
  - `comment-thread-bridge.ts` — the `ThreadStore` implementation. The `-bridge` suffix signals it adapts an external interface to ours.
  - `plan-comment-composer.tsx`, `plan-comment-card.tsx` — UI cards. The `plan-` prefix scopes them to the Plan editor; the `-comment-` middle uses Tempo's noun directly. The word "thread" does not appear in any production identifier.
- Type imports from `@blocknote/core/comments` keep their original names internally (`ThreadStore`, `Thread`, etc.) but are immediately destructured or aliased at the import site. The bridge file does not re-export them.
- Comments and code in the new files refer to BlockNote's concept as "comment thread" (two words) or "the annotation thread" — never bare "thread."
