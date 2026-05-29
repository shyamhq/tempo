# Plan: Google-Docs-style Comments

## Problem

Today's Comment flow is unintuitive: the Dev must locate a sticky **"Comment on selection"** button at the top of the editor, click it, then type into a card stacked at the top of the right rail. The selection visual disappears the moment focus leaves the editor, so the Dev loses sight of *what* they were commenting on while typing. Existing comment highlights, when clicked, only scroll the rail card into view — the reply flow is decoupled from the highlight.

We want the interaction model the Dev already knows from Google Docs:

1. Select text → a small comment trigger appears next to the selection.
2. Click it → an inline composer opens; the selection stays visibly highlighted while typing.
3. Save → the highlight persists in the Plan.
4. Later, click any highlighted span → the comment thread for that span comes into focus, ready to reply.

## Smallest concrete change

Everything is **UI-only** (no schema, no contract, no server work). Five files modified, two added. One new package dependency.

### Dependency

- **`bun add @tiptap/extension-bubble-menu` in the Console workspace** (`apps/console`). Verified: this package is *not* in `apps/console/package.json` today (it is present in `bun.lock` only as an optional peer of `@tiptap/react`, which does not guarantee importability). First implementation step. No other deps needed.

### Modified

1. **`apps/console/components/thread/editor/editor.tsx`**
   - Delete the sticky `"Comment on selection"` button bar at the top.
   - Mount a `BubbleMenu` (Tiptap extension) with a single comment-icon button. Shown when a non-empty, non-whitespace text selection exists in the editor and the editor is editable.
   - On bubble-button click: capture `quote`, `context`, `{from, to}` (as today) → call `begin(...)` on the composer store → **immediately apply a `pending: true` CommentMark to the captured range** so the highlight persists when focus leaves for the textarea.
   - Existing `handleClick` already focuses comments by id — keep, but route it through the new focus state (Q6).
   - Existing post-save effect that swaps the captured range to a saved mark stays; it now updates the existing pending mark in place (set `pending: false`, set `commentId`) rather than creating one.

2. **`apps/console/components/thread/editor/comment-mark.ts`**
   - Add a `pending: boolean` attribute (default `false`).
   - `renderHTML`: switch on `pending` →
     - pending → `bg-amber-500/20 border-b border-amber-500 rounded-sm`
     - saved → existing `bg-accent/15 border-b border-accent/50 cursor-pointer rounded-sm`
   - New command `setPendingCommentMark()` and `promotePendingToCommentMark(commentId)` (rename existing `setCommentMark` only if it stays clean; otherwise keep both — the existing `setCommentMark` is still useful for the "swap to saved" path).

3. **`apps/console/components/thread/comments-rail.tsx`**
   - Replace the stacked list with a **sticky header** + **positioning canvas**.
   - Sticky header: `Comments` label, `Show resolved` checkbox, `Archive ▾` dropdown trigger.
   - Archive dropdown: renders `archived_comments` (the server-reconciled list — see CONTEXT.md "Archive"). Read-only per CONTEXT.md: no reply, no resolve, no reopen. Each row shows the original `plan_quote` italicised. Closed by default.
   - Canvas: a `relative`-positioned div whose height equals the editor's content height; cards rendered absolutely at their computed y. Implementation lives in the new `comments-canvas.tsx`.
   - Drop the `plan_quote` italic line from `CommentCard` (Q9). Quote available via `title` attribute on the card (hover tooltip) and in the Archive view.
   - Empty state (when `comments.length === 0` and no composer is open): dashed-border placeholder card "Select any Plan text to start a Comment."
   - `NewCommentCard` keeps its existing submit path (POST `comments`, then optional `replies`), and is rendered by the canvas at the pending mark's y. Cmd/Ctrl+Enter submits; Esc or outside-click silently discards.

