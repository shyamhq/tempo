# Plan — Promote `htmlBlock` from playground into the production Plan editor

**Date:** 2026-06-09
**Branch:** feat/blocknote
**Author:** Dev + Claude

---

## Problem

The `htmlBlock` lives in `apps/console/app/playground/html-block/` with its own throwaway schema. Rendering, resize, expand, source-toggle, and the sandboxed-iframe trust model all work. The block is not registered in `planSchema` / `planSchemaClient`, has no server-safe spec, no `parse` / `toExternalHTML`, no slash-menu entry, and the MCP tool descriptions do not document a wire format for it — so the Agent cannot produce one.

This plan promotes `htmlBlock` into the real product: register both schemas, add a server-safe twin, agree on a single HTML wire shape, replace the inline hex colors in the renderer with design-token classes, wire slash + block-type menus, update the MCP tool descriptions, and delete the playground.

## Smallest concrete change

Treat `htmlBlock` as the third member of the same pattern that already shipped for `mermaidDiagram` and `alert`. No new framework, no registry, no factory — just the third instance of the established triad: `*-shared.ts` + `*.tsx` + `*.server.ts`, registered manually in both schemas, slash items wired in `plan-editor.tsx`, MCP tool descriptions extended with a wire shape that mirrors how mermaid's fence is documented today.

**On the user's "store / factory" suggestion:** CLAUDE.md is binding — "no factories, no DI, no `interface I…` / `class …Impl` invented for a future second implementation." With three blocks the genuine repetition is *contract* (type / propSchema / parse), not *logic*, and that contract is already lifted into the per-block `*-shared.ts` files. A registry would still need a server descriptor and a client descriptor per block — it would relocate the duplication, not eliminate it. If schema-registration drift becomes a real bug pattern around block six, we revisit. **For now we register manually, like mermaid and alert.**

## Wire format

`<pre><code class="language-html-block">…escaped html…</code></pre>` — same code-fence shape mermaid already uses, with `language-html-block` instead of `language-mermaid`. Three reasons:

1. **Parse symmetry.** `parseHtmlBlockPre` is the same five-line check as `parseMermaidPre` — `<pre>` wrapping a `<code class="language-html-block">`. The Agent's MCP tool descriptions already advertise the mermaid fence; the html-block fence reads as the obvious sibling.
2. **`toExternalHTML` is correct by default.** Markdown export of an htmlBlock becomes a fenced code block of the source HTML — readable, copy-pasteable, never a nested iframe. (Resolves Uncertainty 4 in the prior plan.)
3. **`runsBefore: ['codeBlock']`** mirrors mermaid — the htmlBlock parse wins over the generic codeBlock for elements that carry the `language-html-block` class.

The `height` prop is NOT in the wire format. Agents emit only `html`; resize is a Dev-only persisted UI state. Server-safe render stores `{ html: textContent, height: 0 }` on parse; client renders persist `height` on resize via `editor.updateBlock`. PM JSON round-trips both props.

## Files

