# Discussion panel — Dev↔Agent free-form channel, with Clarification Rounds folded in

## Problem

Today the Console gives the Dev exactly two ways to talk to the Agent:

1. **Anchored Comments** in the Plan editor — every Comment must quote a specific text range. Good for line-level pushback ("rewrite this bullet"), wrong for approach-level questions ("did you consider XState?", "re-explore the auth layer before drafting Phase 2").
2. **Clarification Rounds** — Agent-initiated structured forms (`single_choice`, `multi_choice`, `open_text`) that surface as a screen-blocking modal (D13).

There is no Dev-initiated, unanchored, free-form channel. Devs work around this by anchoring meta-questions to an arbitrary line of the Plan, which abuses the anchor mechanism — the anchor is meaningless and the Comment dangles the moment the Plan is rewritten.

Separately, the Clarification Round modal is a hard mode switch that loses conversational context: it pops over the Plan, the Dev answers, it dismisses, and the questions vanish from the UI. Reviewing what was asked, in what order, alongside the rest of the back-and-forth, is impossible after the fact.

## Smallest concrete change

Introduce **Discussion** — one singleton per Thread — as a left-side toggleable panel that hosts a rolling stream of **Messages** plus (folded in) any **Clarification Round** rendered as an inline structured card. One channel, three message shapes, one UI surface.

### Vocabulary (CONTEXT.md additions)

- **Discussion** — *the* free-form channel between Dev and Agent on a Thread. Singleton (one per Thread). Append-only stream of Messages and inline Round cards. Frozen when the Thread is `approved`; unfrozen on Reopen.
- **Message** — one entry in the Discussion. Authored by Dev or Agent. **Text only.** Markdown rendered the same way Reply text is rendered (`MarkdownText`). No anchor, no resolved state, no edit-proposal payloads.

The Clarification Round noun stays as defined in CONTEXT.md; only its surface (modal → inline card in Discussion) changes.

### The smallest concrete change, by layer

#### 1. Contracts (`packages/contracts/`)

- New primitive `DiscussionMessage` in `primitives.ts`:
  - `id: MessageId` (new nominal type, prefix `msg_` — matches the existing shortening pattern `thr_`/`ses_`/`pln_`/`cmt_`/`rep_`/`rnd_`/`evt_`).
  - `thread_id: ThreadId`
  - `author: 'dev' | 'agent'`
  - `text: z.string().min(1).max(8_000)`
  - `created_at: IsoTimestamp`
- One new event kind in `events.ts` (added to `Event` union and `EventKind` enum):
  - `discussion_message_posted` — `{ message: DiscussionMessage }`.
- Two existing event kinds keep their semantics; the UI changes that consume them now route Round events through the Discussion panel instead of the modal.
- HTTP shapes in `http.ts`:
  - `POST /api/threads/:id/discussion/messages` → `CreateDiscussionMessageRequest { text }` / `CreateDiscussionMessageResponse = DiscussionMessage`.
  - `GetThreadResponse` extended with `discussion: { messages: DiscussionMessage[] }`. **No `last_opened_at` field** — read-state lives client-side (see Alternatives F).
- MCP tool in `mcp.ts`:
  - `tempo_post_discussion_message` — input `{ text }`, output `{ message_id: MessageId }`. Agent-authored Messages flow through this. Mirrors `tempo_post_reply`. *(Routing this through `tempo_post_reply` is not viable: `Reply.comment_id` is `NOT NULL`, and the `edit_proposed` / `edit_done` payload variants carry anchor-specific fields — Discussion Messages have no anchor and no proposal payloads. Making `comment_id` nullable to share the tool would push a `Reply-without-Comment` fiction into every Reply consumer.)*
  - The Agent reads incoming Dev Messages via the existing `tempo_poll`; `discussion_message_posted` enters the same event stream. No new poll tool.
- `McpTool` enum gains `tempo_post_discussion_message`. No new `McpErrorCode` values — `thread_approved` covers freeze; `invalid_input` covers the rest.