4. **`apps/console/components/thread/thread-view.tsx`**
   - Lift `focusedCommentId` state to this component; pass setter to the editor (via prop replacing today's `onJumpToComment`) and reader to the rail.
   - Pass the live Tiptap editor instance (via a ref kept on the `PlanEditor`) down to the rail, so the rail's canvas can measure anchor positions.
   - **No client-side anchor reconciliation.** The server already does this: `apps/console/server/comments.ts:96 reconcileCommentAnchors()` runs on every `writePlan` and flips `archived_at` on comments whose `plan_quote`/`plan_context` no longer match. The Console already receives the split `comments[]` (live) + `archived_comments[]` (archived). The client just renders what it gets; archived comments live behind the Archive dropdown (read-only per `CONTEXT.md` Archive entry).
   - Transient case (between Dev edit and the next 800ms debounced save): a live comment's mark may already be gone from the editor DOM while the server still considers it live. The canvas simply doesn't render a card for it until the next refetch reconciles. No special UI state — the comment momentarily disappears from the canvas. Acceptable because (a) the gap is ≤800ms, (b) the comment will reappear in the Archive after save, (c) any flash is the consequence of the Dev's own deletion.

5. **`apps/console/lib/stores/composer-store.ts`**
   - No structural change. Composer state (pending comment lifecycle) stays here; **focus state lives in `ThreadView` local state** — see A3 below for why this differs from the 2026-05-28 2.1 autonomous decision.

### Added

6. **`apps/console/components/thread/comments-canvas.tsx`**
   - Pure layout component. Props: `comments`, `focusedCommentId`, `onFocusChange`, `editor`, `threadId`, `composerOpen`, `pendingAnchorY`.
   - `containerRef` is the canvas's own `<div ref>` (a `position: relative` block inside the rail's `<aside>`, below the sticky header). All measurements are normalised to this element — see U6.
   - Uses the `useAnchorPositions` hook to get `Map<commentId, number>` (container-local y, in px).
   - Runs the **greedy de-overlap algorithm** (Q5):
     1. Build entries `[{ id, anchorY, height }]`. Height handling: see A7 below — initial render is `opacity: 0` so first-frame y=anchor is invisible; a layout pass on the next rAF measures each card and applies the de-overlap pass; opacity goes to 1 with a CSS transition. No visible flash.
     2. Sort by `anchorY` ascending.
     3. Walk: `placedY = max(anchorY, previousBottom + gap)`; `previousBottom = placedY + height`.
     4. If `focusedId` is set, run a two-pass variant — pin focused at `anchorY`, walk pre-focused entries upward from focused, walk post-focused downward.
   - Renders each card absolutely positioned at `placedY` with a CSS transition on `top`.
   - Renders the `NewCommentCard` at `pendingAnchorY` when `composerOpen` is true.
   - Outside-click and Esc dismiss focus.

7. **`apps/console/hooks/use-anchor-positions.ts`**
   - Hook. Signature: `useAnchorPositions(editor: Editor | null, containerEl: HTMLElement | null) => { positions: Map<string, number>; pendingY: number | null }`.
   - `positions` is `commentId` → y coordinate in *container-local* pixels (so cards positioned absolutely inside the canvas align with the text in the editor column).
   - Mechanism: query the editor's DOM (`editor.view.dom`) for every `[data-comment-id]`, compute `el.getBoundingClientRect().top - containerEl.getBoundingClientRect().top`, store in the map.
   - Pending mark: rendered with `data-pending="true"` (added in `comment-mark.ts`); same y computation, returned as `pendingY`.
   - Recompute triggers (all coalesced into one rAF):
     - editor `update` event (debounced 100ms)
     - `ResizeObserver` on `editor.view.dom`
     - `window` `resize`
     - `window` `scroll` — see U6 for why this is correct: the page scrolls as a whole; both columns share the same scroll context.

## Layer placement

Per `AGENTS.md` rule 19:

