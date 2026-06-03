# Plan — Thread-level Activity widget (B2) + Stop hook

## Problem

Two related issues surfaced from running `[2.19]` in production:

1. **Wrong placement.** The Activity card lives inside the Discussion panel,
   but Claude's tool calls aren't Discussion-specific — Comment-reply work and
   Plan-edit work fire the same hooks. When the Dev is looking at a Comment
   thread, they can't see Claude is working. The activity is *thread-level*
   state mis-located in one panel.
2. **Stuck spinner.** PreToolUse fires only *before* each tool. There's no
   "tool completed" or "turn ended" signal in our current hook config, so the
   spinner on the most-recent tool row stays on forever when Claude goes idle
   (Dev screenshot: `tempo_post_discussion_message` spinning for 2 min after
   turn ended).

## Goal

Move the Activity surface to a floating **B2 glanceable mini-card** in the
Thread's bottom-right corner (visible from any panel), and add a **Stop hook**
that emits an `agent_turn_ended` event so the spinner clears at end-of-turn.

The B2 widget always shows:
- The current todo (or the count `N of M` if no TodoWrite yet) — top line
- The current tool with spinner — bottom line
- Click → expands the V2 card as a popover anchored to the widget

When Stop fires, the spinner becomes a dot, the widget stays visible (final
state). When the Dev sends a new message OR new agent_tool_use arrives after
Stop, the activity resets / turn re-starts as today.

## Smallest concrete change

### 1. Contracts — `agent_turn_ended` event + `/turn-ended` HTTP shape

**File:** `packages/contracts/src/events.ts` — **three coordinated edits** (the
same drift hazard AGENTS.md line 176 documents; same mitigation as `[2.19]`):

1. **Add the schema** near `AgentToolUseEvent`:
   ```ts
   export const AgentTurnEndedEvent = eventBase.extend({
     kind: z.literal('agent_turn_ended'),
   });
   ```
2. **Append to `Event` discriminated union** after `AgentTodosUpdatedEvent`.
3. **Append `'agent_turn_ended'` to `EventKind` enum** at the same line as
   the other `agent_*` kinds. Missing this entry causes silent SSE-subscription
   failure (no compile error; spinner never clears).

**File:** `packages/contracts/src/http.ts`

- Add `RecordTurnEndedRequest = z.object({})` (empty body — Stop hook has no
  meaningful payload to forward; the act of POSTing IS the signal).
- Add `RecordTurnEndedResponse` mirror of the others.

### 2. Agent — Stop hook + new CLI subcommand

**File A:** `apps/agent/src/stop-hook.ts` (NEW, ~60 lines)

Restored from the deleted `[2.18]` arm but stripped of the spawn-respawn
control flow. The new stop-hook's only job is: read stdin (ignore the
transcript), fire-and-forget POST to `/api/sessions/:id/turn-ended`, exit 0
within Claude Code's 5s hook budget. **Duplicates the ~25-line
`fireAndForget` HTTP-with-timeout helper from `hook-relay.ts`** rather than
extracting a shared module — at the moment this plan executes, `fireAndForget`
has exactly one production caller; the second one (`stop-hook.ts`) is being
*created* in this same change, so the seam-becomes-real rule (AGENTS.md
rule 10) is not yet satisfied. Filed under "Spotted but not fixed" as a
consolidation candidate once both files have lived in tree for a release.

**File B:** `apps/agent/src/pty-terminal.ts`

Extend `HOOK_SETTINGS_JSON` to include a Stop hook in addition to PreToolUse:

```ts
hooks: {
  PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `${cli} hook-relay`, timeout: 2 }] }],
  Stop: [{ matcher: '*', hooks: [{ type: 'command', command: `${cli} stop-hook`, timeout: 2 }] }],
}
```

**File C:** `apps/agent/src/cli.ts`

Register the new `stop-hook` subcommand alongside the existing
`hook-relay`, `mcp-stdio`, and `connect` subcommands.

### 3. Console — new POST route for `/turn-ended`

**File:** `apps/console/app/api/sessions/[id]/turn-ended/route.ts` (NEW)

Mirrors the existing `/tool-use` and `/todos-updated` routes exactly: same
`authFromRequest` guard (`actor === 'agent'` + `session_id` matches URL),
parses against `RecordTurnEndedRequest`, calls `recordAgentTurnEnded(id)`.

