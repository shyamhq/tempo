# Plan — `htmlBlock` BlockNote custom block (playground only)

**Date:** 2026-06-08
**Branch:** feat/blocknote (extend, or new branch from current)
**Author:** Dev + Claude

---

## Problem

Agents need a way to render an HTML artifact inside a plan for two recurring use cases:

1. **Design-system surface.** When the agent helps design a UI, it should be able to lay out a swatch grid, type scale, button gallery, etc. as one rendered HTML page the dev can scan in the plan.
2. **Interactive UI prototype.** When the dev is uncertain about a user flow, the agent should be able to drop a quick clickable HTML prototype (Tailwind via CDN, small JS for state) into the plan and the dev can play with it without leaving the Console.

Markdown / Mermaid don't cover this — both are restricted vocabularies and neither produces an interactive surface. Today the agent would have to dump HTML into a `codeBlock`, which the dev can only read as source.

## Smallest concrete change

Add **one new block type `htmlBlock`** that stores an HTML string and renders it inside a sandboxed iframe. Ship it in a **throwaway playground page only** — not registered in `planSchema` / `planSchemaClient`, no MCP tool, no agent prompt update. The playground proves the rendering, sizing, source toggle, expand, and resize work; promotion to the real plan is a separate plan after we like what we see.

Block storage: `{ html: string; height: number }` props, `content: 'none'`. Default `height = 0` means "auto-grow from iframe-reported content height, capped". Non-zero means "dev resized, lock to this height".

## Files

| Path | Purpose | Layer |
|---|---|---|
| `apps/console/lib/blocks/html-block-shared.ts` | Constants the client spec imports today and the (future) server spec will import at promotion: `HTML_BLOCK_TYPE`, `HTML_PROP_SCHEMA`, `HTML_CONTENT`. Single source of truth so server + client cannot drift on PM-JSON wire format once both exist. | Shared block contract |
| `apps/console/lib/blocks/html-block.tsx` | `createReactBlockSpec` wrapping `<HtmlRenderer>`. Reads `block.props.html` / `block.props.height`, passes `editor` + `block` for the resize → `editor.updateBlock` write. | Schema (client) |
| `apps/console/lib/blocks/html-renderer.tsx` | The React component: iframe with srcdoc + sandbox, height-shim message listener, `</>` source toggle, expand button + CSS-expand state, bottom-edge resize handle. | UI |
| `apps/console/app/playground/html-block/page.tsx` | Playground shell — BlockNote on the left seeded from `plan.json`, paste-HTML textarea below, doc-JSON inspector on the right, `window.__bnEditor` exposed. **Builds its own local schema inline** (see below). Throwaway, marked as such at top. | Playground (throwaway) |
| `apps/console/app/playground/html-block/plan.json` | Seed: one `heading`, two `paragraph`s, one `htmlBlock` whose `html` prop is a small card-design HTML page (header + 3 cards with hover, Tailwind via CDN). | Playground fixture |

**Playground schema construction (inline in `page.tsx`):**

```ts
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { htmlBlock } from '@/lib/blocks/html-block';

const playgroundSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, htmlBlock: htmlBlock() },
});

const editor = useCreateBlockNote({ schema: playgroundSchema });
```

This is the deliberate deviation from `playground/mermaid/page.tsx`, which imports `planSchemaClient` directly because mermaid IS already registered there. The htmlBlock playground does **not** touch `planSchemaClient` — it builds its own throwaway schema, which is exactly what gets discarded at promotion.

**What survives promotion** (gets wired into `planSchemaClient` then): `html-block-shared.ts`, `html-block.tsx`, `html-renderer.tsx`. **What's discarded at promotion**: the playground directory (route + seed + local schema construction).

No edits to `plan-schema.ts`, `plan-schema-client.ts`, MCP server, agent prompt, or production routes.

## Render pipeline

```
<HtmlRenderer html={…} height={…} block={…} editor={…}>
  ↳ wrap (position: relative; transitions to absolute inset on expand)
    ↳ toolbar (floating top-right): [</>] [expand|collapse]
    ↳ if sourceMode: <pre>{html}</pre>  (read-only)
       else:        <iframe srcdoc={INSTRUMENTED_HTML} sandbox="allow-scripts" />
    ↳ bottom-edge resize handle (when not in sourceMode and not expanded)
```

`INSTRUMENTED_HTML = HEIGHT_SHIM_SCRIPT + html`, where `HEIGHT_SHIM_SCRIPT` is:

```html
<script>
  new ResizeObserver(() => {
    parent.postMessage(
      { type: 'tempo:htmlBlock:height', h: document.documentElement.scrollHeight },
      '*'
    );
  }).observe(document.documentElement);
</script>
```

Parent listens on `window` for `message`; filters by `event.data?.type === 'tempo:htmlBlock:height'` **and** `event.source === iframeRef.current?.contentWindow` (origin will be `'null'` under sandbox, so identity-on-source is the right filter, not origin). When `block.props.height === 0`, applies `min(max(120, h), CAP)` as the iframe height; otherwise uses `block.props.height` directly.

Constants: `MIN_HEIGHT = 120`, `CAP = 600`. Both inlined in `html-renderer.tsx` — no shared constants module unless we get a second consumer.

## Resize handle

Bottom-edge handle (`<div>` with `cursor: ns-resize`), absolute-positioned at `bottom: 0`. On `pointerdown` it captures the pointer; `pointermove` updates a local height state (so the iframe resizes live); `pointerup` releases capture and calls `editor.updateBlock(block, { props: { height: newHeight } })` exactly once. No write per mousemove — avoid spamming the doc.

Width is always `100%` of the plan column. No corner handle. (Q7 decision.)

## Expand mechanics

Local React state `expanded: boolean` (not persisted — ephemeral UI state). When true, the wrap element gets `position: absolute; inset: <gutter>` against its scroll parent (the plan editor's container). Nav + discussion panel sit in sibling DOM and are untouched. ESC handler attached to the wrap (or `document` when expanded); the collapse button in the toolbar also flips it. **Same iframe instance** — no remount, interactive state preserved. Clicking the gutter does **not** close.

For the playground, the "scroll parent" is the playground page's editor column. In production this would be the plan-editor container in `thread-view.tsx`. The renderer queries `closest('[data-plan-column]')` or falls back to the renderer's own offset parent — concrete selector decided when we promote out of playground.

## Source toggle

Local React state `sourceMode: boolean`. When true, replace the iframe with `<pre>{block.props.html}</pre>` (monospace, scrollable, read-only). The same toolbar button toggles back. No code editor pulled in — `<pre>` is enough for "let me see what the agent wrote."

## Trust model

`sandbox="allow-scripts"` only — no `allow-same-origin`, `allow-top-navigation`, `allow-forms`, `allow-popups`. Iframe has opaque origin and cannot reach Console state. HTML stored verbatim, no DOMPurify, no CSP allowlist. (Q6 decision; details in `docs/superpowers/plans/2026-06-08-html-block-research.md` if needed — currently inlined in conversation memory.)

## Playground seed shape

`plan.json` PM JSON document:

```
doc
├── heading (level 1): "HTML block playground"
├── paragraph: "Renders an HTML string inside a sandboxed iframe. Try the toggle, expand, and resize."
├── paragraph: "Paste HTML below to replace the seed; the JSON on the right updates live."
└── htmlBlock { html: "<!-- card-design sample: header + 3 cards with hover, Tailwind via CDN -->", height: 0 }
```

The card-design sample HTML is a single self-contained document: Tailwind CDN `<script src="https://cdn.tailwindcss.com">`, a header, three feature cards in a grid with hover lift. ~40 lines, embedded as a string literal in `plan.json` (JSON-escaped). Enough to exercise CDN fetch + hover state without being a maintenance burden.

Playground page is labeled `// THROWAWAY — delete after htmlBlock lands on main` at the top, matching the mermaid playground convention.

## Alternatives considered

1. **Render HTML in a sanitized `<div>` (DOMPurify) instead of an iframe.** Rejected: breaks the JS-prototype use case (Q1 (b)), and style isolation is harder (agent's CSS would bleed into the Console). Iframe + sandbox is the standard quarantine method per the HTML spec.
2. **Fresh-mount fullscreen modal at viewport scale** (shadcn `Dialog`). Rejected per Q4 + Q5 — dev wants nav + discussion to stay live; CSS-expand in place inside the plan column is what they asked for and preserves iframe state for free.
3. **Both-axis resize handle.** Rejected per Q7 — width should be 100% of the column for doc-like behavior; responsive-viewport simulation is a separate feature, not a resize handle.
4. **Sanitize HTML with DOMPurify in addition to sandbox.** Rejected per Q6 — sanitization either breaks the JS use case or becomes a CDN-allowlist maintenance burden, and the sandbox already prevents exfiltration.
5. **Implement `parse` to convert pasted HTML into htmlBlocks.** Rejected — would hijack normal paste behavior, turning every clipboard paste into a single htmlBlock. The playground textarea uses `editor.replaceBlocks` explicitly; production agent uses MCP tool calls.
6. **Ship a curated gallery of seed HTML samples (swatches, typography, gallery, wizard).** Rejected — the agent decides what HTML to write; the playground's job is to exercise the rendering mechanism, not pre-curate content. One trivial seed + paste textarea is sufficient.

## Uncertainties

1. **Whether the `closest('[data-plan-column]')` selector strategy survives the move from playground to `thread-view.tsx`.** The playground has its own column; production has a different DOM layout. I'll hard-code the playground page to wrap the editor in `<div data-plan-column>` so the renderer's `closest` selector works in both contexts. If the production thread view doesn't have this attribute, we add it during the promotion plan.
2. **Whether `event.source === iframeRef.current?.contentWindow` works reliably for sandboxed iframes with no `allow-same-origin`.** This is the standard recommendation but I haven't verified it specifically with BlockNote-rendered iframes. Will smoke-test in the playground with chrome-devtools MCP and the seeded sample. If it doesn't work, fallback is a random per-instance ID embedded in the shim script and echoed back in the message — adds ~5 LOC.
3. **Whether the `createBlockSpec` (server-safe, non-React) `render` returning a stub DOM node is acceptable**, given the server only serializes plans and never needs to actually render to HTML for display. Mermaid does this; assume it's fine. If `planSchema` serialization later breaks, we revisit.
4. **`toExternalHTML` behavior** — what does clipboard copy of an htmlBlock produce? Two options: (a) the raw iframe tag, (b) a `<pre><code class="language-html">` with the source. Not decided; not blocking for the playground (no clipboard-copy flow exercised). Will pick (b) at promotion time so pasted content into other tools renders as code, not as an embedded nested iframe.

## Deletion test (per CLAUDE.md / CONTEXT.md §2)

For each new module: "If we deleted this in 6 months, where does the complexity reappear?"

- `html-block-shared.ts` — single source of truth for type/propSchema/content that the client spec imports today and the future server spec will import at promotion. Deletion in this PR → trivially survivable (only one consumer), but its real value is preventing drift once the server spec joins. Keeping it now is cheap and avoids a refactor at promotion. **Earns its place — but the bar is low; if it grows beyond three exported constants it's a smell.**
- `html-block.tsx` — the React spec; without it BlockNote has no client renderer. **Earns its place.**
- `html-renderer.tsx` — could be inlined into `html-block.tsx`. I'm splitting because the renderer holds non-trivial state (height shim listener, expand state, resize state, source toggle). Inlining would cram four concerns into the spec file. **Earns its place; split is the right granularity.**
- `playground/html-block/page.tsx` + `plan.json` — explicitly throwaway. Deletion is the planned end-state (after promotion lands on main). **Earns its place during the prototyping window.**

## Destructive-action acknowledgment

None. No `git push`, no migrations, no package publish, no force-push, no `rm -rf`. Only new files added; no edits to production routes, schemas, MCP, or agent.

## Out of scope (deliberate)

- **Server-safe spec (`html-block.server.ts`).** Deferred to the promotion plan, where it earns its place by being registered in `planSchema` and by carrying real `parse` / `toExternalHTML` logic. In playground-only phase it would have zero callers and a stub `render` — premature.
- Registering `htmlBlock` in `plan-schema.ts` / `plan-schema-client.ts`.
- Updating `tempo_add_blocks` MCP tool description to mention htmlBlock.
- Updating the agent's system prompt / instructions to emit htmlBlocks.
- `toExternalHTML` implementation (deferred to promotion plan; see Uncertainty 4).
- DOMPurify / CSP allowlist.
- Width-axis resize / device-preset viewport simulator.
- Inline HTML editing inside the block (Comments-to-agent loop handles this in production).
- Persisting expand state.
- Block-registry / block-factory architecture (per the prior [[2026-06-08-alert-block]] decision: defer until block #3).

## Sequence

1. Write `html-block-shared.ts` (constants).
2. Write `html-renderer.tsx` (the actual UI: iframe + shim + toggle + expand + resize).
3. Write `html-block.tsx` (client spec wrapping the renderer).
4. Build the playground: `plan.json` seed + `page.tsx` shell (with the inline local-schema construction described above).
5. Smoke-test in the browser with chrome-devtools MCP — verify auto-grow, resize persists, source toggle works, expand fills column with gutter, ESC closes, paste textarea swaps the block.
6. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` (parallel, single message). Address findings.
7. Commit to feat/blocknote (or new branch — confirm with Dev before commit).

---

End of plan.