| Path | Change | Layer |
|---|---|---|
| `apps/console/lib/blocks/html-block-shared.ts` | **Edit.** Add `parseHtmlBlockPre(el)` matching the `<pre><code class="language-html-block">` shape (mirrors `parseMermaidPre`). Constants unchanged. | Shared contract |
| `apps/console/lib/blocks/html-block.tsx` | **Edit.** Add `parse` (calls shared parser), `toExternalHTML` (emits the `<pre><code class="language-html-block">` fence), `runsBefore: ['codeBlock']`. Keeps the `render` thin bridge to `HtmlRenderer`. | Schema (client) |
| `apps/console/lib/blocks/html-block.server.ts` | **New.** Vanilla `createBlockSpec` twin — stub `render` (jsdom-only), real `toExternalHTML`, real `parse`, `runsBefore: ['codeBlock']`. Mirrors `mermaid-block.server.ts` exactly. | Schema (server) |
| `apps/console/lib/blocks/html-renderer.tsx` | **Edit.** Replace inline hex (`#fff`, `#e5e7eb`, `#f8fafc`, `#374151`, shadow rgba) with Tailwind utility classes that resolve to design-token CSS vars (`bg-[color:var(--color-surface-1)]`, `border-[color:var(--color-hairline)]`, etc.). Functionality unchanged. The `pointerEvents` / `position` / measured pixel values stay inline — they're dynamic. | UI |
| `apps/console/lib/plan-schema.ts` | **Edit.** Register `htmlBlock: htmlBlockServer()` next to `mermaidDiagram` and `alert`. One added import, one added blockSpec key. | Server schema |
| `apps/console/lib/plan-schema-client.ts` | **Edit.** Register `htmlBlock: htmlBlock()` next to `mermaidDiagram` and `alert`. One added import, one added blockSpec key. | Client schema |
| `apps/console/lib/blocks/html-block.tsx` | (already covered above — adds `htmlSlashItem(editor)` and `htmlBlockTypeItem` exports matching the `alertSlashItems` / `alertBlockTypeItems` pattern) | Menu wiring contract |
| `apps/console/components/thread/editor/plan-editor.tsx` | **Edit.** Append `htmlSlashItem(editor)` to the slash-menu list and `htmlBlockTypeItem` to the block-type-select list — symmetric to how alert is wired today. | UI integration |
| `apps/agent/src/mcp-server.ts` | **Edit.** Extend the `tempo_write_plan`, `tempo_update_block`, `tempo_add_blocks` tool descriptions with a sentence: "For embedded HTML pages (design-system surfaces, interactive prototypes) emit `<pre><code class="language-html-block">…html…</code></pre>` — the Console renders these as a sandboxed iframe; without the `language-html-block` class they render as a plain code block." | Agent contract |
| `apps/console/app/playground/html-block/page.tsx` | **Delete.** Throwaway, scope-end. | — |
| `apps/console/app/playground/html-block/plan.json` | **Delete.** Throwaway, scope-end. | — |

Total: 7 files edited, 1 new (`html-block.server.ts`), 2 deleted (playground). No new directories.

## Design-token mapping (renderer)

| Today (inline hex) | After (Tailwind class → CSS var) |
|---|---|
| `background: '#fff'` | `bg-[color:var(--color-surface-1)]` |
| `border: '1px solid #e5e7eb'` | `border border-[color:var(--color-hairline)]` |
| toolbar button `background: 'rgba(255,255,255,0.92)'` | `bg-[color:var(--color-surface-1)]/95` |
| toolbar button `color: '#374151'` | `text-[color:var(--color-ink-muted)]` |
| source-mode `background: '#f8fafc'` | `bg-[color:var(--color-surface-2)]` |
| expand shadow `0 12px 32px rgba(15,23,42,0.12)` | `shadow-[0_12px_32px_rgba(15,23,42,0.12)]` (kept as bracketed arbitrary — DESIGN.md has no semantic shadow token yet) |

Dynamic styles (`position`, `top/bottom/left/right` during expand, `height: effectiveHeight`, `pointerEvents`) stay as inline `style` — they vary per render and aren't color/token concerns.

## Server spec details (`html-block.server.ts`)

Mirrors `mermaid-block.server.ts` byte-for-byte except for the constants and the `language-html-block` class:

- `render` returns a stub `<div class="bn-html-block">` (jsdom-only; never displayed).
- `toExternalHTML` emits `<pre><code class="language-html-block" data-language="html-block">{html}</code></pre>` — `textContent` carries the source HTML so the round-trip is text-safe.
- `parse` calls `parseHtmlBlockPre(el)`.
- `runsBefore: ['codeBlock']` so this rule claims the element before the generic codeBlock parser.

`parseHtmlBlockPre` shape — added to `html-block-shared.ts`:

```ts
export function parseHtmlBlockPre(el: HTMLElement): { html: string } | undefined {
  if (el.tagName !== 'PRE') return undefined;
  const code = el.querySelector('code');
  if (!code) return undefined;
  const hasClass = code.classList.contains('language-html-block');
  const hasAttr = code.getAttribute('data-language') === 'html-block';
  if (!hasClass && !hasAttr) return undefined;
  return { html: code.textContent ?? '' };
}
```

The shared parser is called from both client and server `parse` so they cannot disagree on what claims the element.

## Slash + block-type menu

In `html-block.tsx`, add two exports symmetric to `alertSlashItems` / `alertBlockTypeItems`:

