# Plan — alert / callout block (lift from BlockNote example 06-custom-schema/05-alert-block-full-ux)

**Date:** 2026-06-08
**Branch:** feat/blocknote (or a fresh `feat/alert-block` cut from it once `feat/blocknote` lands on `main`)

## Problem

Plans grow rhetorical structure naturally — "Decision", "Warning", "Note". Today the Dev approximates these with bold text or a leading emoji; nothing renders semantically and the Agent has no canonical block to write into. The `docs/blocknote-extensions-shortlist.md` ranks "alert block full UX" as #5 with a near-mermaid lift cost. This plan picks that up.

The upstream example wires three surfaces, not just the spec:
1. The block itself (`createReactBlockSpec`) with a four-way variant prop (warning / error / info / success) and a Mantine `Menu` icon swap inside the block.
2. A **custom slash-menu item** — "/alert" inserts a warning by default at the cursor.
3. A **custom block-type-select** entry — the toolbar dropdown lets the Dev convert an existing paragraph into an alert.

Two of those three surfaces (slash, block-type-select) are net-new to Tempo. Mermaid only needed the block spec because it parses from `<pre><code class="language-mermaid">` — there is no comparable HTML hook for alerts, so the slash-menu / block-type-select surfaces are how Devs get one into a Plan.

## On "block store / block factory" — pushing back

The Dev's resume note said this is a good time to introduce a block-store / factory architecture. I disagree, and the disagreement matters before the judge runs.

CLAUDE.md is explicit: **"One adapter is hypothetical. No factories, no DI, no `interface I…` / `class …Impl` invented for a future second implementation."** Mermaid is one. Alert would be two. Two is not yet the threshold where a registry pays for itself — both blocks still cost exactly one line per schema file (`mermaidDiagram: mermaidBlockServer()` / `alert: alertBlockServer()`). The factory would replace those one-liners with a list, save *zero* lines of schema code, and add a new module that future readers have to learn before they can register a third block.

