# Plan — Inline TodoWrite + tool-call activity group in Discussion panel

## Problem

Right now, when Claude fires tool calls during a Thread, the Console renders them as a single bottom-of-panel "Working — Read foo.ts" indicator (one line at a time). TodoWrite — Claude's own checklist of what it intends to do — arrives through the same PreToolUse hook as every other tool call and shows up as another anonymous mono-font line; the Dev never sees the structured checklist.

Result: the Dev cannot see what Claude *intends* overall, only what it's doing in the current moment. The information is on the wire (the PreToolUse hook payload carries the full todos array for every TodoWrite call), but the Console doesn't surface it.

## Goal

Render TodoWrite as a structured inline card *inside the Discussion panel*, with the most-recent few tool calls visible below it. At any moment, the Discussion feed contains:

- All existing Discussion Messages (Dev↔Agent text), as today.
- At most **one** live "Agent activity" group, appended after the last message: latest TodoWrite checklist + recent `agent_tool_use` rows.

When a new Dev Discussion Message arrives, the prior activity group **disappears** from the feed. The next burst of tool calls + TodoWrites becomes the new live group below the new message. Past activity is not surfaced in the feed (it remains in the event log for audit).

Picked visual: **V2 — Stacked Tempo card** from `todos-discussion-variants.html` (full checklist with `Todos · 3 of 6` header + vertical mono tool list, 3 visible + "+N earlier · expand"). Aesthetic matches the existing Discussion panel: `canvas`, `hairline`, `ink-subtle`, `accent` (#00d4a4), Geist Mono for tool rows.

## Smallest concrete change

### 1. Contracts — new event kind (three edit sites in one file)

**File:** `packages/contracts/src/events.ts`

This file requires three coordinated edits — AGENTS.md (line 176) flags this as a known drift hazard. Missing the enum entry causes a *silent* failure (no SSE subscription, no compile error).

**Edit 1 — add the schemas** (next to `AgentToolUseEvent`, around line 63):

```ts
export const AgentTodo = z.object({
  content: z.string().max(500),
  status: z.enum(['pending', 'in_progress', 'completed']),
  activeForm: z.string().max(500).optional(),
});

export const AgentTodosUpdatedEvent = eventBase.extend({
  kind: z.literal('agent_todos_updated'),
  todos: z.array(AgentTodo).max(50),
});
```

Shape is verified against Claude Code docs (`https://code.claude.com/docs/en/agent-sdk/todo-tracking.md`): `block.input.todos` is an array of `{ content, status, activeForm }`, with `status ∈ {pending, in_progress, completed}`. `activeForm` is the in-progress phrasing; we mark it `.optional()` to be forgiving across versions.

**Edit 2 — `Event` discriminated union** (line 82, append after `AgentToolUseEvent`):

```ts
export const Event = z.discriminatedUnion('kind', [
  ...
  AgentToolUseEvent,
  AgentTodosUpdatedEvent,   // <-- add
  ...
]);
```

**Edit 3 — `EventKind` enum** (lines 98–111, append `'agent_todos_updated'` in the list):

```ts
export const EventKind = z.enum([
  ...
  'agent_tool_use',
  'agent_todos_updated',    // <-- add
  ...
]);
```

The enum is consumed by `useThreadEvents` to subscribe to SSE/long-poll frames per kind. Without this entry the browser never receives `agent_todos_updated` frames, the selector reads no data, and the activity group never renders.

### 2. Agent — hook-relay branch + spawn env flag

**File A:** `apps/agent/src/hook-relay.ts`

Add a single `tool_name === 'TodoWrite'` branch at the top of `runHookRelay`. When matched:

1. Parse `payload.tool_input.todos` against the Zod schema (`.safeParse` — invalid → fall through to the generic `/tool-use` path so the event isn't lost; UI stays hidden until the next valid payload).
2. POST `{ todos }` to `/api/sessions/${sessionId}/todos-updated`.
3. Return.

All other `tool_name` values: unchanged, still hit `/tool-use`. Net hook-relay diff: one branch, ~15 lines.

**File B:** `apps/agent/src/pty-terminal.ts`

Add `CLAUDE_CODE_ENABLE_TASKS: '0'` to the spawn env block (around line 80). **Why this is mandatory**: as of Claude Code v2.1.142 / TS SDK 0.3.142, sessions default to the new `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` tools, which split a single TodoWrite into multiple per-item calls keyed by `taskId` and have a fundamentally different shape (`{ taskId, status?, subject? }` patches instead of full-list rewrites). Without this env var, the hook-relay's `TodoWrite` branch never fires and the activity card stays empty. Supporting the Task tools natively is recorded in "Out of scope".

### 3. Console — new POST route for todos

**File:** `apps/console/app/api/sessions/[id]/todos-updated/route.ts`

Thin route handler, mirrors the existing `/tool-use` route shape exactly (`apps/console/app/api/sessions/[id]/tool-use/route.ts:7`):

```ts
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  ...
}
```

Dynamic-segment name is `[id]` (not `[sessionId]`) to match the established convention in the sessions namespace. Auth path is identical to the tool-use route: `authFromRequest` → must be `agent` actor with matching `session_id` → 401 otherwise. Parses against a new `RecordTodosUpdatedRequest` HTTP contract (`packages/contracts/src/http.ts`) → calls `recordAgentTodosUpdated(id, todos)` → returns `ok({ ok: true })`.

### 4. Console — server module accepts the new event

**File:** `apps/console/server/event-log/<existing-file>.ts`

Add a `recordAgentTodosUpdated(sessionId, todos)` function that appends an `agent_todos_updated` row to the event log. No new table; the existing event_log row schema already stores `kind` + `payload_json`. Long-poll forwarding is generic (it ships every kind), so no SSE/long-poll change.

### 5. Console — client selector exposes group state

**File:** `apps/console/hooks/use-thread-events.ts`

Add a `useLiveActivityGroup(threadId)` selector that returns:

```ts
{
  todos: AgentTodo[] | null,       // from latest agent_todos_updated since last Dev message
  toolCalls: AgentToolUseEvent[],  // since latest Dev message (or since attach)
  show: boolean,                   // true iff todos || toolCalls.length > 0
}
```

Boundary: "since the most recent `discussion_message_posted` event with `author === 'dev'`, OR since session start if no Dev message yet."

Delete the existing `useLatestToolFeed` hook + the bottom-of-panel "Working — Read foo.ts" indicator in `discussion-panel.tsx`. The new group supersedes both.

### 6. Console — UI component

**File:** `apps/console/components/thread/discussion/live-activity-group.tsx`

Pure render component matching V2 in the mockup. Subcomponents inline:
- `TodoCard` — labeled checklist with done/active/pending marks
- `ToolRow` — mono row with name + summary
- "+N earlier · expand" affordance — local `useState<boolean>`, expand reveals all rows; default 3 visible

Mounted from `MessageList`: when `useLiveActivityGroup(threadId).show`, render `<LiveActivityGroup ... />` after the last message, before the `endSlot`. Replaces the old `endSlot` thinking-indicator entirely.

## Alternatives considered

1. **Separate `agent_todos` table with per-thread upsert** — server pre-computes latest todos and serves them in `attach`/`poll` responses. Faster client (no scan), but adds a new table + migration + write path. Rejected: event-log scan at render time is bounded by the long-poll cursor; for MVP it's fine.

2. **Sticky-top pinned card (original Variant A)** — pinned at top of Discussion regardless of scroll. Rejected by Dev: wants inline-latest to match Lovable UX; pinned card feels heavy in a conversation panel.

3. **Extend the existing `useLatestToolFeed` and bottom indicator into a list** — smaller diff, no new component. Rejected: `useLatestToolFeed` is a single-value contract; extending it to a list and a TodoWrite selector entangles two unrelated concerns. Clean break is shorter overall.

4. **Show prior activity groups as collapsed strips above the next Dev message** — the breadcrumb option we briefly considered. Rejected by Dev: Discussion is a conversation; prior tool-call activity is transient and lives in the event log for audit only.

5. **Extend `/tool-use` with a `kind` discriminator vs new `/todos-updated` route** — would let the hook-relay hit one endpoint for all PreToolUse events:
   - **Extend `/tool-use`**: pro — single POST target in hook-relay; con — `RecordToolUseRequest` is currently `{ tool: string, summary: string }`, two thin strings. Adding `{ kind: 'tool_use' | 'todos_updated', todos?: AgentTodo[] }` muddies its semantics (the route name says "tool-use" but now it's "tool-use or todos") and adds a conditional inside the route handler that branches on `kind`.
   - **New `/todos-updated` route**: pro — clean per-endpoint Zod schema; the route name matches what it does; server-module function (`recordAgentTodosUpdated`) is a sibling of `recordAgentToolUse`, mirroring the event-kind split. Con — hook-relay has two POST targets (one branch). The branch is ~5 lines; the second URL is the only added complexity.
   - **Decision: new route.** The semantic split between "Claude called tool X" and "Claude's todo list now has these items" is real (different event kind, different render path, different consumer in the client). A discriminator on `/tool-use` would force readers to grep both branches to understand what the endpoint does; a separate route makes the semantics obvious from the URL. The hook-relay cost (one extra POST target) is negligible.

6. **Support the new Task tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) instead of locking to `TodoWrite`** — would future-proof against Claude Code's default. Rejected for MVP: Task tools split a single TodoWrite call into multiple per-item events keyed by `taskId`, requiring server-side state accumulation (a per-thread `tasks` map mutated by `TaskCreate` + `TaskUpdate`). That is a substantially larger plan — new contract shapes, a state-machine on the server, idempotency on `TaskUpdate` for the same `taskId`. Locking to `TodoWrite` via `CLAUDE_CODE_ENABLE_TASKS=0` ships the feature in one round; Task-tool support is a future plan when we revisit.

## Uncertainties

1. **~~TodoWrite hook payload field name~~ — RESOLVED.** Verified from Claude Code docs (`https://code.claude.com/docs/en/agent-sdk/todo-tracking.md`): `block.input.todos` is an array; each item is `{ content: string, status: 'pending'|'in_progress'|'completed', activeForm: string }`. `activeForm` is marked `.optional()` in the Zod schema to be forgiving across versions. Safe fallback if the shape changes: `safeParse` failure → fall through to generic `/tool-use` path → no data loss, activity card simply hides until the next valid payload.
2. **`MessageList` mount point**: need to read `apps/console/components/thread/discussion/message-list.tsx` before implementation to confirm a clean "append after last message" slot that doesn't fight virtualization (if present). If virtualized, the activity group renders outside the virtualized container.
3. **Empty TodoWrite array**: Claude occasionally calls TodoWrite with `todos: []` to clear the list. Plan: when latest event has empty todos, `useLiveActivityGroup` returns `todos: null` and the card hides; tool calls (if any) still render under the synthetic "Agent activity" header.
4. **No-Dev-message-yet boundary**: before the first Dev message, *all* tool calls + the latest TodoWrite render as one big group. That can be large (50+ tool calls during initial repo exploration). The "+N earlier · expand" affordance kicks in beyond 3 rows, so the group stays compact by default.
5. **Codex CLI portability** (out of scope, recorded under "Spotted but not fixed"): the `agent_todos_updated` event shape is provider-agnostic; only the hook-relay branch and the `CLAUDE_CODE_ENABLE_TASKS=0` env flag are Claude-specific. When Codex lands, a sibling intercept emits the same event shape.

## Layer placement

| File | Layer | Why |
|---|---|---|
| `packages/contracts/src/events.ts` | contract | shared event schema |
| `apps/agent/src/hook-relay.ts` | hook adapter | Claude PreToolUse → Tempo event |
| `apps/console/app/api/sessions/[id]/todos-updated/route.ts` | route handler | thin parse → validate → server-module |
| `apps/agent/src/pty-terminal.ts` | spawn config | add `CLAUDE_CODE_ENABLE_TASKS=0` to spawn env |
| `packages/contracts/src/http.ts` | contract | `RecordTodosUpdatedRequest` HTTP body schema |
| `apps/console/server/event-log/...` (existing file) | server module | event-log write |
| `apps/console/hooks/use-thread-events.ts` | client adapter | selector over the event stream |
| `apps/console/components/thread/discussion/live-activity-group.tsx` | UI component | render-only, no business logic |
| `apps/console/components/thread/discussion/message-list.tsx` | UI component | mount point — one prop wired |
| `apps/console/components/thread/discussion/discussion-panel.tsx` | UI component | delete `endSlot` thinking-indicator block |

No DB / query logic in route handlers. No business rules in UI components. Tool-call rendering and todo-card rendering both live inside the single new UI module.

## Deletion test

- **`AgentTodosUpdatedEvent` kind**: delete → TodoWrite falls back to anonymous `agent_tool_use` rendering. Feature gone. Keep.
- **Hook-relay TodoWrite branch**: delete → same effect as above; the event kind exists but is never emitted. Keep.
- **`/todos-updated` route**: delete → hook-relay POST 404s; event never written; feature gone. Keep.
- **`useLiveActivityGroup` selector**: delete → component has no data; renders nothing. Keep.
- **`LiveActivityGroup` component**: delete → Discussion panel has Messages only, no activity rendering at all (the old `useLatestToolFeed` is also being deleted). Keep — this component *is* the feature.
- **Old `useLatestToolFeed` + `endSlot` block in `discussion-panel.tsx`**: superseded by the new selector + component. Net change is one component out, one in. Not a parallel system.

## Destructive actions

None. No DB migration (no schema changes). No removed columns. No file deletions outside the safe edits noted above (`useLatestToolFeed` hook and `endSlot` block, both inside the same Discussion module being changed).

## Out of scope (file under AGENTS.md → "Spotted but not fixed")

- Codex CLI provider intercept — event shape is portable; hook-relay equivalent for Codex is a future addition.
- "Show activity history" toggle — past activity groups remain in the event log; surfacing them is a future feature.
- Plan panel — stays as-is, empty until `tempo_write_plan` fires.
- **Native Task tools support** (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) — Claude Code's new default as of v2.1.142. Requires server-side state accumulation keyed by `taskId` and new contract shapes per tool. Locked to TodoWrite via `CLAUDE_CODE_ENABLE_TASKS=0` for this plan; revisit when we want first-class Task-tool support.