- **DB queries** — none added. No schema change, no new server queries.
- **Business rules** — none added. No new server modules; reuses existing `apps/console/server/comments`, `apps/console/server/replies` via the existing `api` client. No new event kinds.
- **Route handlers** — none added or modified.
- **UI** — all changes here. Within UI:
  - `editor.tsx` continues to own editor wiring + selection capture.
  - `comment-mark.ts` owns the ProseMirror schema for the mark (pending and saved variants).
  - `comments-rail.tsx` owns rail data plumbing + sticky header + archive dropdown.
  - `comments-canvas.tsx` (new) owns absolute layout + collision algorithm + outside-click/Esc dismissal.
  - `use-anchor-positions.ts` (new) owns DOM measurement + recompute timing.
  - `thread-view.tsx` continues to be the orchestrator (state shared between editor and rail).

## Deletion test

Applied to every new module (CONTEXT.md §2: "if we deleted this in 6 months, where does the complexity reappear?").

- **`comments-canvas.tsx`** — if deleted, the absolute-positioning + collision algorithm collapse back into `comments-rail.tsx`, which would then be responsible for both "rail furniture" (sticky header, archive dropdown, data plumbing) *and* "absolute card layout." Those are two genuinely different concerns: one is data-flow, the other is timing-sensitive layout math. The complexity does not vanish on deletion — it reappears as a longer, harder-to-read `comments-rail.tsx`. **Verdict: justified.**
- **`use-anchor-positions.ts`** — if deleted, the measurement loop (DOM query + ResizeObserver + scroll/resize listeners + rAF debounce) moves into `comments-canvas.tsx` as a `useEffect`. The canvas would then own both *measurement* and *rendering*. Those couple uncomfortably — measurement is imperative + timing-sensitive, rendering is declarative. Splitting is the seam that makes both testable in isolation and lets us swap measurement strategy (e.g. to ProseMirror coords) without touching layout. **Verdict: justified.**
- **`focusedCommentId` as a Zustand store** — *not* doing this. The state is shared between exactly two siblings (editor + rail), both already children of `ThreadView`. Lifting to local state is sufficient; a store would be a "future second consumer" abstraction (CONTEXT.md: one adapter is hypothetical).

## Alternatives considered

For decisions where there's a real trade-off rather than an obvious choice:

### A1. Pending highlight: Tiptap mark vs CSS overlay vs nothing