#### 2. DB (`apps/console/db/`)

- New migration `0003_discussion.sql`:
  - `discussion_messages` table only: `id TEXT PRIMARY KEY`, `thread_id TEXT NOT NULL REFERENCES threads(id)`, `author TEXT NOT NULL CHECK (author IN ('dev','agent'))`, `text TEXT NOT NULL`, `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`. Index on `(thread_id, created_at)`.
- **No** `threads.discussion_last_opened_at` column. Read-state is client-local — `localStorage` key `tempo:thread:<threadId>:discussion_seen_at` stamped on panel open. Solo Dev + single browser (D7) makes server-side persistence unnecessary; see Alternatives F.
- No other table changes. Clarification rounds keep their existing `clarification_rounds` table; only their UI surface moves.

#### 3. Server (`apps/console/server/discussion.ts`)

A single new flat file, matching the existing sibling pattern (`server/comments.ts`, `server/replies.ts`, `server/rounds.ts`, `server/plan.ts` — each holds its Drizzle queries inline alongside its business rules; the codebase has no `db-queries/` sublayer and inventing one for this feature alone would be a premature seam, P13).

`apps/console/server/discussion.ts` exports:

- `listMessagesForThread(threadId)` → `DiscussionMessage[]`. Drizzle query against `discussion_messages`, ordered `(created_at, id) asc`. Same shape as `listCommentsForThread` in `server/comments.ts`.
- `postMessage(threadId, author, text)` → appends row + emits `discussion_message_posted` event via the existing `appendEvent` pipe. Rejects with HTTP 409 + `error: 'thread_approved'` (existing convention in the codebase for state errors, distinct from McpErrorCode) when the Thread is approved. Rejects with HTTP 409 + `error: 'round_pending'` when `pending_round !== null` AND `author === 'dev'`. Agent Messages are allowed during a pending Round (rare in practice; the UI blocks the Dev composer).

No business rules in route handlers; route handlers are thin (parse → validate via `@tempo/contracts` → call `server/discussion.ts` → format response).

#### 4. Routes (`apps/console/app/api/`)

- `app/api/threads/[id]/discussion/messages/route.ts` — `POST` handler. Auth: bearer token (Agent) or session cookie (Dev) — same convention as the existing `WritePlanRequest` route, which already derives the actor from auth.

`GetThreadResponse` is hydrated with `discussion` in the existing `app/api/threads/[id]/route.ts` GET handler — one extra call to `listMessagesForThread`.

#### 5. MCP server (`apps/agent/src/mcp-server.ts`)

- Register `tempo_post_discussion_message` alongside `tempo_post_reply`. Same auth, same error mapping, same HTTP shape.
- `tempo_poll` requires zero changes — the existing event stream automatically carries `discussion_message_posted` events because the Agent's poll loop iterates over `EventKind.options`.

#### 6. Agent prompt (`apps/console/server/initial-prompt.ts`)

- Add a "Discussion" section under the existing "Tools" / "Polling loop" structure:
  - What it is (Dev-initiated free-form channel; unanchored; reply style same as Comment replies — short, designer-to-PM tone, three short paragraphs at most; same `MarkdownText` rendering, so light markdown is fine).
  - When to use it vs Comments vs Rounds (Comments = line-level; Rounds = structured batch you initiate; Discussion = Dev asks you something free-form).
  - **Behavior on `discussion_message_posted` (Dev → Agent):** read the new Message, decide whether to reply. If yes, call `tempo_post_discussion_message` once. Batch: if the Dev posted multiple Messages between polls, reply once that addresses all of them, not N replies.
  - **Behavior during a pending Round (Agent perspective):** continue to attend to incoming Dev Messages if they arrive (rare — UI blocks the Dev composer, but a race is possible), but do not start new Discussion threads of your own; finish the Round first.

#### 7. UI (`apps/console/components/thread/`)

