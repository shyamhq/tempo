# Plan — Persist the Plan as ProseMirror JSON

## Problem

The Plan persists today as **blocks JSON** (`editor.document`). BlockNote's blocks-JSON serializer drops every mark tagged `blocknoteIgnore: true` — explicit code path at `node_modules/@blocknote/core/src/api/nodeConversions/nodeToBlock.ts:205-208`. The CommentsExtension's `CommentMark` IS tagged that way (`@blocknote/core/src/comments/mark.ts:55`).

User-observed effect:

- Dev selects text, comments. The mark rides along through every subsequent edit (PM tracks its positions). The comment renders, replies work, resolve works.
- Dev refreshes. The mark was stripped during the save's blocks-JSON serialization. The Comment row is in the DB; its anchor in the document is not.
- Pink text colour and other registered styles round-trip fine, because they're proper `StyleSpec` entries — not `blocknoteIgnore` marks.

Our diagnosis is not "fix the comment flow." It's "blocks JSON is a lossy projection of the editor's state — BlockNote treats it as an export format, we chose it as the store. Everything tagged `blocknoteIgnore` (today's CommentMark, tomorrow's AI Suggestions, anything else BlockNote adds) hits the same wall."

## The smallest concrete change

Swap the at-rest format from blocks JSON to ProseMirror JSON. PM JSON is BlockNote's actual source of truth — it includes every mark, every node, every attribute. Save and load become symmetric: whatever is in the editor goes to the DB; whatever's in the DB comes back to the editor verbatim. The CommentMark — and any future `blocknoteIgnore` mark — survives the round-trip the same way it survives in-memory edits, because PM is doing the position-tracking work, not us.

### What changes

1. **Storage.** `plans.body_blocks` (TEXT, blocks JSON) → `plans.body_pm_json` (TEXT, PM JSON). One Drizzle migration, drop + add. **Destructive — drops existing body_blocks values. AGENTS.md confirms data loss acceptable in this phase.**
2. **Schema** (`apps/console/lib/plan-schema.ts`). Unchanged. The BlockNote schema definition is the same. We're swapping the serialized form at a deeper layer.
3. **Console editor surface.** `useCreateBlockNote` mounts empty. Once mounted, the parent calls `editor._tiptapEditor.commands.setContent(pmJson, { emitUpdate: false })` to load the persisted state. The save snapshot uses `editor._tiptapEditor.getJSON()` instead of `editor.document`.
4. **HTTP route.** `POST /api/threads/[id]/plan` body changes from `{ blocks: unknown[] }` to `{ pm_json: unknown }`. `GET` response's `plan.body` carries `pm_json` instead of `blocks`. Agent route (`/plan/agent`) keeps the annotated-Markdown wire format unchanged.
5. **`server/plan.ts`.** `getPlan` / `writePlan` read/write `body_pm_json`. `getPlanForAgent` converts PM JSON → blocks (via existing `serverPlanEditor._prosemirrorJSONToBlocks`) → annotated Markdown (via the existing encoder). `writePlanFromAgent` converts annotated Markdown → blocks → PM JSON via `serverPlanEditor._blocksToProsemirrorNode(...).toJSON()`.
6. **Auto-save hook.** `getBlocks: () => PlanBlock[]` becomes `getPmJson: () => unknown`. Persist signature changes shape; the rest of the state machine (debounce, in-flight, backoff, beacon) is identical.
7. **PlanEditorHandle.** `getBlocks` → `getPmJson`. `toMarkdown` stays — still calls `editor.blocksToMarkdownLossy(editor.document)` because the live editor projection is fine for the Copy-Plan handoff.
8. **Live re-load on Agent edits.** *Bundled with this change because the mechanism is the same `setContent` call we're adding for the initial load.*

   **Trigger timing.** `useThreadEvents`'s SSE handler already calls `qc.invalidateQueries({ queryKey: ['thread', threadId] })` unconditionally on every `plan_edited_by_agent` event (see `apps/console/hooks/use-thread-events.ts:190`). The invalidate fires a background refetch; the new `view.plan.body.pm_json` becomes the React-state value when the fetch resolves, not when the SSE event arrives. The live-reload effect therefore must depend on the refetched value, not on the SSE callback. Its dep list is `[data.plan.body.pm_json, saveStatus]`.

   **Where it lives.** A single `useEffect` in `thread-view.tsx`, alongside `persistPmJson`. NOT inside `usePlanAutoSave` — pushing it into the hook would force the hook to do two distinguishable things (own the save state machine AND own remote-update reconciliation). `saveStatus` is already returned by `usePlanAutoSave`; reading it in the effect's dep list is the same pattern we use for the unload beacon.

   **State the effect reads/writes.**
   - Reads: `data.plan.body.pm_json` (the latest fetched value), `editorHandle?.getPmJson()` (the editor's current PM JSON for comparison), `saveStatus`.
   - Writes: a `pendingAgentPmJsonRef` (holds the queued `pm_json` *value*, not a boolean) and calls `editor._tiptapEditor.commands.setContent(pmJson, { emitUpdate: false })` on the live editor.

   **Behaviour.**
   - On each render where the dep list changes: if the fetched `pm_json` differs from the editor's current `getPmJson()` (deep-equal of serialised JSON — they're plain objects), and `saveStatus` is `idle` or `saved`, apply immediately. Clear `pendingAgentPmJsonRef`.
   - If `saveStatus` is `saving` or `error`, set `pendingAgentPmJsonRef.current` to the freshly fetched `pm_json` and return. Subsequent fetches overwrite this ref — we always queue the latest server snapshot, never a stale one.
   - The same effect re-runs when `saveStatus` transitions to `idle`/`saved`. If `pendingAgentPmJsonRef.current` is non-null, apply it now and clear the ref.

   **Stale-snapshot guard.** If a Dev save completes (status flips to `saved`) and that save's response carries an `updated_at` that's *newer* than the queued `pm_json`'s freshness, the Dev's save is the more recent writer — drop the queued reload. We already update the cache optimistically with the Dev's save; the queued `pm_json` would have been overwritten in the cache during the Dev's save's optimistic update, and the next fetch (post-Dev-save) brings whatever the server has now. Net: the deferred apply doesn't fight a fresh Dev save.

   **Continuous-typing starvation.** If the Dev never stops editing, `saveStatus` cycles `saving` → `saved` → `saving` → ... and the deferred reload window appears between each `saved` and the next `saving`. The effect runs on every dep change, so a one-tick `saved` window is enough to apply the queued reload. The original concern (starvation) is therefore practical only if the Dev's typing burst exceeds the auto-save debounce (700ms) such that the editor never settles. **Accepted.** The existing "Plan updated by Agent" toast keeps firing on each SSE event, so the Dev always sees that the server has new content even when the editor stays on their in-progress version.