- `htmlSlashItem(editor)` — single `DefaultReactSuggestionItem` with title "HTML block", aliases `['html', 'iframe', 'embed', 'prototype']`, group "Basic blocks", icon `Code2` from `lucide-react`. On click → `insertOrUpdateBlockForSlashMenu(editor, { type: HTML_BLOCK_TYPE, props: { html: '', height: 0 } } as PartialBlock<…>)`.
- `htmlBlockTypeItem` — single `BlockTypeSelectItem` with name "HTML block", same icon, same `props: { html: '', height: 0 }`.

Inserting an empty htmlBlock from the menu produces a 120px-tall empty iframe with the toolbar visible — the Dev can then paste source via the source-toggle once we add edit-source (separate plan; not in scope here). Today the human path is "Agent writes the HTML; the Dev's role is to read and resize." So a manual empty insert is rare but should not error.

`plan-editor.tsx` wires both:

```tsx
blockTypeSelectItems={[
  ...blockTypeSelectItems(editor.dictionary),
  ...alertBlockTypeItems,
  htmlBlockTypeItem,
]}
…
[...getDefaultReactSlashMenuItems(editor), ...alertSlashItems(editor), htmlSlashItem(editor)]
```

## MCP tool description update

Three `description` strings get one sentence appended (or merged into the existing "For Mermaid diagrams … For callouts …" cadence):

> "For embedded HTML pages (design-system surfaces, interactive prototypes) emit `<pre><code class=\"language-html-block\">…html…</code></pre>` — the Console renders these as a sandboxed iframe; without the `language-html-block` class they render as a plain code block."

No tool-name change, no input-schema change. The Zod schemas in `@tempo/contracts` for these tools currently take `html: string` arguments — unchanged.

## Round-trip sanity check

For an Agent call `tempo_add_blocks` with `<pre><code class="language-html-block"><h1>Hello</h1></code></pre>`:

1. Server route receives the HTML string.
2. `ServerBlockNoteEditor` (jsdom, uses `planSchema`) parses → `[{ type: 'htmlBlock', props: { html: '<h1>Hello</h1>', height: 0 } }]`.
3. Stored in `event_log` as PM JSON.
4. Client reads PM JSON via `planSchemaClient` → `HtmlRenderer` renders the iframe.
5. Dev resizes — `editor.updateBlock` writes `{ height: 240 }` to props; SSE round-trips back via event-log.
6. Dev triggers markdown export → `toExternalHTML` on server emits the same `<pre><code class="language-html-block">…</code></pre>` fence. No nested iframe in clipboard.

## Alternatives considered

1. **Block registry / descriptor list** that both schemas iterate. Rejected — CLAUDE.md forbids factories/DI invented for a hypothetical future second implementation. With three blocks the contract duplication is already lifted into `*-shared.ts`; a registry would relocate the per-block file count from 3 to 4 without eliminating the per-block diff. Revisit at block ~6 if drift bugs land.
2. **Different wire shape** — e.g. `<div class="html-block" data-html="…">…</div>` or `<iframe data-html-block …>`. Rejected — diverges from the mermaid pattern, requires the Agent to learn a new shape, and `toExternalHTML` would either produce a nested iframe (rejected by Uncertainty 4 of the prior plan) or special-case the markdown emit. The fence wins on every axis.
3. **Skip the server-safe spec; keep htmlBlock client-only and reject Agent inserts.** Rejected — the entire point of the block is the Agent producing it. Without `html-block.server.ts` registered in `planSchema`, the server's `block-html.ts` round-trip would throw on htmlBlock in PM JSON. Server twin is non-optional once we promote.
4. **Edit-source UI** — add a writable mode to the `</>` toggle so the Dev can edit HTML inline. Out of scope: the agent-Comment loop is the production editing path (Dev comments on the block, agent rewrites). The source toggle is read-only today and stays read-only here.
5. **Persist `expanded` state across sessions.** Out of scope: expand is a momentary "let me look at this bigger" gesture, not a layout preference. Persisting would mean a Dev's expand toggles every other Dev's view via the event-log.

## Uncertainties