### 4. Console — `recordAgentTurnEnded` server function

**File:** `apps/console/server/status.ts`

Add as a sibling of `recordAgentToolUse` and `recordAgentTodosUpdated`.
Reuses the extracted `threadIdForSession` helper. Just appends an event:

```ts
await appendEvent(threadId, { kind: 'agent_turn_ended' });
```

### 5. Console — `LiveActivity` shape + reducer

**File:** `apps/console/hooks/use-thread-events.ts`

Extend the type:

```ts
export type LiveActivity = {
  todos: AgentTodo[] | null;
  toolCalls: ToolCallEntry[];
  turnActive: boolean;  // <-- new
};
const EMPTY_ACTIVITY: LiveActivity = { todos: null, toolCalls: [], turnActive: false };
```

Update `applyLiveActivity`:

- `agent_tool_use`: existing list-prepend logic + **set `turnActive: true`**.
- `agent_todos_updated`: existing logic (no change to `turnActive` — TodoWrite
  fires during an active turn; the flag is already true if any tool fired).
- `agent_turn_ended`: **set `turnActive: false`** (preserve todos + toolCalls
  so the widget stays visible with final state).
- `discussion_message_posted` (author='dev'): existing full reset.

Initial state: `turnActive: false`.

### 6. Console — `ActivityCard` component (extracted V2 card body)

**File:** `apps/console/components/thread/activity-card.tsx` (NEW)