The user's constraint: this must feel Series-A dev-tool grade — Linear / Vercel / Resend / Raycast level. Concrete commitments (the **UX bar** section below makes these enforceable, not aspirational):

- **`discussion-panel.tsx`** — the panel itself. `'use client'`. Fixed-position drawer anchored to the left edge, animated in/out with a `transform: translateX` + opacity transition (180ms cubic-bezier(0.22, 1, 0.36, 1) — same easing the rest of the Console uses). Width: `360px` on `<1600px`; on `≥1600px` the panel sits inline with Plan + Comments rather than overlaying (the "adaptive" decision — see UX bar).
  - Three regions, top-to-bottom: **header** (`Discussion` title + close button + relative timestamp of last activity); **stream** (`MessageList`); **composer** (`MessageComposer`).
  - Esc closes the panel unless a Round is pending. ⌘W / ⌘. do nothing here (Console-wide convention).
- **`discussion-button.tsx`** — fixed-position FAB at bottom-left, 44×44px, primary background with `brand-green` ring on hover, unread badge rendered as a 16px pill on the top-right of the button. **Unread count = `messages.filter(m => m.author === 'agent' && m.created_at > seenAt).length`**, where `seenAt` is read from `localStorage` key `tempo:thread:<threadId>:discussion_seen_at` (ISO string, or `null` if never opened). Round-pending state shows a pulsing dot (no count) in the brand-green color, takes priority over the unread count if both apply. Disabled visually (greyscale, no hover) only when `pending_round !== null` *and* the panel is already open — never disabled in a way that hides Round information from the Dev.
- **`message-list.tsx`** — virtualised list (use `@tanstack/react-virtual`, already installed — see Uncertainty U2) sorted oldest-first, auto-scrolls to bottom on new Message *only if* the user is already within 80px of the bottom (otherwise show a small "↓ N new" pill, same pattern Linear uses). Date dividers between days. Render each Message as:
  - Author label (`You` / `Agent`) in `body-sm-medium`, muted timestamp on the right
  - Body via `MarkdownText` (the component already in the codebase from the markdown-rendering plan)
  - No avatars (Solo Dev per D7; the visual hierarchy is "Dev vs Agent", not "Person A vs Person B")
