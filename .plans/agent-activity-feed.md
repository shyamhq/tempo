# Plan: surface Claude's tool-use as a live activity feed in the Thread view

## Problem

When a Dev runs `tempo-agent connect <token>`, the Console shows:

- a header pill (`exploring — Reading current Thread view + DESIGN.md to grou…`) — one line, comes from `tempo_set_status` via the MCP tool, updated only when the Agent chooses to call it.
- the Plan body area, which is empty until the Agent writes a first draft (`tempo_write_plan`).

Between connect and the first plan write, the Dev stares at a blank Plan area. They can't tell whether the Agent is exploring, hung, or close to drafting. The header pill is too coarse — it updates a handful of times and is always one line.

Goal: while the Plan is empty, surface the Agent's tool-use stream — file reads, globs, greps, bash runs — as a live list in the empty Plan area, so the Dev sees the same kind of "what is Claude doing right now" they'd see in their terminal.

## Smallest concrete change

1. **Capture tool-use from the child `claude` process via Claude Code's hooks.**
   `apps/agent/src/spawn-claude.ts` already writes a temp MCP config file before spawning `claude`. Extend it to also write a temp settings file with a `PreToolUse` hook that runs `tempo-agent hook-relay` (a new CLI subcommand) on every tool call. Pass the settings file to `claude` via `--settings <path>` (verify flag name — see Uncertainty U1).

