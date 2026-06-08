# Brief — the Agent's Plan-write turn is ~10× slower than it used to be

You are picking up cold. Read CLAUDE.md and AGENTS.md first; they're binding (judge gate, deletion test, vocabulary discipline, layer placement, destructive-action confirmation, code-simplifier + code-reviewer at the end).

## The problem the Dev is reporting

After the most recent landed work (the `plan-comments-redesign` PR — spec at `docs/superpowers/specs/2026-06-07-plan-comments-redesign-design.md`, plan at `docs/superpowers/plans/2026-06-07-plan-comments-redesign.md`), the Agent's `tempo_pull_plan` → edit → `tempo_write_plan` cycle has become noticeably slow. Concretely:

- One Plan edit that used to take a turn now takes ~10×.
- The Agent reaches for **scripts (Python / jq)** to mutate the document before it writes it back. It treats the Plan as a data structure to manipulate, not as text to edit.
- The Dev can feel it; they want it back to a "feels fast" interaction without giving up the property the redesign bought.

## Why this happened (just enough context to orient — verify everything)

The redesign switched the Agent wire format from **annotated Markdown** to **ProseMirror JSON** (the editor's at-rest format). That fixed the real bug it was meant to fix: BlockNote's `comment` mark is declared `blocknoteIgnore: true`, so a Markdown round-trip used to silently strip every Dev-anchored Comment on every Agent write. Comments now survive.

The cost the redesign acknowledged but did not yet address: PM JSON is materially noisier than Markdown for the same content, and the model's behaviour with structured-data tools is qualitatively different from its behaviour with prose — it stops editing in-place and starts writing scripts. Both are listed as "Uncertainty #1" on the spec.

The safety net we now have that we did not have at spec time: the right-side **comment gutter** (`plan-comment-gutter.tsx`) renders an icon for every Comment whether or not its anchor is still in the doc. A Comment whose `comment` mark gets dropped does not vanish — it appears in an "Orphaned" section. The Dev sees it, can open the card, reply, resolve, or delete. This changes the cost-benefit on any alternative that drops comment marks on edited regions.

## Your job

Produce a spec, get judge approval, then produce an implementation plan. Same workflow CLAUDE.md describes for any non-trivial change.

Do not implement yet. The Dev will hand the plan to a third session to execute.

## What to investigate before proposing

These are open questions — answer them by reading code, fetching docs, and measuring. Do not assume the previous spec's "Alternatives considered" section is still right; it was written before we had the gutter and before we had real cost data.

1. **Measure the actual cost.** How big is a typical Plan in PM JSON tokens, and how does that compare to the same plan in Markdown? Where is the noise coming from — defaults that the editor re-fills on parse, or genuinely necessary structure? A cheap mitigation may exist (server-side strip of `attrs: {textColor: "default", backgroundColor: "default"}`, empty `styles: {}`, empty `marks: []`, etc.) without changing the wire shape at all. Measure before/after if you try it.

2. **Look at how BlockNote AI solves the same problem.** Open-source, ships in `@blocknote/xl-ai`. The relevant source is on GitHub under `packages/xl-ai/src/`:
   - `api/formats/` — they ship multiple document representations (HTML, Markdown, blocks JSON). Each one is a `getStreamToolsProvider` + `systemPrompt` + `documentStateBuilder`.
   - `api/formats/base-tools/` — the three core operations: `createAddBlocksTool.ts`, `createUpdateBlockTool.ts`, `delete.ts`.
   - `streamTool/` — the streaming-tool abstraction that lets a single LLM tool call wrap many operations and apply them incrementally.
   - `prosemirror/` — the "rebase tool" that translates the LLM's per-block output back into ProseMirror steps that touch only that block.
   Read enough of this to understand the shape of their design — what the LLM sees, what it emits, how untouched blocks are physically absent from the payload, and how block IDs are kept stable across calls.

3. **Reconsider Alternative B** ("per-block MCP operations") from the original spec. It was rejected because it could silently drop `comment` marks on edited blocks. Re-evaluate that rejection in light of the gutter. Is the failure mode now "the Dev sees an orphan icon and decides what to do"? Or is something else broken?

4. **Reconsider Alternative D / E / others** if you think of better shapes. The constraint is: Comments anchored to text the Agent **does not** edit must survive. Comments anchored to text the Agent **does** edit may surface as orphans (the gutter handles that), but should not vanish.

5. **Wire-format design.** If you propose per-block ops, decide what each block's content looks like on the wire (Markdown? HTML? PartialBlock JSON?). Tradeoffs: model fluency (Markdown >> HTML > JSON), losslessness for custom block features (`confluenceCodeBlock` mermaid in `apps/console/lib/plan-schema.ts`), and token cost.

6. **MCP tool surface.** How many tools, named what, with what parameter shapes. Each MCP tool ≈ one HTTP endpoint per existing convention. Check `packages/contracts/src/mcp.ts` for the current surface and how to extend it.

7. **Server-side decoding.** If block content arrives as Markdown, you need to parse it back into BlockNote blocks server-side. We deleted `@blocknote/server-util` and the `server/plan/{encode,decode,reconcile-ids,server-editor}.ts` files in the previous PR; bringing any of that back is a real cost — justify it explicitly if you do. Alternatives: parse on the client during a Dev-side reconciliation step, or accept blocks-JSON on the wire from the Agent and skip the server-side Markdown parser.

## Constraints and conventions

- **No new tests in MVP** (CLAUDE.md "no tests in MVP"). Verification is typecheck + Pino logs + manual exercise.
- **Bun, Biome, TypeScript strict.** No npm/yarn/pnpm, no ESLint, no Prettier.
- **Vocabulary** — use the words in CONTEXT.md (Plan, Comment, Reply, Agent, Dev, Console, Thread). For architecture: module / interface / implementation / depth / seam / adapter / leverage / locality.
- **Deletion test for every new file.** "If we deleted this in six months, would its complexity reappear?" If no, it shouldn't exist.
- **One adapter is hypothetical.** No factories, no DI, no `interface I…` invented for a future second implementation. The spec you write should make this explicit per new file.
- **Layer placement (rule 19).** DB queries in `apps/console/server/db-queries`. Business rules in `apps/console/server/<domain>`. Route handlers are thin: validate → call server module → return.
- **Don't drive-by.** Don't touch unrelated code. File anything you spot under AGENTS.md → "Spotted but not fixed".
- **Show options before acting on non-trivial choices.** 2–3 approaches with tradeoffs in the spec's "Alternatives considered" section.
- **Destructive actions need explicit Dev approval.** No DB column drops, no published-package changes, no force-pushes without a quoted Dev acknowledgment in the spec.
- **Judge agent runs before any code is written.** Iterate the spec until APPROVED.
- **code-simplifier + code-reviewer per commit** (the Dev caught this being skipped on the previous PR — don't repeat that). Run them before each commit on what's being committed, not in a batch at the end.

## Key files in the current state

Read these to understand what's in place today before you propose changes:

- `apps/agent/src/mcp-server.ts` — the MCP tool descriptions the Agent's LLM sees. The current `tempo_pull_plan` and `tempo_write_plan` descriptions tell it to preserve every `marks` array. That's the prompt that is producing the script-writing behaviour.
- `apps/agent/src/http-client.ts` — `getPlan` / `writePlan` shapes (currently PM JSON in/out).
- `apps/console/server/plan.ts` — orchestrator for Plan read/write. The current `getPlan` is what the Agent route returns; there is no longer a separate `getPlanForAgent`.
- `apps/console/app/api/threads/[id]/plan/route.ts` — unified Dev + Agent endpoint.
- `apps/console/server/db-queries/plans.ts` — DB read helper.
- `apps/console/lib/plan-schema.ts` — the BlockNote schema (custom block `confluenceCodeBlock` lives here; do not let any new design silently drop it).
- `apps/console/components/thread/editor/plan-editor.tsx` — editor mount.
- `apps/console/components/thread/editor/plan-comment-gutter.tsx` — the orphan-aware rail. This is the safety net that changes the cost-benefit on dropping marks.
- `apps/console/components/thread/editor/comment-thread-bridge.ts` — `ThreadStore` impl backed by the existing comment REST endpoints.
- `packages/contracts/src/mcp.ts` and `packages/contracts/src/primitives.ts` — current wire contracts.

## Deliverable

A spec at `docs/superpowers/specs/2026-06-07-agent-plan-wire-cost-design.md` (or your own date if you take this over a session boundary), then judge approval, then a plan at `docs/superpowers/plans/<date>-agent-plan-wire-cost.md`.

The spec should at minimum:

- State the problem (10× slowdown, scripts) with whatever measurements you took.
- Propose the smallest concrete change.
- 2–3 alternatives with tradeoffs.
- A non-empty Uncertainties section (verify against installed packages on disk, not from memory).
- Layer placement table for any new files.
- Deletion test for each one.
- Vocabulary check.
- Destructive-actions section with quoted Dev acknowledgment for anything destructive.

Do not skip the judge. Do not pre-commit to per-block ops or any other shape — explore first, justify whatever you land on against the alternatives you actually considered.