- **`message-composer.tsx`** — multi-line auto-growing textarea (min 1 row, max 6, scroll past that). `⌘↵` to send; `↵` for newline. Placeholder: *"Ask about the approach — anything not tied to a line of the Plan."* When `pending_round !== null` *and* the author is the Dev, the textarea is disabled with placeholder *"Answer the Round above to continue."*. Send button is icon-only (arrow-up), enabled only when the textarea has non-whitespace content.
- **`round-card.tsx`** — Clarification Round as an inline card in the stream. Card chrome: 1px hairline border, 8px radius, `surface-soft` background, `brand-green` left edge (3px wide) to mark it as a Round. Header: *"Agent is asking N questions"* + Round age. Body: each question rendered via the existing `clarification-modal.tsx` question components (we'll extract those — see "Refactor of the modal" below). Footer: Submit button; disabled until every question has an answer (the existing atomic-answer rule, D12/D14).
- **Empty state** of the stream — when there are zero Messages and no Round, render one centered block: small icon + line *"Ask the Agent something about the approach — anything not tied to a line of the Plan."* + a one-line example below in muted text (*"e.g. 'Why did you reject the polling approach?'"*). No tutorial, no onboarding stepper.
- **Thread-view changes** (`thread-view.tsx`):
  - Local state `discussionOpen: boolean` (defaults to `false`).
  - **Round-blocking invariant — single source of truth:** the value `pending_round !== null` from the TanStack Query cache entry `['thread', threadId]` (hydrated from `GetThreadResponse`, kept fresh by the existing SSE handler) drives three derived UI states:
    1. `discussionOpen` is forced to `true` whenever `pending_round !== null` (auto-open).
    2. The Discussion close button is hidden and the panel's Esc handler is suppressed when `pending_round !== null`.
    3. The composer is disabled when `pending_round !== null` AND the actor is Dev (via composer `disabled` prop). The placeholder explains why.
    These three are the *only* enforcers of the D13 blocking semantics in the new world. There is no modal overlay; the gate is application state derived from one value. If `pending_round` changes (Round answered → null), all three states release in the same render.
  - Layout grid switches based on `discussionOpen` and viewport width:
    - Closed: existing `[1fr 360px]` (Plan + Comments).
    - Open + viewport `<1600px`: `[360px 1fr]` (Discussion + Plan); Comments rail hidden.
    - Open + viewport `≥1600px`: `[360px 1fr 360px]` (Discussion + Plan + Comments). Tailwind: `lg:grid-cols-[1fr_360px] 2xl:grid-cols-[360px_1fr_360px]` — Tailwind's default `2xl` breakpoint is 1536px; we customise it to 1600px in `tailwind.config` to match the decision.
- **Existing `ClarificationModal` is removed** from `thread-view.tsx`. The component itself (`clarification-modal.tsx`) is **partially extracted, not deleted**: the question-rendering subcomponents move into `discussion/round-card.tsx`'s file (or a shared `round-questions.tsx` if it grows past ~120 lines). The modal chrome (the overlay + backdrop) is the only part deleted.

#### 8. CSS (`globals.css`)

- Reuse the existing `.reply-md` scope from the markdown-rendering work — same inline-code + fenced-code styling, same `MarkdownText` component. Forking to `.discussion-md` happens only if a visual divergence is needed; default is reuse.
- One animation keyframe for the FAB's "Round pending" pulse (subtle, 1.4s, ease-in-out, opacity 0.6 → 1 on a `brand-green` outer ring).

### UX bar (enforceable, not vibes)

The Dev wrote: *"Make sure the UI to be intuitive and should feel like series A tech dev tool startup."* That risks devolving into taste arguments at review time. To make it reviewable:

1. **Single-click affordance.** Open Discussion → one click on the FAB. No menu, no submenu. Close → one click on X, or Esc, or click outside the panel on `<1600px`.
2. **Keyboard parity for power users.** `⌘/` toggles the panel. `⌘↵` sends from the composer. `Esc` closes (unless Round pending). All three documented in the empty-state tooltip on first open (one-time, dismissable via `localStorage` flag `tempo_discussion_seen=1`).
3. **No layout jank.** Opening / closing the panel uses `transform: translateX`, not `display`, so the Plan does not reflow during the transition. On `<1600px` where the Comments rail hides, Comments fade out (120ms opacity 1 → 0) *before* Discussion slides in (180ms), staggered so the Dev sees one motion, not two. On `≥1600px` the Plan does not resize at all.
4. **Live presence.** When the Agent's status is `connected` (existing `session_status`), the panel header shows a 6px brand-green dot + *"Agent connected"*. When `disconnected`, a slate dot + *"Agent disconnected — Messages will be delivered on reconnect"*. No spinners; no "Agent is typing…" (we don't have that signal and faking it is dishonest).
5. **Density.** Each Message is 1 row of author/time + N rows of body. Vertical padding 8px between Messages, 16px between day groups. Body line-height 1.5. The same `body-sm` size as Reply text — no oversized chat bubbles.
6. **No chat bubbles.** Messages are flush-left, full-width within the panel, with a 3px left edge in `brand-green` for Agent Messages and `hairline` for Dev Messages (same visual rule as the Round card, applied subtly). This reads as "thread of work" not "iMessage".
7. **Empty state without noise.** No animated illustrations, no onboarding modal, no "Welcome to Discussion 👋". One line of copy + one example.
8. **Read state is honest.** Unread badge counts Agent Messages with `created_at > localStorage[tempo:thread:<id>:discussion_seen_at]`. Opening the panel sets the key to `new Date().toISOString()` (and clears the badge in the same render via React state). Scrolling does not clear (Linear's rule). Per-browser is acceptable because Solo Dev (D7) — if the Dev switches browsers, the badge re-shows past Agent Messages, which is *worse than wrong but better than lying*: it reminds the Dev to re-read context.
9. **No notifications outside the panel.** No browser notifications, no in-app toasts ("Agent replied!"). The badge on the FAB is the only out-of-panel signal. Toasts are reserved for Plan-edit pings (existing `Sparkles` toast).
10. **One opinionated motion vocabulary.** Same easing curve and duration for panel slide, FAB hover scale (1.0 → 1.02 on hover, 0.98 on press), and message-enter animation (8px slide-up + opacity, 140ms). No bouncy springs, no anime.

Items 1–10 are testable manually and noted in the implementing PR's verification list (rule 22 — verification before completion).

## Layer placement (rule 19)

| New code | Layer | Why |
|---|---|---|
| `DiscussionMessage`, `MessageId`, the single new event kind, HTTP shapes | `packages/contracts/src/` | Frozen contracts between Console and Agent. |
| `discussion_messages` table (no new column on `threads`) | `apps/console/db/schema.ts` + new migration `0003_discussion.sql` | Persistence layer. |
| `server/discussion.ts` (`listMessagesForThread`, `postMessage`) | Server business-rules layer (flat file, matches `server/comments.ts` etc.) | Owns the freeze rule (post during `approved` → reject), the Round-blocks-Dev-Message rule, and the event-emit. Drizzle queries co-located inline — no `db-queries/` sublayer. |
| `POST /api/threads/:id/discussion/messages` | Route handler layer | Thin: parse → validate via `@tempo/contracts` → call `server/discussion.ts` → format response. |
| `tempo_post_discussion_message` MCP tool | `apps/agent/src/mcp-server.ts` | Mirrors `tempo_post_reply`. |
| Initial-prompt update | `apps/console/server/initial-prompt.ts` | Text the Agent reads on connect. |
| `discussion-panel.tsx`, `discussion-button.tsx`, `message-list.tsx`, `message-composer.tsx`, `round-card.tsx` | UI layer (`apps/console/components/thread/discussion/`) | New folder for grouping; co-located with the rest of the Thread-view UI per CONTEXT.md §5 (locality beats cleverness). |
| Tailwind config breakpoint customisation | `apps/console/tailwind.config.ts` | One-line override (`screens: { '2xl': '1600px' }`). |
| `.discussion-md` (or reuse `.reply-md`) | `apps/console/app/globals.css` | CSS layer. |

No business rules in route handlers. No DB calls in UI components. No HTTP shapes leaking into `server/`. No `interface IDiscussionService` / `class …Impl` invented for a future second backend.

## Deletion test (CONTEXT.md §2)

- **`Discussion` (the concept itself)**: if deleted in 6 months, Devs lose the unanchored channel and regress to anchoring meta-questions to arbitrary Plan lines (the original problem). Comments would carry questions that don't belong to any text range; the anchor-loss reconciliation in `comment-cards.tsx` would silently dangle these the moment the Plan is rewritten. Complexity reappears as data integrity loss. **Justified.**
- **`Message` (separate from `Reply`)**: if deleted, the only path is to repurpose `Reply` for unanchored use (a Reply without a parent Comment). That breaks the existing FK constraint `replies.comment_id NOT NULL`, breaks the existing payload variants (`edit_proposed` with no anchor makes no sense), and forces every consumer of Replies to handle a "comment_id might be null" branch. Complexity reappears as schema rot. **Justified as a separate noun.**
- **`round-card.tsx` (moving Round into Discussion)**: if deleted (i.e. we revert to the modal), the conversational context of past Rounds is lost — they vanish after answer. The Dev cannot review what was asked alongside the rest of the back-and-forth. Complexity reappears as "where did that Round go?" support questions. **Justified.**
- **`discussion-panel.tsx` + the toggle layout**: if deleted, we'd need to host the Discussion *somewhere* — the candidates are right-rail tabs (forces a mode switch with Comments, see Q4 rejected option B) or a modal (regresses to the Round-modal problem, just for chat). Neither is better. **Justified.**
- **`MessageId` as a nominal primitive**: borderline. We do not currently treat IDs nominally elsewhere except for the existing `CommentId`, `ReplyId`, `RoundId`, `SessionId`, `ThreadId`. Keeping the pattern consistent earns its keep; collapsing to raw `string` for this one type would create asymmetry. **Justified by symmetry.**
- **`server/discussion.ts` as its own file vs adding to `server/comments.ts`**: justified — `server/comments.ts` owns the anchored-Comment business rules; Discussion is a different lifecycle (no resolved state, no anchor reconciliation). Putting them in the same module would force a "kind: 'comment' | 'message'" discriminant on internal helpers. Separate file, separate concerns. **Flat file** (not a folder) matches every existing sibling in `server/`.

## Alternatives considered

### A. Single rolling stream vs many discrete "Asks" (Q2 in the design grilling)

**Chosen: single rolling stream.** Simpler data model, fewer UI states, matches the Dev's mental model ("chat with the Agent about the approach"). Tradeoff: no per-thread resolved state — but unread state + the freeze-on-Approve rule covers the lifecycle.

Rejected: **N discrete Asks each with their own Replies and resolved state**. Adds an Ask noun, an Ask list, per-Ask resolved actions, and a list-vs-detail navigation pattern. Pro of this path: triageable ("3 open Asks awaiting Agent"). Con: heavier model for an MVP that doesn't yet have the Dev complaint it solves. If Devs start treating Discussion as a backlog, revisit.

### B. Layout — left toggleable panel vs three other shapes (Q4)

**Chosen: option D from the grilling — toggleable left panel, hides Comments on narrow viewports, adaptive (three-column) on `≥1600px`.**

Rejected:

- **Always-on left sidebar.** Three columns by default crushes the Plan width on a 1280px laptop. The Plan is the deliverable; it doesn't lose pixels.
- **Tabbed right rail (Comments | Discussion).** Forces a mode switch — Devs can't see Comments while talking about the approach. Conflates two different shapes (anchored vs free-form) into one switcher.
- **Bottom-right floating panel (Intercom-style).** Cheap on layout but feels ephemeral. The Dev wanted persistence.

### C. Move Round into Discussion vs keep modal (Q-pivot)

**Chosen: move Round into Discussion as an inline structured card.** Same blocking semantics (Plan + Comments + Dev composer all gated), different chrome. Preserves conversational context after the Round is answered. Unifies all Agent → Dev communication in one surface, sets up the Phase-2 Activity log to use the same panel.

Rejected: **keep the modal.** Pros: minimum implementation change. Cons: keeps two parallel surfaces (modal + future Discussion) and loses post-answer conversational context. The Dev explicitly suggested the pivot; the unification is worth the D13 amendment.

### D. Agent reply payloads — text only vs text + edit_proposed (Q5a)

**Chosen: text only.** Clean conceptual split — Comment carries edit proposals (anchored), Discussion is talk. If the Agent decides during Discussion that the Plan should change, it writes directly (`tempo_write_plan`); the existing "Plan updated by Agent" toast already covers the Dev-side signal.

Rejected: **text + `edit_proposed` mirroring Replies.** Pros: inline Approve/Reject in the Discussion. Cons: contract bloat now, prematurely. Add later if Devs actually ask for a preview gate on Discussion-triggered edits.

### E. Handoff — Discussion included vs Plan-only (Q9)

**Chosen: Plan only.** D3 ("Tempo does not re-enter the picture after handoff") is explicit. The Plan is the artifact; if a reasoning chain from Discussion is important enough to act on, the Agent should have written it into the Plan.

Rejected: **append Discussion transcript to the handoff payload.** Bloats the fresh Claude session's prompt for marginal value. Reversible later if Devs ask.

### F. Read state — server-side persistence vs client-local

**Chosen: client-local (`localStorage`).** The unread badge counts Agent Messages with `created_at > localStorage[tempo:thread:<id>:discussion_seen_at]`. Opening the panel stamps the key to `new Date().toISOString()`.

Rejected: **server-side `threads.discussion_last_opened_at` column + `POST /api/threads/:id/discussion/opened` route + `discussion_opened` event.** Justification for rejection:

- Solo Dev per D7 — there is exactly one human party per Thread.
- Single-browser per Session is the de-facto MVP target (no mobile, no second device).
- The "last opened" timestamp does not need to be readable by the Agent — the Agent has its own poll cursor.
- The only scenario where server-side persistence would matter is the Dev switching browsers (or clearing storage) and expecting their unread-state to migrate. In that case the badge would re-show past Agent Messages — a soft over-count, never an under-count. The Dev re-reads context they may have forgotten. This is preferable to building one DB column, one HTTP route, one event kind, one server function, one route handler, and one extra `GetThreadResponse` field for a multi-device case that does not exist.
- If the multi-device case ever arrives, the migration path is straightforward: add the column, add the route, add the event kind, change the client to write through, change the badge math to compare against the server value. The localStorage key becomes a fallback. No data loss; no breaking change.

## Uncertainties

- **U1. CSS scope.** Resolved — reuse `.reply-md`. No new scope. Forking only happens if a visual divergence is needed at implementation time, and that is a follow-up, not part of this plan.
- **U2. Virtualisation dependency.** Verify `@tanstack/react-virtual` is in `apps/console`'s dependency tree. If yes, use it for `message-list.tsx`. If not, fall back to non-virtualised render — none of the MVP Threads will exceed ~100 Messages, so the optimisation only matters for the long-tail case where the Dev re-opens a freeze-then-reopen Thread. Verify at implementation start with `grep '@tanstack/react-virtual' apps/console/package.json`.
- **U3. `round_pending` HTTP error shape.** The existing pattern in the codebase uses HTTP 409 + `{ error: '<domain_code>' }` for state errors (e.g. `thread_approved`). No new `McpErrorCode` value is needed — the Agent only writes via `tempo_post_discussion_message`, and that path is never blocked by a pending Round (Agent Messages are allowed during a Round). The 409 + domain code only fires on the Dev path. Verify at implementation start by reading the existing error envelope in `apps/console/server/http.ts`.
- **U4. Auto-open behavior on Round arrival vs initial page load.** When the Dev navigates to a Thread that already has `pending_round !== null` on initial render, the panel auto-opens (sticky). When `pending_round` flips from null → non-null *while* the Dev is on the page, same behavior. Both paths are driven by the *same derived state* (`discussionOpen = userOpened || pending_round !== null`), implemented as a `useMemo` over the TanStack Query cache value — there is no separate "on mount" handler and no separate "on SSE" handler. One source of truth, two delivery paths, one render rule.
- **U5. Mobile breakpoint behavior.** Below ~768px, the panel becomes a full-screen drawer. The Plan goes behind it; Comments rail is already hidden at that breakpoint. This is more layout work than the desktop case implies. The MVP target is desktop; mobile is "doesn't break" rather than "polished". Plan: render the panel as `inset-0` on `<sm`, ship without further polish, file under "Spotted but not fixed" if a Dev reports issues.
- **U6. SSE handling for `discussion_message_posted`.** The existing `use-thread-events.ts` `apply()` switch has a `default: return next` arm (line 153) — unknown event kinds do *not* silently corrupt state, they just update `last_event_id` and pass through. Adding `discussion_message_posted` without a `case` is *not* a correctness bug; it would just mean the cache isn't updated for the new event and the UI would only see new Messages on the next refetch. A `case 'discussion_message_posted':` arm is still required for live updates — it must spread the new message into `data.discussion.messages` (de-duped by id). One arm; no other event-handler changes.
- **U7. Round event consumption.** Today `round_opened` is consumed by the modal mount logic in `thread-view.tsx`. Moving to inline-card-in-Discussion means the consumer changes (the same `pending_round` cache value drives the Discussion panel's auto-open) but the event itself is unchanged. Verify no other consumer is reading `round_opened` for analytics/logging — `grep round_opened` shows only the SSE hook and `thread-view.tsx` modal mount.

## Destructive actions

- **Removal of `ClarificationModal` mount from `thread-view.tsx` and deletion of the modal-chrome portion of `clarification-modal.tsx`.** UI-only change; Round data model and contracts unchanged; reversible by re-mounting the modal. Not destructive in the rule-24 sense (no `git push`, no migration drop, no shared-state mutation, no external message).
- **Migration `0003_discussion.sql` adds one new `discussion_messages` table.** Additive — no `DROP`, no column type change, no constraint tightening on existing rows. Not destructive.
- **D13 amendment.** A documentation change in AGENTS.md (Round renders inline in Discussion, not as a modal; new enforcement is the `pending_round !== null` derived state). Reversible by editing the same file.

No `git push`, no `fly deploy`, no package publish, no force-push, no branch deletion, no `rm -rf` outside the working tree, no external messages. Per rule 24, no Dev approval gate is required to proceed.

## Vocabulary additions (CONTEXT.md updates the implementer must make)

The implementer adds two new section entries to CONTEXT.md §1 (Product nouns), positioned alongside Comment / Reply / Clarification Round:

- **Discussion** — definition above (singleton, free-form, frozen-on-approve).
- **Message** — definition above (one entry, text-only, no anchor / no resolved state).

The implementer amends D13 in AGENTS.md to reflect the surface change AND the new enforcement mechanism: *"Clarification Round renders inline in the Discussion panel as a structured card. Blocking semantics are preserved (Plan + Comments + Dev composer are gated until the Round is answered atomically), but the enforcement mechanism changes: instead of a screen-covering modal overlay, the gate is application state derived from a single value — `pending_round !== null` (from the TanStack Query cache of `GetThreadResponse`, kept fresh by the existing SSE handler). That derived value drives three behaviors in `thread-view.tsx`: (a) Discussion panel forced open, (b) Discussion close button hidden and Esc suppressed, (c) Dev composer disabled. Plan editor and Comments rail remain frozen by their existing rules. Supersedes the modal wording."*

The implementer files **D-new** entries (next available D-number) for: Discussion semantics (single rolling stream, text-only Agent Messages), Discussion-not-in-handoff (extends D3 / D22 specifically for the Discussion concept), auto-open-sticky on Round arrival.

## What's intentionally NOT in scope

- **Phase-2 Activity log** (Agent's tool-use stream surfaced in the Discussion panel as a third message shape). The plan in `.plans/agent-activity-feed.md` already covers that; it slots in later as a separate tab or filter inside the same panel without changing the contracts here.
- **Edit-proposed payloads on Agent Messages.** Text-only for v1 (decision D).
- **Per-Message reactions, threading, search.** Rolling chat = no reactions, no threading, no search bar. Revisit if Devs ask.
- **Browser / OS notifications.** Out-of-panel signal is the FAB badge only.
- **Mobile polish.** Below ~768px, the panel renders full-screen but is not designed for; "doesn't break" is the bar.
- **Editing or deleting Messages.** Append-only, same as Comments and Replies (D20). No edit affordance, no delete.
- **Permission / abuse limits.** Solo-Dev (D7), localhost or single-tenant Fly — no per-Message rate-limit needed. Server-side max length (8_000 chars) is the only guard.
- **Read state for the Agent side.** The Agent's `tempo_poll` cursor already covers "what have I seen"; no extra mechanism.
- **Replacing the in-page `ClarificationModal` with a portal-based card in some other surface.** The card lives in the Discussion panel, not the Plan editor and not the header.