Extract the V2 card body (todos checklist + tool stack + "+N earlier ·
expand") from the existing `live-activity-group.tsx` into a standalone
component. **No outer wrapper** ("AGENT ACTIVITY" divider) — that was
Discussion-panel chrome and doesn't belong here.

Props:

```ts
{ todos: AgentTodo[] | null; toolCalls: ToolCallEntry[]; turnActive: boolean }
```

`turnActive` controls whether the first tool row gets a spinner (true) or a
dot (false). Same `+N earlier · expand` toggle behavior.

For long todo lists (Dev's question about "big task" scenarios): add
`max-height: 260px` + `overflow-y: auto` on the todo list. If
`todos.filter(t => t.status === 'completed').length > 6`, render a single
collapsed "▸ N completed · expand" row above the active+pending rows by
default. (This is the long-list behavior demonstrated in
`activity-placement-six.html` under "Big task · 18 todos".)

### 7. Console — `ActivityWidget` component (B2 floating)

**File:** `apps/console/components/thread/activity-widget.tsx` (NEW)

Floating bottom-right card. Reads `useLiveActivityGroup(threadId)`. Hides
itself entirely when `todos === null && toolCalls.length === 0`.

Layout (from `activity-placement-six.html` B2 mockup):
- Top line: current step (active todo's `activeForm ?? content`) OR `"N of M done"` if no todos yet
- Bottom line: latest tool with spinner (if `turnActive`) or dot (if not)
- Click anywhere → opens `ActivityCard` as a popover anchored above the widget
- Outside click closes the popover

Positioning: `position: absolute; bottom: 18px; right: 18px;` within the
Thread container. **NOT `position: fixed`** — the widget should belong to the
Thread surface, not float over global chrome.

### 8. Console — wire into `thread-view.tsx`

Two edits in this file:

1. **Add `relative` to the grid wrapper** at `thread-view.tsx:195`. Current
   class string is `mx-auto max-w-[1600px] px-6 py-6 grid gap-6 ${gridClass}`
   — neither this div nor the outer `min-h-dvh` wrapper at line 170 has a
   positioning context today, so a bare `position: absolute` widget would
   escape to the sticky `<header>` (z-20) or the viewport. Append `relative`
   to make the grid wrapper the positioning context. (Verified by reading
   the file — this is a known gap, not a "confirm before shipping" item.)
2. **Mount `<ActivityWidget threadId={threadId} />`** as the last child of
   that same grid wrapper (just before its closing `</div>`). The widget
   self-hides when empty so it costs nothing on approved/idle Threads.

Scope rationale (Alternative 6): we keep `position: absolute` bounded to the
Thread grid rather than `position: fixed` to the viewport so the widget
belongs to the Thread surface and disappears with it on navigation.

### 9. Console — remove old activity surface from Discussion

**File:** `apps/console/components/thread/discussion/discussion-panel.tsx`

Remove `<LiveActivityGroup threadId={threadId} />` from the `endSlot` prop.
Replace with `endSlot={null}` (or simply omit). The Discussion panel goes
back to message-only — no activity rendering there.

**Delete:** `apps/console/components/thread/discussion/live-activity-group.tsx`

The component is superseded by the new `ActivityCard` + `ActivityWidget`
split. Net: one component file out, two in, with a sharper separation between
"the card body" and "where the card lives".

### 10. AGENTS.md — two Spotted-but-not-fixed entries

a. Append to the existing entry about `/tool-use` and `/todos-updated`
   silently-401'ing on null `session_id`: `/turn-ended` inherits the same
   flaw by mirroring the route shape. Single line on the existing entry.
b. New entry: **`fireAndForget` HTTP helper is duplicated between
   `hook-relay.ts` and `stop-hook.ts`.** Two near-identical ~25-line copies
   of the same HTTPS request-with-timeout shape. Consolidate to a shared
   module once a third caller appears or the next change in `apps/agent/src`
   needs to touch the duplicated logic. Filed 2026-06-02 with `[2.20]`.

## Alternatives considered

1. **Client-side side-effect heuristic** (mark turn-ended when SSE delivers
   `discussion_message_posted` author=agent / `plan_edited_by_agent` /
   `reply_added`). Cheaper — no new hook, no new event. Rejected because (a)
   purely-exploratory turns (Claude polls, reads, decides nothing needs
   committing) leave the spinner stuck, (b) mid-turn discussion messages
   would briefly clear it before the next tool restarts — minor jank. Stop
   hook is more semantically accurate.

2. **PostToolUse hook** (per-tool completion signal). Most precise spinner
   clearing. Rejected: doubles hook traffic (2 POSTs per tool call), and the
   per-tool precision isn't needed — the user's complaint is "spinner stuck
   at idle", which Stop solves. The mid-turn "thinking between tools" gap is
   acceptable (Claude's not really idle, just inferencing).

3. **Variant A1/A2/A3 (header strip)** for placement. Compared in
   `activity-placement-six.html`. Rejected by Dev: B2's floating widget
   doesn't compete with the page title and stays out of the way when
   irrelevant.

4. **Extract a shared `fireAndForget` between hook-relay and stop-hook now,
   vs. duplicate and consolidate later.** ~25 lines of HTTP-with-timeout
   helper. Considered extracting to `apps/agent/src/internal-http.ts`
   immediately. Rejected: at plan-writing time `fireAndForget` has exactly
   one production caller (`hook-relay.ts`); `stop-hook.ts` is being created
   in this same change. AGENTS.md rule 10 ("a seam becomes real only when
   two or more adapters satisfy it") is not yet satisfied at the moment of
   first introduction. Duplicate now, file under "Spotted but not fixed",
   let the next change with eyes on the area do the consolidation once both
   files have lived in tree.

5. **Hide the widget entirely on Stop vs. keep it visible.** Hiding is
   cleaner but loses "what was Claude doing on its last turn?" context. The
   user wanted glanceable persistent visibility. Keep visible until Dev
   message resets it.

6. **Floating widget as `position: fixed` to viewport vs `position: absolute`
   to Thread container.** Fixed is more "always visible" but escapes the
   Thread's visual scope (would float over global nav). Absolute keeps it
   bound to the Thread — Dev navigates away → widget gone, as expected.

## Uncertainties

1. **Stop hook payload shape and behavior.** Per Claude Code docs the Stop
   hook input includes `{ session_id, transcript_path, stop_hook_active,
   hook_event_name: 'Stop' }`. We don't use any of these — we just need to
   exit 0 fast. **Important**: returning non-zero from a Stop hook *blocks*
   the turn from ending. We must never return non-zero. Wrap the POST in a
   try/catch that swallows errors. Verify behavior with a probe before
   shipping.
2. **Does Stop fire on `/compact`?** Need to verify. If Compact triggers Stop,
   we'd falsely clear the spinner mid-compact (cosmetic, not harmful — a new
   tool will re-set turnActive when Claude resumes).
3. **`stop_hook_active: true`** in the Stop input means Claude is *already*
   continuing past a previous Stop block. We should still POST `agent_turn_ended`
   in that case — the user wants the signal each time Claude decides to stop,
   even if a prior continuation is in effect.
4. **`EventKind` enum drift** (AGENTS.md → "Spotted but not fixed" line 176).
   Adding `'agent_turn_ended'` to `events.ts` requires two atomic edits: the
   `Event` discriminated union AND the `EventKind` enum. Missing the enum
   entry means the browser's `EventSource` never subscribes to the new kind
   and the spinner never clears (silent failure, no compile error). This is
   the same drift hazard `[2.19]` navigated for `agent_todos_updated`; same
   mitigation: explicit checklist in step 1 enumerating both edit sites.

## Layer placement

| File | Layer | Why |
|---|---|---|
| `packages/contracts/src/events.ts` | contract | new event kind |
| `packages/contracts/src/http.ts` | contract | new request shape |
| `apps/agent/src/stop-hook.ts` | hook adapter | Claude Stop → Tempo event |
| `apps/agent/src/cli.ts` | CLI dispatcher | register subcommand |
| `apps/agent/src/pty-terminal.ts` | spawn config | inline Stop in hook JSON |
| `apps/console/app/api/sessions/[id]/turn-ended/route.ts` | route handler | thin parse → server |
| `apps/console/server/status.ts` | server module | event-log write |
| `apps/console/hooks/use-thread-events.ts` | client adapter | reducer extension |
| `apps/console/components/thread/activity-card.tsx` (NEW) | UI component | V2 card body, render-only |
| `apps/console/components/thread/activity-widget.tsx` (NEW) | UI component | floating B2 wrapper |
| `apps/console/components/thread/thread-view.tsx` | UI component | mount widget |
| `apps/console/components/thread/discussion/discussion-panel.tsx` | UI component | remove old mount |
| `apps/console/components/thread/discussion/live-activity-group.tsx` | DELETED | superseded by activity-card + activity-widget |

## Deletion test

- `AgentTurnEndedEvent` kind: delete → spinner never clears at idle. Keep.
- `stop-hook.ts`: delete → Claude Stop signal never reaches Console. Keep.
- `/turn-ended` route: delete → POST 404, signal lost. Keep.
- `recordAgentTurnEnded`: delete → can't write events. Keep.
- `ActivityCard`: delete → no card body to render in popover; widget has
  nothing to expand to. Keep.
- `ActivityWidget`: delete → no Thread-level activity surface; back to
  invisibility-during-Comment-work problem. Keep — *is* the feature.
- `live-activity-group.tsx`: keeping it would leave a parallel surface — old
  Discussion mount + new Thread mount, two cards on screen. Delete.

## Destructive actions

- **Re-introduce `stop-hook.ts`** — same file name we deleted in `[2.18]` but
  for a different purpose (UI signal, not control flow). Confirming with Dev
  via this plan; the prior architectural rationale for deletion (pty mode
  needs no respawn) doesn't apply to the new use case.
- **Delete `live-activity-group.tsx`** — superseded.
- **Remove activity rendering from `discussion-panel.tsx`** — visible UX
  change. Discussion goes back to message-only.
- **Extend `HOOK_SETTINGS_JSON`** to add Stop alongside PreToolUse — touches
  hook config in a way that could regress hook-budget timing. Mitigation:
  Stop hook is fire-and-forget under 200ms, well within the 5s Stop budget.

No DB migration (no schema changes), no removed columns.

## Out of scope (file under AGENTS.md → "Spotted but not fixed")

- PostToolUse per-tool completion signal (only relevant if mid-turn
  "thinking gap" stuck-spinner becomes a real complaint).
- Activity widget keyboard shortcut (open/close via `⌘.` etc).
- Persisting widget collapse state across reloads.
- Long-todo-list "show only active + pending by default" — implemented as a
  default-collapsed `▸ N completed · expand` row in `ActivityCard` but the
  collapse trigger isn't customizable in this round.
- Migrating any Stop-hook behavior to the new Task tools (TaskCreate /
  TaskUpdate / TaskGet / TaskList) — still locked to TodoWrite via
  `CLAUDE_CODE_ENABLE_TASKS=0` from `[2.19]`.
