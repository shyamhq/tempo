# Plan — `htmlBlock` to BlockNote-native `content: 'inline'`

**Date:** 2026-06-09
**Branch:** feat/blocknote (continuation)
**Author:** Dev + Claude

---

## Problem

`htmlBlock` is `content: 'none'` with a custom `props.html` string and a hand-rolled `<textarea>` for source editing. The Console runs a parallel input surface (textarea) next to BlockNote's contentEditable, and the two compete for paste, focus, keyboard, and undo. We've already shipped one bug from this gap (the original `<style>`-block paste rendered partial CSS) and the plan lists two more uncertainties whose mitigations live on standby.

BlockNote's built-in `codeBlock` already shows the native pattern for "editable text body + a type prop": `content: 'inline'`, `props: { language }`. The block's body IS BlockNote's normal editable inline content; BN's paste / focus / keyboard / undo "just work" because there is no parallel surface.

## Smallest concrete change

Move `htmlBlock` to the same pattern: drop `props.html`, set `content: 'inline'`, render `contentRef` as the source surface and the sandboxed iframe as the preview. The toggle hides the unused view via `display: none` so `contentRef` stays attached and BN's editor state is never torn down.

Wire format with the Agent stays exactly the same (`<pre><code class="language-html-block">…</code></pre>`); only the internal storage and editing surface change.

## Files

| Path | Change | Notes |
|---|---|---|
| `apps/console/lib/blocks/html-block-shared.ts` | **Edit.** Drop `html` from `HTML_PROP_SCHEMA`; keep `height`. Change `HTML_CONTENT` from `'none'` to `'inline'`. Replace `parseHtmlBlockPre` return type from `{ html: string }` to `Record<string, never>` — element-shape check only; the element body becomes the block's inline content via BN's default inline parse. | Wire-shape contract reduced from `{ html, height }` to `{ height }`. |
| `apps/console/lib/blocks/html-block.tsx` | **Edit.** Render reads source via `block.content.map((c) => ('text' in c ? c.text : '')).join('')`, passes it + `contentRef` + `height` + `onResizeCommit` to `<HtmlRenderer>`. Drop `onSourceCommit` (no draft/textarea). `toExternalHTML` returns `<pre><code class="language-html-block" data-language="html-block" ref={contentRef} />`. Slash + block-type items drop `html: ''` from initial props. | One `onSourceCommit` line goes away; `contentRef` is the only editing channel. |
| `apps/console/lib/blocks/html-block.server.ts` | **Edit.** Drop `props.html` from `toExternalHTML`; emit `<pre><code class="language-html-block" data-language="html-block">` with `contentDOM = code`. `parse` returns `{}` on match. `runsBefore: ['codeBlock']` stays. Mirrors how alert's server spec uses `contentDOM`. | Stub `render` unchanged (server only). |
| `apps/console/lib/blocks/html-renderer.tsx` | **Edit (large).** Drop `draft`, `textareaRef`, both `useEffect`s that touched them, `onBlur`, `autoFocus`, `biome-ignore noAutofocus`, the `<textarea>` element, and the `onSourceCommit` prop. Add `srcText: string` and `contentRef: (el: HTMLDivElement \| null) => void` to `Props`. Replace the `<textarea>` branch with `<div ref={contentRef} className="bn-html-source" />`. Make both views always-mounted: contentRef wrapper at `display: sourceMode ? 'block' : 'none'`, iframe at the inverse — never unmount either when toggling, so BN never loses cursor / selection state and the iframe doesn't reload its srcdoc. Source-mode initialiser becomes `useState(() => srcText === '')`. | Net renderer LOC drops ~70 lines. |
| `apps/console/app/globals.css` | **Edit.** Remove the `.bn-html-source-textarea::placeholder` rule. Add `.bn-html-source { padding: 12px; font-family: monospace; font-size: 12px; line-height: 1.4; background: var(--color-surface-2); color: var(--color-ink); white-space: pre-wrap; word-break: break-all; min-height: 100%; outline: none; }` so the contentEditable surface visually matches the old textarea. | One rule traded for another. |
| `apps/console/components/thread/editor/plan-editor.tsx` | **No change.** Slash item + block-type item exports stay; they just don't initialise an `html` prop anymore. Wired registrations are unchanged. | Confirmed via grep. |
| `apps/agent/src/mcp-server.ts` | **No change.** Wire format unchanged; the agent emits the same fence. | Confirmed; the tool description sentence still describes the same HTML on the wire. |