- **Tiptap mark with `pending: true` attr** *(chosen)* — reuses the existing mark machinery, naturally follows the text if the doc reflows during composition, cleans up via `unsetCommentMark`. Slight schema surface added.
- **CSS overlay** (an absolutely-positioned div over the selection's bounding rect) — avoids schema change but desyncs if the user types or the Agent edits the plan mid-compose. Fragile.
- **No pending highlight; rely on browser selection** — rejected immediately because the browser selection halo disappears when focus leaves the editor (the whole point of the change).

### A2. Card positioning: y-positioned with greedy de-overlap vs sticky-on-focus stacked

- **Y-positioned + greedy de-overlap** *(chosen)* — the Docs feel. Cards genuinely align with their anchors. Cost: collision algorithm + re-measurement on edits/resize/scroll.
- **Stacked list, focused card scrolls to anchor y** — much cheaper. Cards don't visually align until focused. Trade-off rejected during grilling (Q3).
- **Collapse clusters into "+N" badges** — too aggressive for the comment density Tempo is likely to see (handful per Plan).

### A3. Focus state: lifted local state vs the existing composer store vs URL

- **Lifted local state in `ThreadView`** *(chosen)* — single source of truth in the natural parent, no premature abstraction.
- **Extend the Zustand composer store with a `focusedCommentId` field** — superficially attractive because the 2026-05-28 2.1 autonomous decision (recorded in `AGENTS.md`) already chose the store for cross-sibling Comment state. *Why we do the opposite here:* in 2.1 the editor was the **sole writer** of `setCommentMark`; the store carried a one-shot id from a non-editor caller (the rail's `NewCommentCard`) so the editor could react via a `useEffect`. Focus state is different: both the editor (click highlight → set focus) and the rail (click card → set focus) are mutual readers *and* writers, and `ThreadView` is already the parent that owns the editor ref and the rail's data. There is no prop-drilling to avoid (the seam is one hop, not three) and no third caller in sight. The composer store's purpose remains "pending-comment lifecycle"; co-locating focus there would muddy that concern. If a future feature adds a third focus writer (e.g., a chat sidebar or URL-driven deep link), this lifts cleanly back into the store.
- **URL hash (`#comment-{id}`)** — would survive reload + be linkable, but introduces routing wiring this feature doesn't need. Could be added later if linkable focus is requested.

### A4. Anchor reconciliation: server vs client

- **Server, as today** *(chosen)* — `reconcileCommentAnchors` already fires on every `writePlan`, flipping `archived_at` for comments whose `plan_quote`+`plan_context` no longer match the markdown. The Console receives `comments` (live) + `archived_comments` (archived) split on every `GET /threads/:id`. The client is purely a reader of that split.
- **Client-side detection (an earlier draft of this plan)** — diff `comments[]` against the set of `[data-comment-id]` marks in the live DOM, surface a separate "Orphaned" sub-list. **Rejected:** duplicates server work, introduces a new product noun ("orphaned") that conflicts with the established **Archive** vocabulary in `CONTEXT.md`, and would race the server's reconciliation (client might "orphan" before the server has archived). Server reconciliation is already the single source of truth for "is this Comment still anchored?".

### A5. Bubble menu: Tiptap `@tiptap/extension-bubble-menu` vs custom positioner

- **Tiptap extension** *(chosen)* — handles selection tracking + Tippy.js positioning + auto-hide on collapse. Already in the same ecosystem as `@tiptap/react`.
- **Custom popover from `getBoundingClientRect`** — re-implements known-working code.

### A6. Archive UI: dropdown vs always-visible panel vs modal

- **Header dropdown** *(chosen)* — discoverable, doesn't compete with the canvas for vertical space, matches the sticky-header pattern used by the rest of the rail furniture.
- **Always-visible panel below the canvas** (today's pattern) — adds a second scroll region inside the rail and makes the canvas's height harder to reason about.
- **Modal** — too heavyweight for read-only browsing of a small list.

### A7. First-render height handling: invisible-first-frame vs min-height vs visible-flash

- **Invisible first frame** *(chosen)* — render each newly-mounted card with `opacity: 0` at its anchor y, measure on the next `requestAnimationFrame`, then run the de-overlap pass with real heights, then `opacity: 1` with a 150ms CSS transition. Cards never visibly flash to a wrong position; the cost is one rAF (~16ms) before a new card appears.
- **Min-height constant on the card** — would let us position immediately, but `CommentCard` has variable height (replies + reply box + status pills + proposed-edit code blocks), so a min that prevents the flash for cards-with-content also makes empty cards artificially tall.
- **Accept the flash, mask with CSS transition** — works but visibly wrong on first paint; users with a fast machine will see the jump. The invisible-first-frame approach is the same code path with a single `opacity` swap added, so the cost is the same.

## Uncertainties

Listed explicitly per CLAUDE.md ("'I'm not certain' beats a confident guess").

- **U1: Tiptap BubbleMenu across multi-paragraph selections.** When a selection spans paragraphs, the menu's positioning is based on the selection's bounding rect. It can flicker if the rect changes as the user drags. Need a manual smoke test; if flicker is bad, pin to the *anchor* (selection start) rather than the rect.
- **U2: DOM mutation timing after `editor.commands.setContent(...)`** on external refetches. React-managed Tiptap re-renders the DOM, but our anchor-position recompute must happen *after* the new DOM is committed. We trigger off `editor.on('update', ...)` which fires after the transaction commits; need to verify this includes `setContent` calls. Fallback: subscribe to the `transaction` event and use `requestAnimationFrame`.
- **U3: Pending mark and copy-paste.** If the Dev selects a span overlapping a pending mark and pastes into the same doc, the pending mark may travel with the pasted slice. Need to either strip pending marks on paste (via a `transformPastedHTML`) or restrict pending marks to a single span by id-equality. Likely small fix; will know once we try it.
- **U4: Cluster crowding when many comments anchor within a small range.** Greedy de-overlap will push later comments far below their anchor; their visual association with the highlight weakens. Decision (not now): ship without a "+N more below" affordance; revisit only if user feedback shows the disassociation is real. Worst case it looks like a stacked list, which is what we have today — graceful degradation.
- **U5: ProseMirror position stability across `setContent`.** The captured `{from, to}` on the composer store is used after `Comment` creation to apply the saved mark. If the doc was replaced by a refetch between begin and submit, those positions are wrong. Today's flow has the same bug latent. Not in scope to fix here; flagging as known.

### Resolved during plan revision

- **U6 (resolved): Y-coordinate basis.** Verified from `apps/console/components/thread/thread-view.tsx:114` and the surrounding layout: the outer container (`<div className="min-h-dvh">` → `<div className="... grid grid-cols-1 lg:grid-cols-[1fr_360px] ...">`) has no `overflow` rule. **The page scrolls as a whole**; the editor column and the rail `<aside>` share that single scroll context. The only sticky element today is the page header (`sticky top-0` on `<header>`).
  - **`containerEl` for `useAnchorPositions` = the canvas's own `<div>` inside `<aside>`**, not the sticky header's wrapper. Specifically: `<aside>` contains the sticky header band followed by a `<div ref={containerRef} className="relative">` — that div is the canvas, has `position: relative`, no `overflow`, and is laid out below the header in normal flow.
  - Y formula: `cardY = highlightEl.getBoundingClientRect().top - containerRef.current.getBoundingClientRect().top`. Both bounding rects are viewport-relative; the subtraction yields container-local pixels, which is what an absolutely-positioned card inside `containerRef` needs.
  - Scroll listener attaches to `window`, not to the rail or editor, because the page scrolls as a whole. Sticky header re-pinning during scroll does not affect the canvas's `getBoundingClientRect().top` (sticky elements stay in normal flow for layout purposes).

## Destructive actions

None.

- No `git push`.
- No migrations (no DB changes).
- No package publishes.
- No external messages.
- No file deletions outside the modified file set above.
- Changes are entirely additive to UI source files; previous-state recoverable via git.

No Dev acknowledgement required.

## Out of scope

Confirmed during grilling. Listed so the judge doesn't have to ask:

- Mobile / narrow viewport layout.
- Notion-style hover-over-line "+" margin trigger.
- Emoji reactions / inline edit-suggestion icons.
- `Cmd+Shift+M` keyboard shortcut to start a comment without first opening the bubble menu.
- Animation polish beyond CSS transitions on `top`.
- Confirm-on-discard dialog when the composer has unsaved text.
- URL-linkable focused comments.
- Re-anchoring a previously-archived comment to a new range (already deferred post-MVP per `CONTEXT.md` Archive entry).

## Pickup notes (after judge approval)

If APPROVED, implementation proceeds in this order so each step is testable in isolation:

0. `bun add @tiptap/extension-bubble-menu` in `apps/console`; confirm import works in a throwaway editor test.
1. `comment-mark.ts`: add `pending` attr + styling + `data-pending` render. Verify with manual mark insertion in dev tools.
2. `editor.tsx`: replace sticky button with BubbleMenu; on click, apply pending mark + open composer. Verify the highlight persists when focus leaves the editor.
3. `use-anchor-positions.ts`: implement + smoke-test via console-logging the map in `ThreadView`.
4. `comments-canvas.tsx`: render cards at their y with `opacity: 0` → rAF measure → opacity 1. Verify alignment with a single comment.
5. Add greedy de-overlap. Verify with 5+ comments clustered on adjacent lines.
6. `comments-rail.tsx`: sticky header + Archive dropdown (renders `archived_comments` read-only).
7. `thread-view.tsx`: lift focus state, wire editor ref through to the canvas.
8. Final pass: outside-click + Esc dismiss focus; Cmd+Enter submit composer; `readOnly` gates the bubble menu; archive list is read-only.

Both review agents (`code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer`) run after step 8, in parallel, per CLAUDE.md.
