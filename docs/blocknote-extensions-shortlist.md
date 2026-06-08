# BlockNote extensions — shortlist for Tempo

Survey of the upstream examples at <https://github.com/TypeCellOS/BlockNote/tree/main/examples>, filtered for relevance to Tempo's Plan editor. Captured 2026-06-08 after the BlockNote-replaces-Tiptap + `mermaidDiagram` block landed (commit `3d5633f`).

The Plan editor today: BlockNote (mantine theme) with a custom `mermaidDiagram` block, the `comment` mark from `@blocknote/core/comments`, a permissive `code` style (workaround for upstream [#2795](https://github.com/TypeCellOS/BlockNote/issues/2795)), and an anchored-comments gutter outside the editor's React tree.

Each entry below is a *pointer* — read the upstream example before lifting. None of these are committed work; they're candidates for future briefs.

## Lift-first candidates

| # | Upstream example | What it gives us | Why it fits Tempo |
|---|---|---|---|
| 1 | `03-ui-components/05-side-menu-drag-handle-items` | Custom actions in the drag-handle menu (per-block) | Natural home for "Add comment", "Mark resolved", "Convert to mermaid" against a hovered block. The gutter handles the *reading* side of comments; the drag-handle menu is the missing *authoring* shortcut. |
| 2 | `03-ui-components/07-suggestion-menus-slash-menu-component` | Replace the default slash menu with a custom React component | A Plan-specific palette: mermaid, code block, requirement block, decision block. Keeps the slash menu from looking like a generic Notion clone. |
| 3 | `06-custom-schema/06-toggleable-blocks` | Collapsible/expandable section blocks via a `ToggleWrapper` | Plans grow long — "Detailed steps", "Alternatives considered", "Open questions" should collapse so the page-1 view stays scannable. |
| 4 | `06-custom-schema/02-suggestion-menus-mentions` | `@`-triggered inline mention chip with custom suggestion menu | Mention thread participants or link to other Plans / Threads inline; complements the existing `comment` mark rather than replacing it. |
| 5 | `06-custom-schema/05-alert-block-full-ux` | Callout / alert block with slash-menu + block-type-switch toolbar UI | Same pattern as our `mermaidDiagram`, with the added wiring for the block-type dropdown. "Note / Warning / Decision" callouts fit Plan rhetoric. |
| 6 | `03-ui-components/16-link-toolbar-buttons` | Custom buttons on the selection-context toolbar (link toolbar) | Surface a "Comment" or "Annotate" action right on the selection toolbar — same surface a Dev's cursor is already at. |

## Worth knowing about but lower priority

- **`06-custom-schema/03-font-style`** — custom inline style spec. Use case here would be semantic inline styles ("decision text", "TODO inline") rather than visual. Low priority until we have a real ask.
- **`06-custom-schema/08-non-editable-block`** — a block that the Dev can't edit. Useful for *frozen* post-approval Plans, but `editor.isEditable = false` at the editor level already handles approve-state read-only mode.
- **`04-theming/04-theming-css-variables`** — override BlockNote's CSS variables for theming. Relevant the day Tempo grows a dark mode, not before.
- **`03-ui-components/12-static-formatting-toolbar`** — anchored toolbar above the editor instead of selection-floating. UX call, not a feature gap.
- **`03-ui-components/01-ui-elements-remove`** — hide built-in UI elements (slash menu, side menu). Already partially used (we pass `comments={false}` to opt out of BlockNote's built-in comment chrome).

## Skip — not applicable

| Example bucket | Why we skip |
|---|---|
| `02-backend/` | Tempo persists pm_json itself; no use for BlockNote's backend helpers. |
| `05-interoperability/` (Markdown/HTML import-export round-trips) | We already implement parse + serialize at the schema level via `mermaid-block-shared.ts` and `permissive-code-style.ts`. |
| `07-collaboration/` (Yjs / Liveblocks) | Out of scope — Tempo is single-user MVP. |
| `09-ai/` | Tempo's AI runs in the Agent (separate process), not inside the editor. |
| `13-custom-ui/` (full Material UI swap) | We have our own Console design system; a wholesale UI swap is the opposite direction. |
| `08-extensions/` | Tiptap-flavored. BlockNote abstracts most extension shapes through its schema API; that's where we register the mermaid block already. |

## How to use this list

A real piece of work follows the project's existing path: write a brief in `docs/superpowers/briefs/`, get the `judge` agent's APPROVED verdict, then implement. The shortlist above is what to *consider*; the brief is what makes it real.

Suggested first sequence if we lift any of this:

1. **#1 + #2 (slash menu + drag handle menu)** — both are pure additive UI with no data-model risk. Together they're what makes the custom-block editor *feel* native to Tempo rather than tacked on.
2. **#3 (toggleable blocks)** — a real Plan-readability win; modest scope (one block spec + UI). Pairs well with #5 (alerts).
3. **#5 (alert / callout blocks)** — opens the door to "Decision", "Warning", "Note" semantic blocks that Plans tend to grow naturally.
4. **#4 (mentions)** — defer until we have a real second participant (today only the connected Dev exists).