Net: 5 files edited, 0 new, 0 deleted. ~70 LOC down on the renderer, a few up on the shared spec / server spec / globals.css.

## Layer assignment

All edits stay where their predecessors lived:
- `html-block-shared.ts` — shared contract.
- `html-block.tsx` — client block spec, picks `contentRef` out of BN's `render` callback and forwards it.
- `html-block.server.ts` — server-safe block spec, returns `contentDOM` on the inner `<code>`.
- `html-renderer.tsx` — UI / renderer-internal.
- `globals.css` — BlockNote-scoped CSS, same section as `.bn-mermaid-block`.

No server/db-queries/contracts/route-handler/MCP code is touched. No new files.

## Wire-format invariants (unchanged)

| Direction | Shape |
|---|---|
| Agent → server (`tempo_add_blocks`) | `<pre><code class="language-html-block">…html…</code></pre>` |
| PM JSON storage | `{ type: 'htmlBlock', props: { height: N }, content: [ { type: 'text', text: '…html…', styles: {} } ] }` |
| Server → external HTML (markdown export) | `<pre><code class="language-html-block" data-language="html-block">…html…</code></pre>` |
| Client → external HTML (clipboard copy) | same |

The only change from today is that PM JSON moves the source string from `props.html` into `content[].text`. Round-trip parse / serialise / parse stays byte-stable.

## Toggle / mount semantics

Both views (contentRef wrapper and iframe) are always rendered; only the CSS `display` flips. This is the load-bearing decision — unmounting either side would (a) tear down BN's editor state on the contentRef and (b) force the iframe to reload its srcdoc on every toggle (losing any in-frame JS state). The hidden side still occupies no layout space (`display: none`).

The expand button uses the iframe path (preview only); the bottom-edge resize handle still only fires when `!sourceMode && !expanded`. No change to expand or resize.

## Source-mode initialiser

`useState(() => srcText === '')` — empty blocks open in source mode; filled blocks open in preview. Same UX as today, simpler implementation (no `initialEmpty` ref, no autofocus prop, no biome-ignore). BN's contentEditable shows its own caret/placeholder for an empty inline-content block.

## Parse semantics

`parse(el)` matches `<pre>` containing `<code class="language-html-block">` (or `data-language="html-block"`) and returns `{}`. BN then walks the element's children and assigns them as inline content for the block. For our shape that's the `<code>` element's text — BN's default inline parse treats it as a text run.

A risk: BN's default `code` style might be applied to the resulting text run (since the matched element contains `<code>`). The text content is unchanged; the style mark is cosmetic. For an htmlBlock the text is read verbatim into `srcdoc` so a `code` style mark has no functional effect on the iframe render. On `toExternalHTML` round-trip we emit `<pre><code class="language-html-block">{contentRef}</code></pre>` — the outer `<code>` wraps whatever inline marks BN emitted, so an inner span with a `code` style mark would land inside `<code><code class="…"`…`</code></code>`. This is ugly markdown but the iframe doesn't see it.

**Decision:** accept the cosmetic mark for v1. If it shows up as visible double-monospace in the editor, we add `meta: { selectable: true }` and/or strip the `code` style via `runsBefore` ordering. Documented under "Spotted but not fixed" in `AGENTS.md` if it surfaces.

## Inline marks (bold, italic, comment) inside the source

A Dev could in principle select HTML source text and apply bold via the formatting toolbar. That mark would serialise into PM JSON and then round-trip into the `toExternalHTML` output, producing `<pre><code><strong>…</strong>…</code></pre>` — the iframe would interpret the `<strong>` as part of the HTML page being rendered, which is wrong.

**Decision:** same trade-off BlockNote's own `codeBlock` accepts. Devs editing a code/HTML body don't typically apply formatting. We don't strip marks; we don't disable the formatting toolbar for this block in v1. If it bites, we add a `BlockNoteSchema`-level filter or a `selectable: false` meta on the block. Documented in `AGENTS.md`.

## Alternatives considered

