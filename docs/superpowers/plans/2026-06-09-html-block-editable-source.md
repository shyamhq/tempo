# Plan — Make `htmlBlock` source mode editable

**Date:** 2026-06-09
**Branch:** feat/blocknote (continuation of the promotion PR)
**Author:** Dev + Claude

---

## Problem

The promoted `htmlBlock` has a slash-menu entry, a block-type-select entry, and a `</>` source-toggle button, but the `</>` mode renders the source in a read-only `<pre>`. With `content: 'none'` and no other write path, inserting an htmlBlock via the menu produces a permanently empty block — the only populate path is the Agent (`tempo_add_blocks`) or pasting `<pre><code class="language-html-block">…</code></pre>` at the top level. That makes the menu entry feel broken.

The Dev wants source mode to be a real editor: type / paste HTML, click Preview, see the iframe, click `</>` again to edit. UX should feel native to BlockNote and consistent with the Console's design tokens.

## Smallest concrete change

Promote source mode from a read-only `<pre>` to a writable `<textarea>`. Three behavioural rules:

1. **Empty blocks open in source mode by default.** First render of a block with `html === ''` initialises `sourceMode = true` with the textarea autofocused. Filled blocks still open in preview as today.
2. **Edits persist on blur.** A local `draft` state mirrors the textarea contents; on blur (and on Preview-button click), `editor.updateBlock(block, { props: { html: draft } })` writes back IFF the draft differs from the persisted prop. No write-per-keystroke.
3. **Switching to Preview commits the draft.** Clicking `Preview` while the draft is dirty calls the same commit path, then flips `sourceMode` off.

No new toolbar buttons. The existing `</>` / `Preview` toggle continues to be the only mode switch.

## Files

| Path | Change | Why |
|---|---|---|
| `apps/console/lib/blocks/html-renderer.tsx` | **Edit.** Add `draft` state, `textareaRef`, `commit` helper, an `activeElement`-guarded `useEffect` that resyncs `draft` from `html`. Initialise `sourceMode` from `html === ''`. Replace the `<pre>` branch with a `<textarea>` (token styling below) and `autoFocus` it IFF the block was empty on first mount. **Update the leading header comment** so concern (3) reads "`</>` source toggle — read-only when filled, editable mode swap when populating" (or equivalent — match the new behaviour). The current comment says "read-only source toggle" verbatim and would lie the moment the code lands. | The whole change is local to the renderer; the header comment is the contract a future reader sees first and must reflect the new behaviour. |
| `apps/console/lib/blocks/html-block.tsx` | **Edit.** Add one line: `onSourceCommit={(html) => editor.updateBlock(block, { props: { html } })}` on the `<HtmlRenderer>` JSX, symmetric to the existing `onResizeCommit`. Bridge gains one line; no other change. | One new callback wire — the renderer cannot persist without it. |

Net: one new callback prop on `HtmlRenderer` (`onSourceCommit: (html: string) => void`), wired the same way `onResizeCommit` already is.

## Layer assignment

All new state (`draft`, `textareaRef`), helpers (`commit`), effects, and the `onSourceCommit` prop on `HtmlRenderer` live at the **UI layer / renderer-internal** — same layer as the existing height-shim listener, resize state, and expand state. The `editor.updateBlock` call in `html-block.tsx` sits in the **client block-spec layer**, the same layer that already houses `onResizeCommit`'s `editor.updateBlock` call. No `apps/console/server/**`, no `db-queries`, no `@tempo/contracts`, no route handlers, no MCP, no Agent code is touched.

## Mode transitions

| State | sourceMode | UI |
|---|---|---|
| Empty (`html === ''`) on first mount | `true` (initial) | Textarea, autofocused, placeholder "Paste or write HTML…", toolbar shows `Preview` |
| Filled, default | `false` | Iframe with the `</>` + Expand toolbar (current behaviour) |
| Filled, source | `true` | Editable textarea, toolbar shows `Preview` |
| Source → Preview (clicked) | flips to `false`, commits draft | Iframe rerenders with the new html |
| Source → blur outside | sourceMode stays `true`, commits draft | Textarea retains focus styling neutral; next interaction can flip the mode |

`Expand` is hidden in source mode (current behaviour — already gated on `!sourceMode`). No change there.

## Persistence semantics

- `draft: string` initialised to `html` prop.
- Textarea is controlled: `value={draft}`, `onChange={(e) => setDraft(e.target.value)}`.
- `commit()` = `if (draft !== html) onSourceCommit(draft)`. Called from textarea `onBlur` and from the `Preview` button's `onClick` before flipping `sourceMode`.
- When the `html` prop changes externally (Agent rewrote the block via SSE), reset `draft` to the new `html` IFF the textarea is not currently focused — i.e. don't clobber a Dev mid-edit. Implemented with a `useEffect` keyed on `html`, guarded by `document.activeElement !== textareaRef.current`.

No keystroke throttling, no `Ctrl+S` shortcut, no Save/Cancel buttons. Blur is the commit boundary; it matches how the resize handle already commits.

## Design tokens for the textarea

| Property | Value |
|---|---|
| `background` | `var(--color-surface-2)` (matches the old `<pre>` background) |
| `color` | `var(--color-ink)` |
| `border` | `0` (the outer wrap already has a border) |
| `outline` | `0` on focus — BlockNote's focus-within ring on the block container is the visible focus indicator |
| `font-family` | `monospace` (inherits the same `<pre>` shape) |
| `font-size` | `12px`, `line-height: 1.4` (unchanged from `<pre>`) |
| `padding` | `12px` (unchanged) |
| `resize` | `none` — the bottom-edge handle resizes the block container; the textarea fills it |
| `width` / `height` | `100%` of body slot |
| `white-space` | `pre-wrap`, `word-break: break-all` (unchanged) |