What stays unchanged: the schema, the auto-save state machine, the recheck button, the comment bridge (it talks to REST endpoints — doesn't care about the body format), the agent's annotated-Markdown wire format with `⟦sty:…⟧` sentinels, the MCP tool descriptions.

### Where the new code lives (layer placement)

| File | Layer | What |
|---|---|---|
| `apps/console/db/schema.ts` + new migration | DB | Drop `body_blocks`, add `body_pm_json`. |
| `apps/console/server/plan.ts` | server | `getPlan`/`writePlan` operate on `body_pm_json`. `getPlanForAgent`/`writePlanFromAgent` use `ServerBlockNoteEditor._prosemirrorJSONToBlocks` / `._blocksToProsemirrorNode` at the encoder/decoder boundary. |
| `apps/console/components/thread/editor/plan-editor.tsx` | UI | Mount empty editor; effect calls `editor._tiptapEditor.commands.setContent(pmJson, { emitUpdate: false })` once initial PM JSON is available. `PlanEditorHandle.getPmJson()` replaces `.getBlocks()`. |
| `apps/console/components/thread/editor/use-plan-auto-save.ts` | UI (hook) | `getPmJson` replaces `getBlocks`. State machine unchanged. |
| `apps/console/components/thread/thread-view.tsx` | UI | `persistBlocks` → `persistPmJson`. `unloadBeacon` body swaps shape. Adds the live-reload effect that re-applies fresh `pm_json` to the editor when the Agent writes and the Dev is idle. |
| `packages/contracts/src/primitives.ts` | contracts | `PlanBody.blocks: unknown[]` → `PlanBody.pm_json: unknown`. |
| `packages/contracts/src/http.ts` | contracts | `WritePlanRequest` swaps `blocks` → `pm_json`. |

### Deletion test for new things

This is a format swap, not a feature add. The new artifacts are: one column (`body_pm_json`), one renamed contract field (`pm_json`), one new accessor on PlanEditorHandle (`getPmJson`). Each one replaces a near-identical thing rather than adding a layer.

- Drop `body_pm_json`? Then nothing is persisted; the column is mandatory.
- Drop `pm_json` field? Then the wire shape mismatches what's stored.
- Drop `getPmJson()`? Then the auto-save can't snapshot the editor.

Net: zero pass-through helpers introduced. The change replaces a lossy projection with the editor's actual state.

### Implementation order

Each step is independently buildable.

1. **Migration.** *Pre-flight: ask the Dev "drop body_blocks, accept data loss?" in this conversation turn and wait for explicit "yes" before proceeding.* Then generate via Drizzle: drop `body_blocks`, add `body_pm_json` TEXT. Apply.
2. **Contracts.** Rename `PlanBody.blocks` → `PlanBody.pm_json`. Rename `WritePlanRequest.blocks` → `WritePlanRequest.pm_json`. The Console + agent fail typecheck until step 3.
3. **Server.** `server/plan.ts` operates on `body_pm_json`. Adapt `getPlanForAgent` to call `serverPlanEditor._prosemirrorJSONToBlocks(pmJson)` before the existing encoder. Adapt `writePlanFromAgent` to call `serverPlanEditor._blocksToProsemirrorNode(blocks).toJSON()` after the existing decoder. **Smoke-test the conversions end-to-end before continuing** (judge note: a 20-line throwaway script that round-trips a fixture PM JSON through encode → decode → assertEqual).
4. **Auto-save hook + PlanEditorHandle.** Swap `getBlocks` → `getPmJson`. Hook signature updates.
5. **PlanEditor.** Mount empty; `setContent(pmJson, { emitUpdate: false })` after mount. Gate render behind a `ready` flag so the empty editor doesn't flash.
6. **thread-view.tsx.** `persistBlocks` → `persistPmJson`. `unloadBeacon` swaps shape.
7. **Live re-load.** Add the effect described in §"What changes" item 8: when the server's `pm_json` changes and the Dev is idle, apply via `setContent`. Deferred re-apply if Dev is saving/error. Hand-test by running the Agent against a live Thread and confirming the editor visibly updates without a refresh.
8. Run `code-simplifier` and `code-reviewer` per AGENTS.md §21–22.

## Alternatives considered

### A. Save blocks JSON + a sidecar positional offsets map per comment.

Persist blocks as today plus `{ commentId → { from, to } }` per Plan. On load, re-stamp marks via TipTap commands at the stored offsets.

Trade-offs:
- Smaller storage delta (no schema change beyond an extra column or JSON field).
- PM positions are doc-relative; any edit elsewhere in the doc shifts them. Offsets go stale within a single Dev session. We'd need to keep them in sync via every transaction.
- Reinvents what PM JSON already gives us, less robustly.

**Rejected.**

### B. Switch to Yjs (use `YjsThreadStore` reference implementation).

Adopt the CRDT path. Persist Y.Doc binary state.

Trade-offs:
- Most faithful to BlockNote's design. CommentMark + any future `blocknoteIgnore` extension just works.
- Brings Yjs, awareness, providers — sync infrastructure for a single-user Console.
- Snapshots, history GC, more moving pieces.

**Rejected — overkill for single-user MVP. Reconsider if multi-Dev editing arrives.**

### C. Save the full PM JSON. **(This plan.)**

Smallest change. Symmetric save/load. Marks ride along via PM's own position tracking. No new infrastructure.

### D. Quote + context per comment, re-stamp on every editor mount.

Capture `plan_quote + plan_context` at create time; substring-search on every load and stamp the mark.

Trade-offs:
- Doesn't touch storage format.
- Substring matching flakes on near-duplicate text.
- Doesn't help future `blocknoteIgnore` marks (suggestions, etc.).
- Re-stamping on every mount is brittle relative to PM's intrinsic position tracking.

**Rejected** in favour of C — same complexity, narrower coverage.

## Uncertainties

- **`editor._tiptapEditor.commands.setContent(pmJson, { emitUpdate: false })` semantics.** TipTap's `setContent` signature is `(content, options?: SetContentOptions)` per `node_modules/@tiptap/core/dist/index.d.ts:3785`. `emitUpdate: false` is the documented option for suppressing the `onUpdate` callback (and therefore our auto-save trigger) during the initial load. Used widely by `YjsThreadStore`; behaviour should be stable. **Verification: step 5 builds a smoke fixture that mounts empty + setContent + confirms no onChange fires for the initial load + asserts `editor.document` equals the blocks projection of the fixture.**

- **`_blocksToProsemirrorNode(blocks).toJSON()` produces round-trippable PM JSON.** `_blocksToProsemirrorNode` returns a ProseMirror `Node` per `node_modules/@blocknote/server-util/types/src/context/ServerBlockNoteEditor.d.ts:48`. ProseMirror's `Node.toJSON()` is documented to produce the serialized JSON form, and the schema-aware inverse is `Node.fromJSON(schema, json)` — which is what `_prosemirrorJSONToBlocks` consumes internally. **Verification: step 3's smoke fixture round-trips a fixture PM JSON through encode (PM → blocks → Markdown) and decode (Markdown → blocks → PM via `_blocksToProsemirrorNode(...).toJSON()`) and asserts the styled-text structure is preserved. The CommentMark will not round-trip through the agent path — that's the accepted v1 limit called out below.**
- **`useCreateBlockNote({ initialContent: undefined })` then `setContent`.** Two-step init introduces a frame where the editor renders empty. **Mitigation: gate the editor's render behind a `ready` flag — show the existing `EmptyPlanState` skeleton until the PM JSON is loaded and applied.**
- **PM JSON wire size.** Typical plans (a few KB to tens of KB) gain ~50% overhead. `fetch(keepalive)` caps body at 64 KB; the regular auto-save path has no cap. Beacon failures on very large Plans become a last-resort safety net, not the main save path.
- **`_prosemirrorJSONToBlocks` / `_blocksToProsemirrorNode` on `ServerBlockNoteEditor`.** Both are prefixed with `_` (BlockNote's "semi-internal" marker), but the `YjsThreadStore` and `server-util` test fixtures use them. Stable in practice; pin and re-evaluate at BlockNote upgrades.
- **Agent writes still lose comment marks.** `writePlanFromAgent` goes Markdown → blocks → PM, and blocks strip marks. If the agent rewrites a Plan that has comments, those comments orphan. **Accepted for v1.** Two follow-up paths if it bites: (a) re-anchor algorithm at the agent-write boundary only (text-match + re-stamp); (b) extend the `⟦sty:…⟧` sentinel format to carry `commentThread` IDs through markdown.

- **Live re-load wipes session-only CommentMarks.** When the live-reload effect applies the Agent's incoming `pm_json` via `setContent`, the editor's *entire* PM document is replaced. The Agent's `pm_json` never contains `CommentMark` (the Agent's write path strips marks at the markdown boundary — see the previous bullet). So any `CommentMark` the Dev placed *between their most recent save and the Agent edit landing* is silently removed when the reload applies. **Bounded window.** Once the Dev's auto-save lands (PM JSON now includes those marks), subsequent reloads preserve them — the marks are in the server snapshot the live-reload reads. The loss is only "marks placed during a not-yet-saved window that the Agent then overwrites." **Accepted for v1.** The deferred-apply behaviour helps here too: while the auto-save is in flight or pending, the live-reload waits — giving the marks a chance to land on the server before they can be overwritten. The pathological case is "Dev places a comment, Agent writes the Plan within the next ~700ms before debounce fires" — rare in normal use.
- **Dev edits during an Agent write (and the new live re-load).** The bundled live-reload effect (§"What changes" item 8) defers applying the Agent's PM JSON if the Dev's auto-save status is `saving` or `error` — applying mid-keystroke would jump the caret and discard pending edits. Once the Dev's save lands (`saved` or `idle`), the deferred reload fires. If the Dev keeps typing continuously and the deferred reload never gets a clean window, the next Agent toast still shows but the editor stays on the Dev's content — last-write-wins, with the Dev's most recent save being the eventual winner. **This is intentional.** The judge flagged this as the riskiest part of the original autosave plan; we accept the same trade-off and add the deferred-apply as the lightest mitigation.

## Destructive actions

The migration drops `plans.body_blocks` and replaces it with `plans.body_pm_json`. Existing rows lose their stored Plan body — the editor reads the new column as empty on first load.

**Pre-flight gate — explicit Dev acknowledgment required in this conversation before step 1 runs.** AGENTS.md rule 24 demands "explicit Dev approval in the same turn." Prior turns' "no production yet, big rolls are fine" approvals were scoped to other migrations. Step 1 of the Implementation order is therefore: *Implementing agent stops and asks the Dev to confirm "drop body_blocks, accept data loss" before generating the migration.* The judge's re-review and the Dev's explicit "yes" to this plan as a whole are not interchangeable with that step-level acknowledgment — the gate is on the destructive action specifically.

No file deletions, no external messages, no deploy, no git push, no force-push.

## Vocabulary check

- **PM JSON** (or **ProseMirror JSON**) is the canonical term in code comments, identifiers, and the new column name. Not "raw doc", not "editor state".
- **Plan body** stays unchanged — the Plan has one body; the wire shape just exposes a different field name (`pm_json`).
- CONTEXT.md product nouns untouched: Plan, Comment, Reply, Agent, Dev, Console, Thread, Session.
- No "service / manager / wrapper" creep.
