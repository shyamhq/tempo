# Plan — first-class Mermaid block

**Date:** 2026-06-08
**Branch:** feat/blocknote

## Problem

Mermaid diagrams are a crucial part of Plans, but they render as plain code blocks. An existing client overlay scans `pre > code.language-mermaid` and injects an SVG sibling, but the Agent's HTML for code blocks doesn't carry `class="language-mermaid"`, so the language defaults to `"text"` and the overlay misses every diagram in every existing Plan (verified against `thr_01KTHR9GTDJVA4QZACNS4D6BR8` in `data/tempo.db` — every codeBlock containing `graph TD`, `sequenceDiagram`, etc. is stored with `language: "text"`).

Fixing the language attribute alone treats the diagram as a sibling of a code block; the Dev still edits raw `graph TD ...` source and the Plan reads as "code block plus picture". For a Plan tool where mermaid is core, this is the wrong shape. The correct shape is a real BlockNote block whose body is the rendered diagram.

## Smallest concrete change

1. **Throwaway playground route** at `apps/console/app/playground/mermaid/page.tsx` that mounts the same `planSchema` editor (plus the new block) seeded with mermaid-rich content harvested from `thr_01KTHR9GTDJVA4QZACNS4D6BR8`. Lets us iterate on the block spec and verify parse / render / edit / comment anchoring / markdown export without touching the live Plan flow. Verified end-to-end via chrome-devtools MCP before promoting.

