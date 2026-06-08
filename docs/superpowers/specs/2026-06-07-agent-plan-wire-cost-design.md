# Spec — Agent Plan-wire cost (per-block HTML CRUD)

**Date:** 2026-06-07
**Author:** Claude (main thread)
**Status:** Awaiting judge

## Problem

After the `plan-comments-redesign` PR landed (specs/2026-06-07-plan-comments-redesign-design.md), the Agent's `tempo_pull_plan` → edit → `tempo_write_plan` cycle runs ~10× slower than it did under the previous Markdown wire. Two observable symptoms:

1. The Agent reaches for **Python / jq scripts** to mutate the document before writing it back. It treats the Plan as a data structure to manipulate, not as text to edit.
2. The Dev can feel the latency; what used to be one turn now takes several.

### Measured root cause (verified on a real Plan in `apps/console/data/tempo.db`)

| Format | Bytes (30-block plan) | Ratio |
|---|---|---|
| ProseMirror JSON (today's wire) | 52,049 | 12.0× |
| HTML via `blocksToHTMLLossy` | ~6,800 | 1.6× |
| Markdown | 4,349 | 1.0× |

29% of the PM JSON bytes are pure structural noise — `attrs:{textColor:"default",backgroundColor:"default",textAlignment:"left"}` and `marks:[]` on every node, repeated for every text run. The LLM has to parse, re-emit, and preserve this noise per the current tool description.

The tool descriptions are the second half of the bug. `apps/agent/src/mcp-server.ts:47,57` explicitly instructs the model:

> "ON EVERY TEXT NODE YOU DO NOT INTEND TO REWRITE, KEEP THE `marks` ARRAY EXACTLY AS YOU FOUND IT — dropping it orphans the Dev's Comment."

That defensive instruction is what pushes the model to scripted JSON mutation. It cannot be edited away while the wire format is whole-doc PM JSON — the instruction is structurally necessary for that wire shape.

### What changed between then and now

The `plan-comment-gutter.tsx` rail (added in the same redesign) walks the doc each render and surfaces every Comment whose anchor is missing as an **orphan icon**. Dropped comment marks no longer vanish silently — they appear in a dedicated Orphaned section. This changes the cost-benefit on any design that lets edited-block comments lose their mark: the Dev sees the orphan and decides what to do with it.

## The smallest concrete change

Adopt BlockNote `xl-ai`'s default architecture: **per-block CRUD over HTML**, keyed by stable block IDs. The Agent never sees the whole document as one blob.

### MCP surface

Replace today's 2 tools with 4:

```
tempo_pull_plan()
  → { blocks: [{ id: "abc$", html: "<p>...</p>" }, ...], cursor?: "after:xyz$" }

tempo_update_block(id, html)
  → { ok: true }

tempo_add_blocks(reference_id, position, blocks: string[])
  → { ok: true, ids: [...] }

tempo_delete_block(id)
  → { ok: true }
```

IDs are the existing BlockNote `attrs.id` UUIDs (already present in the stored PM JSON), suffixed with `$` on the wire so the model treats them as opaque tokens (BlockNote's published trick — without the suffix the model "improves" them).

### Server-side flow

- DB at-rest format stays **PM JSON**. No migration, no Dev-side change.
- Single new module `apps/console/server/plan/block-html.ts` wraps `@blocknote/server-util`'s `ServerBlockNoteEditor` and exposes two functions: `blockToHtml(block)` and `htmlToBlock(html)`. jsdom is contained inside this file.
- `apps/console/server/plan.ts` grows four new orchestrators (`getPlanBlocks`, `updateBlock`, `addBlocks`, `deleteBlock`) that read the PM JSON, apply the requested mutation in BlockNote-block space, and write the PM JSON back. Existing `getPlan` / `writePlan` stay as the Dev-side path.
- Four new thin route files under `apps/console/app/api/threads/[id]/plan/blocks/`.

### What it buys us

- **Wire cost per Agent operation drops from ~52 KB (whole doc) to ~200-2000 bytes** (one block, sometimes two or three for adds).
- **Comments on untouched blocks survive losslessly** — the LLM never sees them, can't mutate them.
- **Comments on edited blocks may become orphans** — the gutter handles this case.
- **The MCP tool descriptions get drastically simpler.** "Replace this block's content with this HTML." No `marks` array gymnastics. The script-writing mental model goes away.
- **Symmetric with BlockNote upstream.** Future BlockNote updates that change the HTML format land for us without rework.

## Alternatives considered

### A. Strip defaults server-side (baseline mitigation)

Strip `{textColor,backgroundColor,textAlignment}:"default"`, empty `marks:[]`, empty `styles:{}` from the PM JSON before sending to the Agent; reinflate on write.

- **Win:** ~29% wire reduction (52 KB → 37 KB). No contract change.
- **Why not on its own:** Doesn't fix the mental model. The Agent still sees PM JSON, still scripts over it, still slow. 29% is not 10×.
- **Compatibility:** Orthogonal to the chosen design. Could ship alongside, but with per-block HTML the per-call payload is already small enough that this becomes irrelevant.
- **Verdict:** Skip. Doesn't earn its file.

### B1. Markdown both ways (per-block CRUD, Markdown wire)

Same shape as the chosen design but Markdown instead of HTML per block.

- **Win:** Smallest wire (~1.0× content). Most LLM-fluent format.
- **Loss:** Lossy on any custom block. We have one custom mark today (`permissiveCode` in `apps/console/lib/plan-schema.ts:43-46`) — Markdown handles inline code, so this is fine for now. But it's brittle: the day a real custom block lands (mermaid, file attachments), Markdown silently downgrades it.
- **Implementation:** Same two-package dependency (`@blocknote/server-util` for `blocksToMarkdownLossy` + `tryParseMarkdownToBlocks`). Same one new server file.
- **Verdict:** Rejected. The wire-size delta vs HTML is ~200 bytes per block. Not worth the lossiness for future-proofing.

### B2. Markdown pull, PartialBlock JSON write (asymmetric)

Pull gives Markdown for LLM fluency; the Agent emits PartialBlock JSON for writes; server splices directly without a Markdown parser.

- **Win:** Only one parser (`blocksToMarkdownLossy`). Lossless on custom blocks.
- **Loss:** Asymmetric (read in one format, write in another) — the LLM has to context-switch. BlockNote upstream uses symmetric formats; we'd diverge. Also: PartialBlock JSON is the format prior art (Aider, JSON-Whisperer) showed is worst for LLMs; we'd reintroduce some of the JSON-noise problem on the write side.
- **Verdict:** Rejected. Saves one parser, costs symmetry with upstream and re-injects JSON on writes.

### B3. HTML both ways (chosen)

The BlockNote `xl-ai` default. Symmetric. Lossless. Wire cost 1.57× Markdown — measured, not assumed.

- **Win:** Closest to BlockNote upstream → free correctness improvements as they ship them. Lossless. Symmetric.
- **Loss:** Requires `@blocknote/server-util` (which pulls jsdom). One package, ~50 LoC of wrappers, ~17 MB unpacked jsdom (standard for server-side DOM work in Next.js).
- **Verdict:** **Chosen.** The 1.6× wire-size hit vs Markdown is paid back by symmetry with upstream and losslessness on future custom blocks.

### C. SEARCH/REPLACE over a Markdown projection (Aider shape)

One MCP tool taking unique-substring replace operations; server reconciles comment marks via context-matching after the round-trip.

- **Win:** Smallest tool surface (1 tool). LLM has the most pretraining on this pattern.
- **Loss:** **Comment-mark reconciliation is structural new code.** We'd be writing the algorithm BlockNote's `rebaseTool.ts` already wrote, without the benefit of PM steps to lean on. High depth in a new `reconcile-comment-marks.ts`. Fails the deletion test: deleting it would re-orphan comments, so the complexity must live somewhere.
- **Verdict:** Rejected. The complexity reappears if deleted; not worth it when B3 piggybacks on BlockNote's existing solution.

## Plan of work (the smallest path to working)

In dependency order:

1. **Contracts** (`packages/contracts/src/`):
   - `primitives.ts` — add `AgentBlock = { id: string; html: string }`. Add `AgentPlanBlocks = { blocks: AgentBlock[] }`. Change `AgentPlanState` (used by `tempo_attach`) to drop `pm_json` and hold only `{ status: PlanStatus; updated_at: string | null; updated_by: PlanActor | null }` — see §"`tempo_attach` and the Dev write path" below for why.
   - `mcp.ts` — update `PullPlanOutput` to wrap `AgentPlanBlocks`. Add `UpdateBlockInput` (`{ block_id: string; html: string }`), `AddBlocksInput` (`{ reference_id: string | null; position: "before" | "after" | "end"; blocks: string[] }`), `DeleteBlockInput` (`{ block_id: string }`). Each tool's output shape is `{ ok: literal(true) }` — no `warnings` field in MVP (see Uncertainty #6). Remove `WritePlanInput` from `mcp.ts`.
   - `http.ts` — **unchanged.** `WritePlanRequest` and `WritePlanResponse` (used by the Dev POST `/api/threads/[id]/plan`) stay as PM JSON. This spec touches only the MCP contract.

2. **Server, conversion module** (new file):
   - `apps/console/server/plan/block-html.ts` — instantiates `ServerBlockNoteEditor` against `planSchema`. Exports `blockToHtml(block: PartialBlock): Promise<string>` and `htmlToBlock(html: string): Promise<PartialBlock>`. The editor is constructed per call (the jsdom-construction cost is ~10-50ms, well under the request budget for a Plan edit).

3. **Server, orchestrators** (extend existing file):
   - `apps/console/server/plan.ts` — add `getPlanBlocks(threadId)`, `updateBlock(threadId, blockId, html, actor)`, `addBlocks(threadId, refId, position, htmlBlocks[], actor)`, `deleteBlock(threadId, blockId, actor)`. Each reads the stored PM JSON, locates the block by `attrs.id`, applies the mutation in BlockNote space (via the conversion module), writes back. Each appends a `plan_edited_by_agent` event the same way `writePlan` does today.
   - `getPlan` and `writePlan` stay for the Dev path. The Dev POST `/api/threads/[id]/plan` route is **unchanged** — it still takes `pm_json` per `WritePlanRequest` in `packages/contracts/src/http.ts`.

3a. **`tempo_attach` and the Dev write path:**
   - `apps/console/app/api/sessions/[id]/state/route.ts` builds `AttachOutput.plan` by calling `getPlan(threadId)` today, which returns `pm_json`. Under this spec, `AgentPlanState` no longer carries the body. Update the attach route to return only `{ status, updated_at, updated_by }` for the Plan field.
   - The Agent always calls `tempo_pull_plan` when it needs Plan content. Attach becomes a lightweight handshake; one extra round-trip is paid on the rare paths where the Agent immediately needs the Plan body, but the typical attach (status check, no Plan read) gets faster. This avoids running the jsdom-based conversion on the attach hot path.
   - The Dev write path stays as today: `WritePlanRequest`/`WritePlanResponse` in `http.ts`, `POST /api/threads/[id]/plan` calls `writePlan(threadId, pm_json, actor)`.

4. **Routes** (new files):
   - `apps/console/app/api/threads/[id]/plan/blocks/route.ts` — GET (read all blocks as HTML), POST (add blocks).
   - `apps/console/app/api/threads/[id]/plan/blocks/[blockId]/route.ts` — PUT (update), DELETE.

5. **Package dep**:
   - `bun add -F @tempo/console @blocknote/server-util` — pin to the same `0.51.4` already in use for `@blocknote/core`. jsdom comes as a transitive dep.
   - `apps/console/next.config.ts` — verify `'@blocknote/server-util'` is in `serverExternalPackages`. (It already is per `next.config.ts:13`; do not append a duplicate. Add `'jsdom'` to the same array if it is not already listed.)

6. **Agent client** (extend existing file):
   - `apps/agent/src/http-client.ts` — replace `getPlan` / `writePlan` with `getPlanBlocks`, `updateBlock`, `addBlocks`, `deleteBlock`.

7. **Agent MCP server** (replace existing tools):
   - `apps/agent/src/mcp-server.ts` — replace `tempo_pull_plan` / `tempo_write_plan` with four tools. New descriptions are short and prose-shaped: e.g. *"Update one block's content. Provide the block ID from `tempo_pull_plan` and the new HTML content for that block."* No marks-preservation instruction needed.

8. **Verification** (manual per "no tests in MVP"):
   - `bun run typecheck` — green.
   - Run a Thread end-to-end: open a Plan in the Console, attach a couple of Comments, invoke the Agent, ask it to edit a paragraph that has a Comment on it and a different paragraph that doesn't.
   - Confirm: untouched-paragraph Comment stays anchored; edited-paragraph Comment surfaces in the gutter's Orphaned section.
   - Confirm: Agent's edit completes in one turn, no Python / jq scripts produced.

## Layer placement

| File | New? | Layer | Justification |
|---|---|---|---|
| `apps/console/server/plan/block-html.ts` | New | `server/<domain>/` (utility within domain) | jsdom + BlockNote instantiation; isolated so the rest of `server/plan.ts` stays dependency-free. |
| `apps/console/server/plan.ts` | Extended | `server/<domain>/` | Business rules: read DB → mutate block → write DB → append event. Existing module. |
| `apps/console/app/api/threads/[id]/plan/blocks/route.ts` | New | Route handler | Thin: validate Zod input → call `plan.ts` → format response. |
| `apps/console/app/api/threads/[id]/plan/blocks/[blockId]/route.ts` | New | Route handler | Thin: same. |
| `packages/contracts/src/{mcp.ts,primitives.ts}` | Modified | Contracts | Zod schemas only. |
| `apps/agent/src/{http-client.ts,mcp-server.ts}` | Modified | Agent client + MCP surface | No new files. |

No new files in `apps/console/server/db-queries/`. The existing `db-queries/plans.ts` `readPlanRow` is what we need; mutations write through the existing `writePlan` path, no new DB-query helpers.

## Deletion test (per new file)

| File | If deleted in 6 months, where does the complexity reappear? |
|---|---|
| `apps/console/server/plan/block-html.ts` | Inline jsdom + `ServerBlockNoteEditor` setup in every plan-ops orchestrator (4 places) — strictly worse. The module pays for itself. |
| `apps/console/app/api/threads/[id]/plan/blocks/route.ts` | Combined into the existing `/plan/route.ts` with action-string dispatch — worse, because routes-are-thin convention breaks. The split pays for itself. |
| `apps/console/app/api/threads/[id]/plan/blocks/[blockId]/route.ts` | Same as above. |

No file in this plan exists "just in case" — each removes complexity that would otherwise be inlined into a busier file.

## Vocabulary check

- **Plan** — used as a product noun (CONTEXT.md). ✓
- **Comment** — used as a product noun. ✓
- **Agent** — the local Claude Code CLI. ✓
- **Dev** — the human user. ✓
- **Console** — the web app. ✓
- **block** — BlockNote's word (technical, editor-internal). Not promoted to a product noun.
- **module** / **depth** / **seam** — used per CONTEXT.md architecture vocabulary. ✓

No drift into "service", "component" (as architecture word), "API" (as architecture word), or "boundary". The "interface" word is not used.

## Uncertainties

1. **`tempo_add_blocks`'s `reference_id` shape.** BlockNote's xl-ai uses `{ referenceId: string, position: "before"|"after" }`. We adopt that verbatim. Open: should empty-plan insertion use a sentinel `referenceId: "_start"` or a separate tool? Defer — empty plans are rare; a `null` `reference_id` plus `position: "end"` semantics handle it.

2. **Per-call jsdom construction cost (~10-50ms).** Acceptable for Plan edits (not a hot path). If profiling later shows it matters, the documented escape hatch is a module-level `ServerBlockNoteEditor` singleton with a reset-between-uses pattern. Flag for future, not for this PR.

3. **Cursor field semantics.** xl-ai includes a cursor marker in its DocumentState (a `{cursor: true}` array element). We don't have a Dev cursor on the server side. Open: do we omit cursor entirely, or always send `cursor: null`? Defer — Agent doesn't use cursor today.

4. **HTML emitted by `blocksToHTMLLossy` vs roundtrip via `tryParseHTMLToBlocks` is not formally guaranteed lossless** in BlockNote's docs. xl-ai relies on it being effectively lossless because the LLM's output is also HTML that goes through the same parser. We inherit this assumption; if it bites us, it bites them too, and we get the fix when they do.

5. **Custom block claim.** The brief mentions `confluenceCodeBlock` as a custom block in `apps/console/lib/plan-schema.ts`. The local audit found no such custom block — only a `permissiveCode` mark workaround (Code extension with `excludes: ''` to coexist with the comment mark). Both Markdown and HTML round-trip inline code fine, so this doesn't affect the format choice. Flagging because the brief's framing of this file is wrong; if a real custom block lands later, HTML's losslessness becomes load-bearing.

6. **What happens when the LLM emits HTML that BlockNote's parser refuses.** Likely answer: the parsed result is an empty or sanitized block, the update lands, and the Dev sees a degraded block. **Decision for MVP:** tool output stays as `{ ok: literal(true) }`. No `warnings` field. The Agent discovers a degraded edit on the next `tempo_pull_plan` if it re-reads. If real-world use shows the Agent needs an in-band signal to self-correct, add a `warnings: string[]` field then; that's an additive contract change. Not adding it now keeps the contract small.

## Destructive actions

None.

- No DB migration. The PM JSON column stays.
- No package removal. (`@blocknote/server-util` is being **added** — not destructive.)
- No public-API breakage outside the Agent ↔ Console MCP boundary. The Console's `/api/threads/[id]/plan` (Dev path) is unchanged.
- The four new MCP tools fully replace the two old ones from the Agent's perspective. Old Agent versions in the wild would break — but the Agent ships out-of-tree as `tempo-agent connect <token>` and the Dev runs the same checkout. No production deploys to roll.

If the Dev wants to keep the old tools alongside the new ones during a transition window, that's a question for the implementation plan, not this spec.

## Summary

Per-block CRUD over HTML, IDs from BlockNote's own block UUIDs, server-side conversion via `ServerBlockNoteEditor`. Mirrors BlockNote `xl-ai`'s default architecture. One new package, one new server module, two new thin routes, four new MCP tools. Wire cost drops from ~52 KB per call to ~200-2000 bytes. Comments survive on untouched blocks structurally; orphan on edited blocks visibly (gutter). Tool descriptions become prose-shaped, removing the marks-preservation instruction that is the immediate cause of the script-writing behaviour.