1. **`runsBefore: ['codeBlock']` ordering.** Mermaid uses this and works. Assumption: BlockNote's parser respects `runsBefore` on both client React specs and server vanilla specs. Verified for mermaid (already in production); high confidence it generalises.
2. **Tailwind v4 arbitrary-value classes** like `bg-[color:var(--color-surface-1)]` get picked up by the v4 JIT in our config. Spot-check: similar bracketed arbitrary classes exist elsewhere in `apps/console/components/ui/*`. If the JIT misses them under production build, fallback is to inline the CSS var in a `style` prop (`style={{ background: 'var(--color-surface-1)' }}`) — also valid, slightly less consistent with the rest of the codebase.
3. **Whether the playground deletion breaks any other route or import.** Only `app/playground/html-block/page.tsx` imports `htmlBlock` outside the production schema. After registration in `planSchemaClient`, the playground's local schema is redundant. Verified by grep before delete.

## Deletion test (per CLAUDE.md §2)

For each new/edited module:

- `html-block.server.ts` — required so `planSchema` (server) can parse PM JSON containing htmlBlocks. Deletion → server route handlers throw on any Agent-written htmlBlock. **Earns its place.**
- `parseHtmlBlockPre` in `html-block-shared.ts` — single source of truth so client and server parsers cannot disagree about which elements claim the element. Deletion → duplicate `parse` bodies in `.tsx` and `.server.ts` that can drift. **Earns its place (same argument as `parseMermaidPre`).**
- `htmlSlashItem` / `htmlBlockTypeItem` — needed for menu insertion. Without them the only way to insert an htmlBlock is the Agent's MCP path; manual insertion via slash / block-type is impossible. Could argue these are unused (Dev usually waits for Agent) — but parity with alert's menu wiring keeps the editor surface predictable. **Earns its place; tiny.**
- `toExternalHTML` — needed for markdown export to produce readable output. Deletion → BlockNote's default serializer emits the block's rendered HTML (which for htmlBlock means an iframe, broken in clipboard). **Earns its place.**
- Token-classes in `html-renderer.tsx` — not "new code"; replacing hex with token references. Reverse direction would be re-introducing magic-number colors. **Earns its place by design system consistency.**

## Destructive-action acknowledgment

- **Deleting** `app/playground/html-block/page.tsx` and `app/playground/html-block/plan.json`. Both are throwaway prototypes per the prior plan's "out of scope" section, explicitly marked `// THROWAWAY` at the top of the page. Dev approval requested in the same turn this plan is run.
- No `git push`, no migrations, no package publish, no force-push.

## Out of scope (deliberate)

- Block registry / descriptor pattern (rejected above).
- Edit-source UI (read-only source-toggle today).
- Width-axis resize / responsive viewport simulator.
- Tailwind safelist / dynamic token mapping beyond the 5 colors in the table above.
- Persisted expand state.
- DOMPurify / CSP allowlist (sandbox is the trust boundary; see prior plan).
- New MCP tool — the existing three Agent-side tools cover insertion / update / replacement.
- A semantic shadow token in DESIGN.md (the one shadow used by expand stays as a bracketed arbitrary class until someone adds a tokenised shadow scale).

## Sequence

1. Add `parseHtmlBlockPre` to `html-block-shared.ts`.
2. Write `html-block.server.ts` (server-safe twin) — model on `mermaid-block.server.ts`.
3. Edit `html-block.tsx` — add `parse`, `toExternalHTML`, `runsBefore`; add `htmlSlashItem` + `htmlBlockTypeItem` exports.
4. Edit `html-renderer.tsx` — swap inline hex for token classes (table above). No behavior change.
5. Register `htmlBlockServer` in `plan-schema.ts` and `htmlBlock` in `plan-schema-client.ts`.
6. Wire `htmlSlashItem` + `htmlBlockTypeItem` in `plan-editor.tsx`.
7. Append the htmlBlock sentence to the three MCP tool descriptions in `apps/agent/src/mcp-server.ts`.
8. Delete `app/playground/html-block/` (verify no external imports first).
9. Run `bun run typecheck && bun run lint`. Fix anything red.
10. Smoke-test by inserting an htmlBlock via the slash menu in a real thread, pasting card HTML via Comments-to-agent (or via `editor.replaceBlocks` in devtools), resizing, expanding, exporting to markdown, reloading.
11. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` (parallel, single message). Address findings.
12. Commit (separate explicit approval per project rule on commits).

---

End of plan.