1. **Keep `content: 'none'` + textarea, add `stopPropagation` mitigations.** Rejected — the user already hit a paste-corruption symptom; band-aids accumulate. Native is the right primitive.
2. **`content: 'inline'` but unmount the iframe on source-mode toggle.** Rejected — re-mounting reloads srcdoc, loses iframe JS state, and re-fires the load handler with a height re-measurement. Toggling state between source and preview during prototyping would be janky.
3. **Render a separate CodeMirror in source mode** (independent of BN). Rejected — same parallel-surface problem we're escaping from.
4. **Disable formatting toolbar for this block via `selectable: false`.** Considered for v1; deferred. The cosmetic-mark issue is hypothetical; we wait for it before bolting on extra config.

## Uncertainties

1. **Whether BN applies a `code` style mark to the matched `<code>` element's text on parse.** Symptom that proves it: the source-mode contentEditable shows the text in BlockNote's `code` style (extra monospace, surface tint). Mitigation when symptom appears: remove the `code` style from the matched element via a custom inline-content parse rule, or override the `code` style spec for our schema scope. Doesn't block this plan.
2. **Whether `display: none` on the contentRef wrapper makes BN's selection / cursor invisible to the formatting toolbar while in preview.** Almost certainly fine (the selection still exists, just isn't visually presented). Symptom if not: the Comment composer or formatting toolbar fails to open on the htmlBlock from preview mode (a flow we don't expect anyway — preview is read-only). Doesn't block.

## Deletion test (per CLAUDE.md §2)

- `srcText` (joined `block.content` text) — derived value, computed at render time. Without it the iframe can't build srcdoc. **Earns its place.**
- The `display: none` toggle pattern — without it BN loses editor state on every toggle. **Earns its place.**
- The deleted code (draft/commit/textareaRef/onBlur/autoFocus/biome-ignore/onSourceCommit) — removing it eliminates an entire class of failure modes. **The deletion is the point.**

## Destructive-action acknowledgment

This plan **removes** `props.html` from the htmlBlock contract. Any existing PM JSON stored with the old shape will fail to round-trip cleanly — BN will ignore the unknown `html` prop and the block will mount with empty inline content. The Dev acknowledges this trade-off because:

(a) We have no production deployments yet; the only htmlBlocks in existence are this session's smoke tests.
(b) The MCP wire format is unchanged — if any Agent-authored htmlBlock survived in PM JSON it would survive round-trip via the parser (still matches the `<pre><code class="language-html-block">` shape on re-parse).
(c) There is no migration path that's cheaper than "re-author the test blocks."

Confirmed in the same turn this plan is invoked.

No `git push`, no migrations, no package publish, no force-push.

## Out of scope

- Disabling formatting marks inside the source.
- Replacing the contentEditable with a syntax-highlighting editor.
- Persisting `expanded` state.
- Edit-source UI affordances beyond what BN already gives (placeholder, cursor, etc).

## Sequence

1. Edit `html-block-shared.ts`: drop `html` prop, change `HTML_CONTENT` to `'inline'`, update `parseHtmlBlockPre` to return `{}` and only check the element shape. Update file header comment to reflect the contract change.
2. Edit `html-block.server.ts`: `toExternalHTML` returns `{ dom: pre, contentDOM: code }`; `parse` returns `{}`. Drop the `block.props.html` read.
3. Edit `html-block.tsx`: `render` extracts `srcText` from `block.content` and passes `contentRef` + `srcText` + `height` to `<HtmlRenderer>`; drop `onSourceCommit`. `toExternalHTML` uses `<pre><code className="language-html-block" data-language="html-block" ref={contentRef} />`. Slash + block-type items drop `html: ''`.
4. Edit `html-renderer.tsx`: change `Props` to `{ srcText, height, onResizeCommit, contentRef }`. Delete draft/textareaRef/blur/onSourceCommit and the resync useEffect. Replace the textarea with `<div ref={contentRef} className="bn-html-source" />`. Mount both views permanently; CSS-toggle visibility via `display`. Update the file header comment for concern (3).
5. Edit `globals.css`: remove `.bn-html-source-textarea::placeholder` rule, add `.bn-html-source { … }` styled like the old textarea.
6. Run `bun run typecheck && bun run lint`.
7. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` (parallel).
8. Smoke-test by inserting an htmlBlock via `/html`, pasting HTML, toggling Preview / source, resizing, expanding, ESC.
9. Stop. Dev approves commit separately.

---

End of plan.