2. **Add a `hook-relay` CLI subcommand** in `apps/agent/src/cli.ts` that:
   - reads the hook JSON from stdin (`{ session_id, tool_name, tool_input, … }` per Claude Code's hook contract — see Uncertainty U2),
   - reads `TEMPO_CONNECT_TOKEN`, `TEMPO_SESSION_ID`, `TEMPO_THREAD_ID` from env (same env we already inject for the MCP stdio entry point),
   - POSTs a one-line summary to a new Console endpoint,
   - exits 0 quickly (hooks block the Agent until they return; budget < 100ms; never throw to stderr in a way Claude would see, per existing `TEMPO_LOG_TO_STDERR` convention).

3. **Add one new event kind, `agent_tool_use`,** to `packages/contracts/src/events.ts`:
   ```ts
   AgentToolUseEvent = eventBase.extend({
     kind: z.literal('agent_tool_use'),
     tool: z.string(),         // e.g. "Read", "Bash", "Glob"
     summary: z.string().max(200),  // e.g. "DESIGN.md" or "bun run typecheck"
   });
   ```
   No `tool_input` payload stored — only a short, human-readable `summary` the hook script derives. Keeps the event small and avoids leaking arbitrary user content into the event log.

4. **Add one Console endpoint**, `POST /api/sessions/:id/tool-use`, that:
   - validates the Bearer token (same path as the existing session-bound MCP-backing endpoints),
   - calls a new server function `recordAgentToolUse(sessionId, { tool, summary })` in `apps/console/server/status.ts` (the module that already owns `setActivityStatus` — session-scoped event writes that resolve the thread id then call `appendEvent`). This function has the exact same shape as `setActivityStatus`; it does not belong in `sessions.ts`, which owns session lifecycle (create / get / disconnect), not event writes.
   - The route handler stays thin: parse → validate via `@tempo/contracts` → call `recordAgentToolUse` → return 204.

5. **UI: render the feed in the empty-plan area** in `apps/console/app/(ui)/threads/[id]/…` (existing Thread view component that currently renders `"The Agent hasn't drafted a Plan yet…"`):
   - The SSE listener in `apps/console/hooks/use-thread-events.ts` auto-registers for every `EventKind.options` entry, so adding `agent_tool_use` to the enum subscribes us automatically. **However**, the hook's `apply()` switch is exhaustive over current event kinds and the `default` arm returns `next` unchanged — a new kind would be silently dropped from the cache updater. We add an explicit `case 'agent_tool_use':` branch that returns `next` unchanged (intentional no-op: this event does not mutate any TanStack Query cached payload; the feed reads from local React state instead — see next bullet). The branch exists to document the intent and to make `apply()` provably exhaustive over `EventKind`.
   - Maintain a bounded list of the most recent 20 `agent_tool_use` events in **local React state inside the empty-state component**, populated by subscribing to the same SSE source via a small selector (or by reading `lastEvent` exposed from `use-thread-events`). No new Zustand store, no TanStack Query cache entry for the feed.
   - Render each as one line: `<icon> {tool} <muted>{summary}</muted>` with a relative timestamp. Newest at top. The list auto-collapses (hidden) once `plan.body` is non-null — Plan content takes over the area; we don't show the feed and the Plan simultaneously.

That's the change. No new files in Console server beyond a single function added to `sessions.ts`. No new files in Agent beyond a single subcommand added to `cli.ts`. One new contract event. One new endpoint. One UI block in the existing empty-state area.

## Layer assignment

| New code | Layer | Why |
|---|---|---|
| `hook-relay` CLI subcommand | `apps/agent/src/cli.ts` extension | It's a CLI entry point; nests beside the existing `mcp-stdio` subcommand which has the same shape (reads stdin, talks to Console, exits). |
| Temp settings-file writer | `apps/agent/src/spawn-claude.ts` extension | Same file already writes the temp MCP config; this is the same responsibility (preparing the child's config). |
| `POST /api/sessions/:id/tool-use` route handler | `apps/console/app/api/sessions/[id]/tool-use/route.ts` | Thin: parse → validate via `@tempo/contracts` → call `recordAgentToolUse` → return 204. |
| `recordAgentToolUse` | `apps/console/server/status.ts` | `status.ts` already owns `setActivityStatus` — a function that takes a session id, resolves the thread id, and appends one event. `recordAgentToolUse` has the exact same shape and responsibility. `sessions.ts` is wrong (owns session lifecycle, not event writes); a new `tool-feed.ts` is unjustified for a single ~10-line function with no anticipated growth. |
| `apply()` `case 'agent_tool_use':` | `apps/console/hooks/use-thread-events.ts` | Existing exhaustive switch needs one new arm; intentional no-op (returns `next`) because the feed does not back any TanStack Query cache entry. Documented so future maintainers don't mistake it for a missing case. |
| `AgentToolUseEvent` | `packages/contracts/src/events.ts` + the discriminated union + the `EventKind` enum | One new event kind, three small edits to one file. |
| UI feed block | inside the existing Thread view component that renders the empty state | One conditional block; no new component file unless the inline JSX grows past ~40 lines. |

## Deletion test

If we delete the activity feed in 6 months:

- The header pill (`activity_pill`) still works — coarse-grained "exploring/thinking/drafting" status survives.
- The Plan flow itself is unaffected.
- The Dev again has no visibility into between-pill, pre-draft activity → complexity reappears as the original "blank screen" problem.

So the feed earns its keep: it solves a real "what's the Agent doing" gap that the pill alone doesn't cover. We're not adding a layer for its own sake.

If we'd instead added a generic "agent_event" event kind with a free-form payload, that would fail the deletion test — it's an extension point with no second caller. We pick the narrow `agent_tool_use` shape (one tool, one summary string) and let a future second event kind earn its own slot.

## Alternatives considered

1. **Tail `claude`'s stdout and parse tool-use lines** instead of using hooks. Rejected: today `spawn-claude.ts` uses `stdio: 'inherit'` so the Dev sees Claude's UI directly in their terminal — switching to `pipe` and re-rendering loses the interactive TTY (cursor, colors, line editing). Hooks give us the same data Claude already emits, structurally, without owning Claude's UI.

2. **Have the Agent itself call `tempo_set_status` more often** (i.e. ask Claude in the initial prompt to update status before every tool call). Rejected: unreliable (Claude routinely skips status updates when it's "in the flow"), expensive (tokens spent on status updates instead of work), and the existing pill is structurally one line — it isn't a feed. Hooks fire deterministically on every tool call.

3. **Revert to the Agent SDK (`query({ ... })`) embedded in `tempo-agent` instead of spawning `claude` as a child.** That gives a streamed event source. Rejected: we explicitly moved to interactive `claude` last task because the Dev wanted a real interactive Claude Code session (permissions UI, slash commands, etc.). Hooks let us keep the interactive child and still get the stream.

## Uncertainties

- **U1.** Claude Code's flag for passing a settings file. The hook docs show settings files at `~/.claude/settings.json` or `.claude/settings.json` (project), but to pass an ephemeral, per-run file without polluting the Dev's repo we need an explicit flag or env. Possibilities: `--settings <path>`, `CLAUDE_CONFIG_PATH`, or write into `<cwd>/.claude/settings.local.json` and clean up in `finally`. Verify before writing code; if no flag exists, prefer `.claude/settings.local.json` in the spawn cwd (already in Claude Code's default gitignore set) and remove it in the same `finally` block that removes the MCP config.

- **U2.** Exact JSON shape Claude Code writes to the hook's stdin for `PreToolUse`. The docs confirm hooks receive structured input, but the field names (`tool_name` vs `tool` vs `name`; `tool_input` vs `arguments`) need verification before the relay parses them. Fall back: if the shape varies by Claude version, the relay accepts whichever fields are present and degrades to `tool: "unknown"` rather than throwing.

- **U3.** Hook latency budget. Hooks block the tool call until they return. The relay does one HTTP POST to localhost (dev) or Fly (prod). Local should be fine (<20ms). Over public internet to Fly we should consider: (a) fire-and-forget (spawn a detached request and exit 0 immediately), or (b) hard timeout of 200ms. Prefer (a) for the agent_tool_use payload — losing one event is acceptable; blocking the Agent isn't.

## Destructive actions

None. No deploys, no migrations that drop columns, no pushes, no third-party messages. New endpoint is additive; new event kind is additive; new CLI subcommand is additive. The temp settings file is written under `tmpdir()` (or `.claude/settings.local.json` in cwd) and removed in `finally`.

## Vocabulary

"Activity feed" / "tool-use feed" in this plan are **UI-internal descriptive labels**, not new product nouns. They do not enter `CONTEXT.md`. The product surface stays: Agent, Dev, Plan, Comment, Thread, Session, etc. The implementing agent must not introduce "Activity Feed" or "Tool-Use Feed" as a CONTEXT.md term, a UI heading, or a typed primitive. The on-the-wire and in-code names are exactly: event kind `agent_tool_use`, server function `recordAgentToolUse`, route `POST /api/sessions/:id/tool-use`. The UI block can be labelled "Activity" (lowercased visually) but that is presentation, not a canonical noun.

## What's intentionally NOT in scope

- A persistent "activity history" view after Plan exists — feed is empty-state only.
- Filtering / search over tool-use events.
- Surfacing the full `tool_input` (paths, command lines) in the Console — only the short summary. Keeps PII / repo paths out of the event log.
- Replacing the header `activity_pill` with the feed. Pill stays; feed complements it.
- Hooks for `PostToolUse`, `Stop`, `Notification` — only `PreToolUse`. One signal source, one consumer.