The real future cost is **not** the schema entries. It is the **UX integration surface** the alert example forces us to confront: slash-menu items, block-type-select items, and (per shortlist candidate #1) drag-handle menu items. Those grow linearly per block and live in the editor mount file. Three or four blocks in, that surface starts to dominate `plan-editor.tsx`.

The right move on this plan is therefore:

- **No registry, no factory, no store.** Each block stays self-contained as a trio (`<name>-block-shared.ts` + `<name>-block.tsx` + `<name>-block.server.ts`), matching mermaid byte-for-byte.
- **Lift the UX-integration helpers (slash menu item, block-type-select item) into the same trio** as small functions exported from `<name>-block.tsx` (client only — they import React). The schema-mount file imports and aggregates them with `[...mermaid.slashItems, ...alert.slashItems]` and `[...mermaid.blockTypeItems, ...alert.blockTypeItems]`. That is a *list literal*, not a registry — there is no map, no lookup, no plugin contract.
- **Re-evaluate when we add the third or fourth block.** If the list-literal-in-the-mount-file pattern still reads cleanly, leave it. If `plan-editor.tsx` is starting to look like a manifest, refactor *then* into a `blockContributions` array exported from each trio. That refactor is ~30 LOC and only worth doing when we have evidence it pays — not now.

This pushback is itself the Alternatives Considered section (option A vs B below). The judge can override.

## Smallest concrete change

1. **`apps/console/lib/blocks/alert-block-shared.ts`** — `ALERT_BLOCK_TYPE`, `ALERT_PROP_SCHEMA` (`type` enum + `defaultProps.textAlignment` + `defaultProps.textColor`), `ALERT_CONTENT = 'inline'`. Mirror of `mermaid-block-shared.ts`.

2. **`apps/console/lib/blocks/alert-block.tsx`** — `createReactBlockSpec` with:
   - `render`: a `<div className="bn-alert-block">` wrapping an icon button (opens a Mantine `Menu` to switch variant) and a BlockNote `InlineContent` slot. Icons from `lucide-react` (already a dep — `AlertTriangle`, `XCircle`, `Info`, `CheckCircle2`) rather than `react-icons/md` from the upstream example so we don't add a dep.
   - `toExternalHTML`: emits `<div class="alert alert-{type}">…inline html…</div>` so the Agent's HTML stays human-readable and the parser claims it back.
   - `parse`: claims `<div class="alert alert-{warning|error|info|success}">` and reads the type from the class.
   - Also exports `alertSlashItems(editor)` (one item per variant — "Warning callout", "Error callout", "Info callout", "Success callout") and `alertBlockTypeItems` (same four entries for the toolbar dropdown). Both follow `getDefaultReactSlashMenuItems` / `blockTypeSelectItems` shapes from `@blocknote/react`.

3. **`apps/console/lib/blocks/alert-block.server.ts`** — vanilla `createBlockSpec` with the same `type`/`propSchema`/`content`/`parse`/`toExternalHTML`. No render. Mirror of `mermaid-block.server.ts`.

4. **`apps/console/lib/plan-schema.ts`** (edit) — register `alert: alertBlockServer()` alongside the existing `mermaidDiagram` line. No factory; just one more entry.

5. **`apps/console/lib/plan-schema-client.ts`** (edit) — register `alert: alertBlock()` alongside `mermaidDiagram`.

6. **`apps/console/components/thread/editor/plan-editor.tsx`** (edit) — three additive touches:
   - `slashMenu={false}` on `<BlockNoteView>` to disable the default slash menu.
   - Add a `<SuggestionMenuController triggerCharacter="/" getItems={...}>` that calls `filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...alertSlashItems(editor)], query)`. Future blocks append their `slashItems` to the literal.
   - Add a `<FormattingToolbarController formattingToolbar={...}>` whose toolbar renders `<BlockTypeSelect items={[...blockTypeSelectItems(editor), ...alertBlockTypeItems]} />` alongside the rest of the default toolbar. Future blocks append.

7. **`apps/console/app/globals.css`** (edit) — four scoped style blocks for `.bn-alert-block.alert-warning|error|info|success` (border / background / icon color). Match the visual language of `apps/console/DESIGN.md` (Linear-derived; muted palette, no high-contrast banners).

8. **`apps/agent/src/mcp-server.ts`** (edit) — add a one-sentence alert mention to the descriptions of `tempo_update_plan`, `tempo_update_block`, and `tempo_add_blocks`, mirroring the existing mermaid sentence in each. Without this the Agent does not know the `<div class="alert alert-{warning|error|info|success}">…</div>` wrapper is a canonical block; round-trip rewrites would silently strip the variant class. Three edits, one sentence each.

No `@tempo/contracts` change (HTML wire format is unchanged — the Agent emits `<div class="alert alert-warning">…</div>` via `tempo_update_block` and the parser claims it). No DB migration.

## Layer placement

| File | Layer | Role |
|---|---|---|
| `apps/console/lib/blocks/alert-block-shared.ts` (new) | shared block schema | type / propSchema / content constants — imported by client + server specs |
| `apps/console/lib/blocks/alert-block.tsx` (new) | UI | React block spec + slash-menu items + block-type-select items (all client) |
| `apps/console/lib/blocks/alert-block.server.ts` (new) | server-safe block schema | Vanilla spec for `ServerBlockNoteEditor` in `server/plan/block-html.ts` |
| `apps/console/lib/plan-schema.ts` (edit) | shared schema | One new entry under `blockSpecs` |
| `apps/console/lib/plan-schema-client.ts` (edit) | shared client schema | One new entry under `blockSpecs` |
| `apps/console/components/thread/editor/plan-editor.tsx` (edit) | UI mount | Wire SuggestionMenuController + FormattingToolbarController; aggregate slash + block-type items via list literals |
| `apps/console/app/globals.css` (edit) | UI | Four `.bn-alert-block.alert-{variant}` styles |
| `apps/agent/src/mcp-server.ts` (edit) | Agent MCP surface | Mirror mermaid sentence in three tool descriptions so the Agent preserves the variant class on rewrites |

Rule-19 check: no DB queries, no business rules, no route handlers touched. All edits live in `apps/console/lib/blocks/**`, `apps/console/lib/plan-schema*.ts`, and the editor mount UI.

## Deletion test

- **`alert-block-shared.ts` / `alert-block.tsx` / `alert-block.server.ts`** — if deleted in six months: `<div class="alert alert-warning">…</div>` in stored PM JSON would fail to parse back into the editor (no spec claims the element), and BlockNote would fall back to a `paragraph` or drop the wrapper. Devs lose the variant; the Agent's tool description loses a documented block type. The "what is a callout in a Plan" knowledge has a single owner per file. Real module.
- **Slash-menu / block-type-select wiring in `plan-editor.tsx`** — if deleted: the alert block still exists, still parses incoming HTML, still renders. Devs lose the discoverable insertion path; the Agent can still author them via `tempo_update_block`. Real module, but smaller blast radius than the spec itself.
- **`bn-alert-block` CSS** — if deleted: the block renders unstyled. Trivially recoverable from `globals.css` history.

## Alternatives considered

- **A. Lift block + UX integration as proposed.** Chosen. Mirrors mermaid's trio shape; adds the slash / block-type surfaces because that is what makes the block *discoverable* (mermaid hides behind the codeBlock parse path, alert has no such hook). Each block stays a self-contained directory citizen. List literals in `plan-editor.tsx` aggregate UX contributions.
- **B. Introduce a `blockContributions` registry (the Dev's first instinct).** Rejected for now per CLAUDE.md "one adapter is hypothetical". Two blocks = two entries in a list; a registry buys nothing yet and is one more thing a reader has to learn. Re-open this when adding the third block if the list literals are getting unwieldy.
- **C. Spec only, no slash / block-type-select integration.** Rejected. Without an insertion affordance the block is undiscoverable for the Dev and the Agent has to be taught a brand-new HTML wrapper before either can use it. The upstream example bundles UX for a reason.
- **D. Use the upstream example verbatim (Mantine Menu icon swap, `react-icons/md`).** Rejected on the icon-library piece — we already ship `lucide-react`, and `react-icons` is a 1+ MB package we'd be opting into for four glyphs. Mantine `Menu` is fine because `@blocknote/mantine` already pulls it in.

## Uncertainties

To resolve before promoting (or in the playground at `apps/console/app/playground/alert/page.tsx` if iteration warrants — judge call):

1. **`InlineContent` rendering inside a flex/grid container.** The upstream example wraps the variant icon and the inline content side-by-side. Need to confirm BlockNote's `InlineContent` slot keeps the editor caret working when nested inside our flex layout. If it doesn't, fall back to icon-above-text.
2. **`FormattingToolbarController` interaction with `comments={false}`.** Our `BlockNoteView` already passes `comments={false}` (we ship our own gutter). Need to confirm a custom `FormattingToolbarController` does not re-enable BlockNote's comment chrome inside the toolbar (the comment-button shows up in some toolbar variants).
3. **`SuggestionMenuController` triggerCharacter conflict.** The CommentsExtension is mounted with `triggerCharacter` for mentions in some configs (we don't use mentions today). Need to confirm two `SuggestionMenuController`s with different triggers (`/` for slash, none for now) don't fight for the same Floating UI portal root.
4. **Server-side parse cost.** `block-html.ts` already round-trips PM JSON through `ServerBlockNoteEditor`. Adding one more block spec is additive; need to confirm the vanilla `createBlockSpec` does not pull `@blocknote/react` transitively (one of the existing AGENTS.md "Spotted but not fixed" notes flagged a bare `document` reference in `mermaid-block.server.ts` — verify alert's server spec stays node-clean).
5. **Block-type-select item ordering.** Default items + four alert variants = a 4-item growth in the toolbar dropdown. Visual judgement call whether to group alerts under a sub-heading or interleave. Default to interleave; revisit if the dropdown gets tall.

## Tasks

1. Confirm `lucide-react` is already on the console workspace (check `apps/console/package.json`). If not, swap to whatever icon source we already ship — do not add `react-icons`.
2. Implement the trio (`alert-block-shared.ts`, `alert-block.tsx`, `alert-block.server.ts`) following mermaid's file shapes exactly.
3. Register in `plan-schema.ts` and `plan-schema-client.ts` — one line each.
4. Wire `SuggestionMenuController` and `FormattingToolbarController` in `plan-editor.tsx`. List literals; no registry.
5. Add the four CSS variants to `globals.css`, matched to `apps/console/DESIGN.md` palette.
6. Manual exercise: insert via slash → variant swap via in-block menu → convert paragraph via block-type-select → round-trip through `tempo_pull_plan`/`tempo_update_block` (PM JSON ↔ HTML).
7. Run `code-simplifier:code-simplifier` and `everything-claude-code:code-reviewer` in parallel before commit. Address findings; do not skip per CLAUDE.md.

## Out of scope

- **Block-contributions registry.** Punted until we add the third custom block (see "On block store / block factory" above).
- **Drag-handle menu items per shortlist #1.** Different surface, different brief. Don't bundle.
- **Dark-mode variants.** Tempo has no dark mode today (per shortlist's `04-theming` skip note). Single light palette for now.

## Destructive actions

None. No `git push`, no DB migration, no external messages, no force-push, no dep removal. New deps: none (relies on existing `lucide-react` + `@blocknote/mantine`'s bundled Mantine).

## Vocabulary check

- "Block" — BlockNote vocabulary, fine to use.
- "Spec" — BlockNote API surface (`createReactBlockSpec`, `createBlockSpec`). Used in the BlockNote sense only; no architectural meaning.
- "Trio" — informal shorthand for "shared.ts + .tsx + .server.ts" file group. Not introducing as a project-vocabulary noun; using it once in this plan for clarity.
- "Registry / factory" — discussed only to reject. Not introduced.
- No drift into "component / service / API / boundary" for architecture (CLAUDE.md vocabulary discipline).