2. **`apps/console/lib/blocks/mermaid-block.tsx`** — a `createReactBlockSpec`:
   - `type: 'mermaidDiagram'`, `propSchema: { source: { default: '' } }`, `content: 'none'`.
   - `render`: lazy-loads `mermaid`, renders the diagram, sanitises SVG with DOMPurify (already a dep). Caches by source-hash. Click → swap SVG for a `<textarea>` bound to `block.props.source`; blur → persist + re-render. Read-only editor → no textarea.
   - `parse`: claims `<pre><code class="language-mermaid">…</code></pre>` (or `data-language="mermaid"`). Returns `{ source: code.textContent }`.
   - `toExternalHTML`: emits `<pre><code class="language-mermaid">…</code></pre>` so Markdown export remains a ```` ```mermaid ```` fence and the Agent's wire format never changes.
   - **Error state:** if mermaid throws or returns an empty SVG, show the source verbatim with a one-line red banner ("Diagram syntax error"). Source-and-banner is simpler than preserving last-good and the Dev sees what to fix.

3. **`apps/console/lib/plan-schema.ts`** — register the new block: `blockSpecs: { ...defaultBlockSpecs, mermaidDiagram: mermaidBlock }`. Both client `useCreateBlockNote` and `ServerBlockNoteEditor.create` import the same schema; the server path round-trips PM JSON without executing the React render.

4. **Delete the overlay scanner** from `apps/console/components/thread/editor/plan-editor.tsx` — the `loadMermaid` / `MERMAID_PREVIEW_CLASS` / `hashSource` helpers (lines 49–77) and the `useEffect` that scans `pre > code.language-mermaid` (lines 228–277). Replaced by the block's own renderer.

## Layer placement

| File | Layer | Role |
|---|---|---|
| `apps/console/lib/blocks/mermaid-block.tsx` (new) | UI | Block spec + React render component + pure parse/toExternalHTML |
| `apps/console/lib/plan-schema.ts` (edit) | shared schema | One new entry under `blockSpecs` |
| `apps/console/app/playground/mermaid/page.tsx` (new, throwaway) | UI route | Test harness |
| `apps/console/components/thread/editor/plan-editor.tsx` (edit) | UI | Delete overlay scanner |

No server module changes. No `@tempo/contracts` changes (the wire format on the Agent side is HTML; PM JSON storage gains a new node type but persisting `mermaidDiagram` nodes is forward-compatible — old plans without them parse unchanged). No DB migration.

## Deletion test

- **`mermaid-block.tsx`** — if deleted in six months: BlockNote's default codeBlock parse re-claims `<pre><code class="language-mermaid">`, diagrams stop rendering as diagrams and revert to source. The "how do diagrams appear in a Plan" knowledge has a single owner (this file). Real module.
- **Playground route** — if deleted: lose the test harness, no production impact. Throwaway by design; file's docstring will say so.

## Alternatives considered

- **A. codeBlock + overlay scanner (existing path, fix Agent's HTML).** Cheap. Diagram is always a sibling of a code block; Dev edits raw mermaid source; comments anchor inside the source text (works but ugly). Wrong shape for a core feature.
- **B. Custom `mermaidDiagram` block spec.** Chosen. First-class block, native parse/render/serialize. Comments anchor at block level — natural for a diagram ("redo this as C4"). Edit affordance via inline source toggle. Markdown export round-trips through `toExternalHTML`. Bigger surface (one new file, one schema entry, kill the overlay) but the proper shape.
- **C. Hybrid (parse-time server post-process).** Rejected. Two write-side sources of truth (codeBlock with `language=mermaid` AND mermaidDiagram block). BlockNote's `parse` callback on the block spec does exactly the same conversion in the BlockNote-native way, without server logic.

## Uncertainties

To be resolved in the playground before promoting:

1. **Parse priority when two specs claim `<pre><code>`.** The default codeBlock spec also parses `<pre><code>`. Need to confirm which `parse` wins when both match. If codeBlock wins, fix is either (a) custom specs win by being listed later in the schema's blockSpecs (current understanding) or (b) we extend codeBlock's parse to early-return on `language-mermaid`. Playground will reveal this on the first paste of mermaid HTML.
2. **Mermaid error behaviour.** Haiku research said `mermaid.render` produces silently broken SVG for invalid input; the existing code has a try/catch suggesting it can also throw. Playground feeds a deliberately broken diagram and observes which path fires — drives the error-banner trigger.
3. **CommentsExtension on `content: 'none'` blocks.** A block with no inline content can still receive block-level comments via the gutter, but BlockNote's floating composer targets text selections. Need to confirm the gutter path and the orphan flow both work for mermaidDiagram blocks.
4. **ServerBlockNoteEditor (jsdom) with a React-bearing block spec.** ServerBlockNoteEditor uses the schema for `_blocksToProsemirrorNode` / `_prosemirrorJSONToBlocks` — JSON transforms, no DOM render — so the React component should never execute server-side. Playground first; if the server path throws on schema registration, we split the spec into a node-spec (server) plus a render-spec (client) per BlockNote's docs.

## Tasks

1. Harvest mermaid HTML samples from `thr_01KTHR9GTDJVA4QZACNS4D6BR8`'s `body_pm_json`. Build the playground route, seeded with these samples plus a deliberately-broken diagram and a comment thread anchored to a mermaid block.
2. Implement `mermaid-block.tsx` — render-only path first (read-only, no edit affordance), wired into `planSchema`.
3. Verify in playground via chrome-devtools MCP: paste HTML → parse to mermaidDiagram → render SVG → broken-diagram error banner → markdown export round-trip → block-level comment anchoring.
4. Add inline source toggle (click → textarea on focus, blur → persist + re-render).
5. Delete the overlay scanner from `plan-editor.tsx`.
6. Verify against the real Plan in `thr_01KTHR9GTDJVA4QZACNS4D6BR8` once promoted.
7. Run `code-simplifier:code-simplifier` and `everything-claude-code:code-reviewer` in parallel before commit.

## Out of scope

- **Backfill of existing plans.** Plans whose codeBlocks have stored `language: "text"` for mermaid content won't auto-convert — the parse path only fires on incoming HTML. A one-shot migration script (PM-JSON-tree walk: codeBlock with mermaid-shaped content → mermaidDiagram) is the right tool. Judged separately if/when needed.
- **Agent tool description updates.** With the block spec's parse claiming `class="language-mermaid"`, the Agent still needs to emit that class. A separate one-line addition to the three Plan-write tool descriptions covers it. Judged separately.
- **`supportedLanguages` dropdown.** Not needed once `mermaidDiagram` is its own block.

## Destructive actions

None. No `git push`, no DB migration, no external messages.