Placeholder colour is set up front: a small `<style>` block injected once per renderer mount (or a `:global` selector on the textarea via a stable class name) sets `::placeholder { color: var(--color-ink-tertiary) }`. We pick the class-name + globals.css path: add a single rule `.bn-html-source-textarea::placeholder { color: var(--color-ink-tertiary); }` in `apps/console/app/globals.css` next to the other BlockNote-scoped rules. This avoids per-mount style injection and keeps token use consistent with the rest of the Console. (Decision made up front to avoid mid-implementation drift.)

## Empty-block UX

When the slash-menu inserts an empty htmlBlock:
- The block mounts with `html === ''`.
- Renderer detects this on first render via `useState(() => html === '')` for `sourceMode`.
- Textarea autofocuses (`autoFocus` prop on first mount).
- Toolbar shows `Preview` (because we're in source mode). Clicking Preview before typing anything just flips to an empty iframe — harmless, the Dev re-clicks `</>` to come back.

We do NOT auto-flip back to preview when the textarea content becomes non-empty. The Dev decides when to preview.

## Alternatives considered

1. **Two-pane edit/preview side-by-side (CodeSandbox-style).** Rejected — the htmlBlock height envelope is 120–600px; splitting it makes both panes useless. Toggle is the right model at this size.
2. **Save / Cancel buttons in the toolbar.** Rejected — adds two UI affordances for what blur already handles. Matches the resize-handle pattern (commit on pointerup, no explicit Save).
3. **Auto-flip back to preview after N seconds of idle.** Rejected — surprising, and a JS prototype with a `<script>` shouldn't run repeatedly mid-edit while the Dev is still typing.
4. **Switch to a code editor (CodeMirror / Monaco).** Rejected — out-of-proportion for the size envelope, adds a heavy dep, and source mode is for inspection / quick tweaks, not authoring large HTML.
5. **Persist `draft` across mode toggles in PM JSON.** Rejected — `draft` is ephemeral UI state. `html` is the source of truth; PM JSON shouldn't carry an "uncommitted draft" field.

## Uncertainties

1. **BlockNote's ProseMirror handler intercepting keystrokes meant for the textarea.**
   - **Symptom that proves it broke**: arrow / Backspace / Enter inside the textarea moves the BN selection between blocks instead of (or in addition to) moving the textarea caret.
   - **Mitigation applied when the symptom appears**: add `onKeyDown={(e) => e.stopPropagation()}` on the textarea — uniformly, all keys. ProseMirror only acts on keydown events that bubble out of `contentEditable` regions; stopping propagation at the textarea boundary is the standard fix. If `stopPropagation` proves insufficient (e.g. BN listens at capture phase), we additionally add `onKeyDownCapture` with the same body. No keyed-by-keycode allow-list — that's brittle.
2. **`contentEditable={false}` on the wrap suppressing focus or clicks inside the textarea.**
   - **Symptom that proves it broke**: clicking the textarea places no caret / does not focus / scrolls the editor selection instead.
   - **Mitigation applied when the symptom appears**: wrap the textarea in `<div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>` so the click never reaches BN's selection handler at the wrap. Native textarea focus then takes over as normal. We do not flip the wrap to `contentEditable={true}` — that would let BN edit our chrome.
3. **External `html` updates while textarea is focused.** Plan handles this with the activeElement guard. If SSE produces a stream of rapid updates while the Dev is mid-edit, the guard holds; the next blur commits and a subsequent update can refresh.

## Deletion test

- `draft` + `commit` — gate is "the textarea must persist its writes back to BlockNote." Without them, edits would be discarded on rerender. **Earns its place.**
- `activeElement` guard on the external-update effect — prevents Agent-write-clobbers-Dev-edit. **Earns its place.**
- `sourceMode` initialiser from `html === ''` — replaces a dead empty state with an immediately-useful one. **Earns its place.**

## Destructive-action acknowledgment

None. No file deletes, no schema changes, no migrations, no agent contract changes. Only `html-renderer.tsx` is edited.

## Out of scope

- CodeMirror / Monaco / syntax highlighting.
- Auto-save while typing.
- Multi-line diff highlight when the Agent rewrites the block.
- Empty-state placeholder graphics beyond the `<textarea placeholder>` attribute.
- Block-level drag-handle / slash-menu reskins — those are BlockNote's chrome, not ours.

## Sequence

1. Edit `html-renderer.tsx`:
   - Update the leading header comment so concern (3) reflects the new editable-source behaviour.
   - Add `onSourceCommit` to `Props`.
   - Add `draft` state, `textareaRef`, `commit` helper, `useEffect` to sync `draft` from `html` only when textarea unfocused.
   - Initialise `sourceMode` from `html === ''`.
   - Replace the `<pre>` branch with a styled `<textarea>` (tokens above). Stable class name `bn-html-source-textarea` for the placeholder rule.
   - Add `autoFocus` IFF `html === ''` on first mount.
2. Edit `html-block.tsx` to wire `onSourceCommit={(html) => editor.updateBlock(block, { props: { html } })}` alongside the existing `onResizeCommit`.
3. Edit `apps/console/app/globals.css` to add one rule: `.bn-html-source-textarea::placeholder { color: var(--color-ink-tertiary); }` near the other BN-scoped rules.
4. Run typecheck + biome on touched files.
5. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` (parallel). Address findings.
6. Stop. Dev approves the commit separately.

---

End of plan.
