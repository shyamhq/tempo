# Plan: `tempo_update_block` / `tempo_add_blocks` accept multi-block HTML

## Problem

`tempo_update_block(blockId, html)` is documented as "replace one block with this HTML." When the Agent passes HTML that parses to multiple top-level blocks — e.g. `<h2>Phase 1</h2><ul><li>1.1</li><li>1.2</li></ul>` — the existing `htmlToBlock` silently keeps only the first block and drops the rest. A live user hit this: 8 phase headings rendered, every list under them vanished.

Earlier this session I landed Option A: throw `MultipleTopLevelBlocksError` and force the Agent to split the HTML into separate `add_blocks` calls. That fix is wrong for the actual data model. BlockNote parses every `<li>` as its own top-level block (verified by running `tryParseHTMLToBlocks` against `<ul><li>1.1</li><li>1.2</li><li>1.3</li></ul>` → 3 blocks of type `bulletListItem`). A 100-item list would force 100 array entries in `add_blocks`, or 100 separate calls. Option A's prompt language also leaks back into the Agent as "every `<li>` is its own block, so split everything." Both outcomes are worse than the original silent-drop bug.

## Change

Switch to block-surgery that expands. `update_block`'s slot can be replaced with one or more containers; the first keeps the original block id (so anchored Comments on that block survive the same way they do today), additional containers get fresh ids and slot in right after. `add_blocks` likewise accepts multi-block HTML per array entry — each entry expands into one or more containers, all get fresh ids.

Concretely:

1. **`apps/console/server/plan/block-html.ts`** — delete `htmlToBlock` (singular, takes `[0]`), delete `htmlToPmBlockContainer` (singular), delete `MultipleTopLevelBlocksError`. Add `htmlToPmBlockContainers(html): Promise<PmBlockContainer[]>` that returns all top-level containers. Throws `InvalidPlanBodyError` on zero blocks (the silent-substitute-empty-paragraph fallback is the same foot-gun, just at a different edge).

2. **`apps/console/server/plan.ts`** — drop `toSinglePmBlock`, drop the `MultipleTopLevelBlocksError` import. `updateBlock` calls `htmlToPmBlockContainers`, splices `[idx, 1, ...containers]` with the first container's id pinned to the original `blockId`, rest get `randomUUID()`. `addBlocks` flattens each entry's containers, all get fresh `randomUUID()`s, splices at the insert point. `deleteBlock`'s `<p></p>` last-block path calls the new plural and takes `[0]` (known-good HTML, one block guaranteed).

3. **`apps/agent/src/mcp-server.ts`** — `tempo_update_block` description: explain that the HTML may parse to one or more top-level blocks; the first replaces the slot (id preserved so anchored Comments survive), the rest insert right after with new ids. `tempo_add_blocks`: each entry may parse to multiple blocks; return ids count may exceed entry count.

4. **`apps/agent/src/prompts/system-prompt.ts`** — drop the "single top-level block" bullet I added earlier this session. Keep the vocabulary section, update the good/bad example to match the new reality (the Agent doesn't need to think about block boundaries — write HTML, the editor splits).

Wire shape (`UpdateBlockOutput`, `AddBlocksOutput`) is unchanged. `update_block` still returns `{ ok: true }`. The Agent can `tempo_pull_plan` if it needs the new ids; observed traffic doesn't require returning them inline. Less surface to lock in, easier to add later.

## Alternatives considered

- **Option A (reject multi-block — landed and being reverted):** throw `MultipleTopLevelBlocksError`. Doesn't fit BlockNote's data model — every `<li>` is its own block. Forces N entries for an N-item list. Bad ergonomics, confusing prompt language.
- **Option C (new `tempo_update_blocks` batch tool):** doesn't solve the multi-block-into-one-slot problem on its own — each entry's html still has the same question. Useful as a *future* atomic-batch convenience if observed traffic shows the Agent fanning out many sequential `update_block` calls. Not load-bearing for this bug fix.
- **Return inserted ids from `update_block`:** considered, rejected for now. Smaller blast radius without it; the Agent can `tempo_pull_plan` if it needs the ids. Revisit if observed.

## Uncertainties

- After multi-block expansion, the Agent doesn't immediately know the ids of inserted blocks. If a follow-up edit needs to address one, it must `tempo_pull_plan` first. Acceptable for v1; revisit if observed in real traffic.
- `htmlToPmBlockContainers` will throw on zero blocks. Whitespace-only HTML or HTML the editor strips entirely (e.g. `<script>` tags only, after sanitization) will fail at the contract boundary. That's the intended improvement over the current silent substitution to empty paragraph, but flag it: any caller that relied on the silent fallback will now see a 400. Search confirms only `htmlToPmBlockContainer('<p></p>')` in `deleteBlock` and the Agent-supplied HTML in `updateBlock` / `addBlocks` reach this path. `<p></p>` always yields one block; Agent HTML now correctly errors instead of silently emptying.

## Layer assignment

- `htmlToPmBlockContainers` → `apps/console/server/plan/block-html.ts` — same layer as the function it replaces. Pure HTML→PM container conversion, no DB / no event-log.
- `updateBlock` / `addBlocks` body changes → `apps/console/server/plan.ts` — same layer. Block-surgery on pm_json + persist.
- MCP tool descriptions → `apps/agent/src/mcp-server.ts` — existing location.
- System prompt → `apps/agent/src/prompts/system-prompt.ts` — existing location.

No new files. Every change is in the file that already owns the responsibility.

## Deletion test

- `htmlToPmBlockContainers`: if deleted, multi-block expansion vanishes and we're back to silent-drop. Required by the new contract.
- No new helper layers. `toSinglePmBlock` and `MultipleTopLevelBlocksError` (added in Option A) are deleted; the deletion test for *adding them again* is "where would the complexity reappear?" — nowhere. They were a workaround for a misdiagnosed fix.

## What stays from earlier this session

- The sanitization of internal `InvalidPlanBodyError` messages (`pm_json must be…` → `plan body must be…`, `not a BlockNote doc…` → `plan body is malformed`) stays — independent of Option A vs B, and protects the `e.message` passthrough.
- Routes passing `e.message` for `InvalidPlanBodyError` stays — still surfaces the new zero-block error usefully.
- The "Speak in Tempo's vocabulary" section in the system prompt stays — independent of Option A vs B.
- The "BlockNote blocks" → "Plan blocks" scrubs in MCP tool descriptions stay.

## Destructive action

None.
