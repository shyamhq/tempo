# Collapse to PTY: retire stop-hook & midturn-hook arms, repartition the PTY driver

## Problem

The PTY arm (`TEMPO_AGENT_LOOP=pty`, landed earlier today) works. The Dev confirmed it, including stdin proxying and the "no comment_resolved notifications" refinement. Two costs remain:

1. **A/B sprawl.** Three loop drivers (`stop-hook`, `midturn-hook`, `pty`) live side-by-side, plus the `TEMPO_AGENT_LOOP` dispatch in `connect.ts`, plus the workflow text in `apps/console/server/workflow.ts` that still instructs Claude to run `ScheduleWakeup(delaySeconds=30, …)` — which the Agent dutifully attempts in pty mode (the Dev's most recent question: `✻ Claude resuming /loop wakeup (Jun 1 6:57pm) ⏺ Calling tempo…`). The call fails silently because `ScheduleWakeup` is not in `PTY_ALLOWED_TOOLS`, but the model wastes a turn on it. **Every keep on the losing arms is dead weight; every word in the workflow that contradicts the winner is a footgun.**
2. **Concern conflation in `pty-loop.ts`.** ~270 lines own seven concerns (child spawn, terminal stdio, raw-mode lifecycle, long-poll, wake watchdog, event filtering, nudge formatting + typing). The file works, but two unrelated changes already would have to touch it (e.g. "we want to mention the kind in the nudge differently" and "we want to swap node-pty for something else"). The seam between *how events arrive from Console* and *how they reach Claude* is not drawn.

## Decision

The PTY arm wins. The other two arms and everything that exists only to serve them are deleted in the same change. The PTY driver is repartitioned along the seam that emerged from running it — the Console-side event stream vs the terminal-side input plumbing — using the Pocock "Interface Design" approach (`INTERFACE-DESIGN.md`, this conversation), specifically the **Minimal interface / maximum leverage** principle.

## Smallest concrete change

### Part 1 — retire the A/B (delete-only)

Files removed entirely:

- `apps/agent/src/spawn-claude.ts` — `child_process` spawn + hook-settings JSON + Stop/PostToolBatch wiring + `ScheduleWakeup` entry in the allowed tools.
- `apps/agent/src/stop-hook.ts` — Stop hook handler.
- `apps/agent/src/post-tool-batch-hook.ts` — PostToolBatch handler.

Files trimmed:

- `apps/agent/src/cli.ts` — remove `stop-hook` and `post-tool-batch-hook` subcommand branches and their imports. `hook-relay` stays (see Constraints).
- `apps/agent/src/connect.ts` — remove the `TEMPO_AGENT_LOOP` switch, the cursor-file creation, the `tmpdir`/`writeFileSync`/`rmSync`/`ZERO_EVENT_CURSOR` imports, and the `spawnInteractiveClaude` branch. Calls `runPtyLoop` unconditionally.
- `apps/console/server/workflow.ts` — collapse §"Polling loop" into a one-line note: *"You don't need to poll. Tempo's CLI injects a `[Tempo] N new Console event(s): …` line into your input whenever new Dev activity arrives; call `tempo_poll` only then to fetch payloads."* Drop the `ScheduleWakeup(...)` instruction and the "Stop hook will block" paragraph entirely.
- `apps/agent/package.json` — `dev` becomes `bun run build && node dist/cli.js` (current `dev:pty`); `dev:pty` is removed since it's now the only dev path.
- `AGENTS.md` — replace the "retirement note" with a one-line "PTY driver is the loop. Stop-hook and midturn-hook arms removed in <commit>." Decision-log entry recording the collapse.

Files unchanged but worth calling out:

- `apps/agent/src/hook-relay.ts` — **kept**. Powers the Console Activity rail (`agent_tool_use` events via `/api/sessions/:id/tool-use`). It is **not** part of the polling-loop A/B; conflating it would lose the live "Agent is calling Read/Bash/…" feed in the Console UI.
- `apps/agent/src/mcp-config.ts`, `mcp-server.ts`, `hook-relay.ts`, `http-client.ts`, `env.ts`, `errors.ts`, `logger.ts` — kept as-is, with the small change in Part 2.

### Part 2 — wire `hook-relay` into the PTY driver

The current `pty-loop.ts` spawns `claude` without `--settings`, so the PreToolUse hook never fires — the Console Activity rail is dark in pty mode (regression versus the stop-hook arm). Fix in the same change: pass `--settings <json>` to the `node-pty` spawn with only the `PreToolUse → hook-relay` entry (no `Stop`, no `PostToolBatch`).

Per rule 11 (one adapter is hypothetical, one caller means inline), the JSON is built inline inside `pty-terminal.ts` — a local `const HOOK_SETTINGS_JSON = JSON.stringify(...)` constant next to the `node-pty.spawn` call. No exported helper, no separate file. `mcp-config.ts` is unchanged.

### Part 3 — repartition `pty-loop.ts` (Pocock INTERFACE-DESIGN.md pass)

The current file fuses two unrelated lifecycles:

| Concern | Belongs to |
|---|---|
| Spawn `claude` in `node-pty`, mirror stdout, proxy stdin (raw mode + Ctrl-C), forward SIGWINCH, write into composer with Enter delay | The **terminal**: child process + user's TTY |
| Long-poll the Console with timeout + wake-watchdog abort + retry, filter events to those Claude must hear about, format the nudge | The **event stream**: `ConsoleClient` ↔ Agent state |

These two halves only meet at one point: an opaque `(events: Event[]) => Promise<void>` callback that the terminal hands to the event stream. That is the seam.

**New layout in `apps/agent/src/`:**

1. `pty-terminal.ts` (~120 lines) — owns the `node-pty` child and the user's TTY.
   - **Interface:**
     ```ts
     type Terminal = {
       inject(text: string): Promise<void>; // writes text, waits ENTER_KEY_DELAY_MS, writes \r
       onExit(handler: (code: number) => void): void;
       close(): void; // SIGINT then SIGKILL after grace, restore cooked mode
     };
     function spawnTerminal(args: SpawnArgs): Terminal;
     ```
   - Hides: `node-pty.spawn`, `--mcp-config`/`--allowedTools`/`--settings` flags, the hook-settings JSON, stdout→PTY data piping, raw-mode stdin proxying with Ctrl-C byte 0x03, `process.on('SIGINT')`, `process.stdout.on('resize')`, cooked-mode restore in cleanup, `rmSync(configDir)` cleanup of the MCP-config tempdir, ENOENT → `TempoError(CLAUDE_MISSING_MESSAGE)`.
   - Three exported names: `spawnTerminal`, `Terminal`, `SpawnArgs`.

2. `event-stream.ts` (~90 lines) — owns the Console-side polling loop.
   - **Interface:**
     ```ts
     type EventStream = {
       start(onBatch: (events: Event[]) => Promise<void>): void;
       stop(): void;
     };
     function createEventStream(args: { client: ConsoleClient; threadId: ThreadId }): EventStream;
     ```
   - Hides: `ZERO_EVENT_CURSOR` initial cursor, the first-pass `wait=0` cursor-advance, the per-attempt `AbortController` + wake watchdog (`setInterval(1000)` + 5 s drift threshold), the `RETRY_BACKOFF_MS` retry on poll error, the loop-level `AbortController` for shutdown.
   - One exported function + one exported type.

3. `nudge.ts` (~40 lines) — pure: `Event[] → string | null`.
   - **Interface:**
     ```ts
     function buildNudge(events: Event[]): string | null;
     ```
   - Hides: `shouldNotify` switch (current rules, including `comment_resolved → false`), kind-count summarization, the `[Tempo] N new Console event(s): …` prose. No imports beyond `@tempo/contracts`.
   - One exported function. Easy to read in isolation; easy to delete or rewrite without touching the loop or terminal.

4. `pty-loop.ts` (~30 lines) — composition only.
   - **Interface:** unchanged from today (`runPtyLoop({ token, sessionId, threadId }): Promise<number>`).
   - Body: write MCP config → `spawnTerminal(...)` → `createEventStream(...)` → `stream.start(events => { const n = buildNudge(events); if (n) await terminal.inject(n); })` → resolve on `terminal.onExit`, stopping the stream first.

Total new code surface is **three small interfaces with one exported function each**, plus the composer. No factories, no DI, no `interface I…`; this is the actual second caller — the existing seven concerns becoming three seams — not a hypothetical one.

### Part 4 — `http-client.ts` is untouched

I checked `apps/agent/src/http-client.ts:50–62`: the `poll` method's existing comment talks only about macOS sleep/wake, `AbortSignal.timeout`, and undici's `bodyTimeout`. There is no comment referencing the A/B drivers. The `waitSeconds = 25` default parameter is already correct for the single remaining caller. **No edits to this file.** (This section is kept as a section heading so the next reader knows the file was checked deliberately, not overlooked.)

## Alternatives considered

1. **Keep the A/B in place; only update workflow.ts.**
   *Tradeoff:* zero risk to working code, fixes the `/loop wakeup` confusion immediately. But leaves 600+ lines of dead Stop/PostToolBatch/cursor-file machinery, three places where `TEMPO_AGENT_LOOP` is read, and the architectural debt of "two-and-a-half ways the loop can run." The Dev explicitly asked to remove the other arms; this option ignores that.

2. **Collapse to PTY but leave `pty-loop.ts` as one file.**
   *Tradeoff:* smallest diff. But the seven concerns in one file is exactly the kind of pre-architecture state the Pocock skill is meant to address, and the Dev cited INTERFACE-DESIGN.md by name. The seam (terminal lifecycle vs event stream) is already real; not drawing it now means drawing it under pressure later.

3. **Split further (one file per concern — 6 files).**
   *Tradeoff:* maximum testability. But violates rule 11 ("one adapter is hypothetical"): there is no real second caller for "raw-mode stdin proxy" as a module separate from "node-pty child," and splitting them gains nothing today. Three files at meaningful seams is leverage; six is decoration.

4. **Use the Claude Agent SDK instead of spawning `claude`, which would let Node embed the loop without a PTY.**
   *Tradeoff:* clean architecture. But ruled out by Anthropic ToS — running an SDK call against a Dev's Claude Code subscription is a ToS violation. (Documented in the prior PTY plan; recorded here so the next reader doesn't ask.)

## Uncertainties

- **`hook-relay` parity in pty mode.** I have not yet confirmed the Console's Activity rail (`use-thread-events`/`status.ts`) renders `agent_tool_use` events identically when they arrive from the PTY-driven session. I expect yes — same `tool-use` POST shape — but plan to verify by running a session post-change and watching the rail.
- **`--settings` arg ordering with `--`.** The current PTY spawn uses `--` to terminate `--allowedTools` so the positional prompt isn't parsed as a tool. Adding `--settings` *before* `--` should be fine, but I'll verify with `claude --help` before the edit. If wrong, the symptom is a hard parse error at spawn, caught on the first dev run.
- **Whether `tempo_poll` stays an MCP tool.** Node owns the loop, so Claude shouldn't need it. But the Dev's last refinement was specifically *"Claude pulls full payloads via `tempo_poll`"* — the model still calls `tempo_poll(cursor)` once per nudge to fetch the bodies (the nudge itself is only counts). So `tempo_poll` stays registered in `mcp-server.ts` and stays in `PTY_ALLOWED_TOOLS` (it already does); the workflow text just stops *instructing* a heartbeat. Recording explicitly so this isn't accidentally deleted.
- **`pty-loop.ts` filename after the split.** `pty-loop.ts` is the composer; keeping the name avoids touching `connect.ts`'s import. Alternative — rename to `agent-loop.ts` since the file no longer owns the PTY directly — is a cosmetic improvement I would skip to keep the diff focused.

## Layer assignment

Per CLAUDE.md rule 19:

| New / changed | Layer | Justification |
|---|---|---|
| `apps/agent/src/pty-terminal.ts` — `spawnTerminal`, `Terminal` | Agent CLI process layer | Owns OS-level concerns (PTY, signals, raw mode). No HTTP, no business rules. |
| `apps/agent/src/event-stream.ts` — `createEventStream` | Agent CLI process layer | Drives `ConsoleClient` (which lives at the HTTP-adapter layer). Pure scheduling / retry — no DB, no UI. |
| `apps/agent/src/nudge.ts` — `buildNudge` | Pure function | No I/O, no async; reads `@tempo/contracts` types only. |
| `apps/agent/src/pty-loop.ts` — `runPtyLoop` | Agent CLI process layer | Composition root. |
| `apps/console/server/workflow.ts` (edit) | Console `server/` | Already in the right layer. |
| `apps/agent/src/cli.ts` (edit, deletes only) | Agent CLI process layer | Already in the right layer. |
| `apps/agent/src/connect.ts` (edit, deletes only) | Agent CLI process layer | Already in the right layer. |

No new code under `apps/console/app/api/**`. No new code under `apps/console/server/db-queries/**`. No React changes.

## Deletion test

For each new module: *"If we deleted this in 6 months, where does the complexity reappear?"*

- **`pty-terminal.ts`** — reappears verbatim inside `pty-loop.ts`: a Dev wanting to *not* spawn `claude` (different binary) or *not* use `node-pty` (different terminal abstraction) cannot stub one without bringing the whole 270-line file. Today there is only one such caller, but the surface (`inject` / `onExit` / `close`) is so small that the seam pays for itself the first time the spawn args change. Survives the test.
- **`event-stream.ts`** — reappears inside `pty-loop.ts`: the wake watchdog, the per-attempt AbortController re-creation, the first-pass cursor advance, the retry policy — these are independent of how nudges get delivered. A future change like "also nudge a Slack webhook with the same batches" or "switch from long-poll to SSE" lands here and only here. Survives the test.
- **`nudge.ts`** — reappears inside the event-stream callback: every tweak to the wording / which events are surfaced (today's `comment_resolved → false` was exactly this kind of change) becomes a diff against an unrelated polling loop. Pure-function isolation makes the change one-file, one-test-in-the-head. Survives the test.
- **`pty-loop.ts`** — does *not* survive the deletion test as a standalone unit if the three others exist. That's fine — it's the composer; its job is to be ~30 lines glueing the three together, not to defend its own existence.

## Destructive actions

Files deleted: `apps/agent/src/spawn-claude.ts`, `apps/agent/src/stop-hook.ts`, `apps/agent/src/post-tool-batch-hook.ts`. The Dev explicitly authorized this in the same turn ("remove all other A/B features"). No `git push`, no `fly deploy`, no migrations that drop columns, no `rm -rf` outside the file deletions named above.

The deletions are recoverable from git history if the call turns out wrong; no DB rows, no shared state, no external services touched.

## Vocabulary check

- "Driver" — used only to refer to the *prior* A/B arms in the Problem section. Going forward the loop is just "the PTY loop" / "the Agent loop." Avoids the LLM-flavored "driver" drift.
- "Module" / "interface" / "seam" / "leverage" — used in the INTERFACE-DESIGN.md sense per CONTEXT.md §"architecture vocabulary."
- "Nudge" — already established in `AGENTS.md` as the one-line `[Tempo] …` injection. Kept.
- Product nouns (Agent, Dev, Console, Thread, Session, Plan, Comment, Reply, Discussion Message, Plan) used per CONTEXT.md.

## Spotted but not fixed

- `pty-loop.ts`'s initial-poll cursor race (window between `createSession` returning and the first `wait=0` poll, during which events that arrive could be missed if `last_event_id` wasn't returned by `createSession`) — already in `AGENTS.md` "Spotted but not fixed." Not relitigated here.
- The `dev:pty` → `dev` rename means the `dev` script no longer runs under Bun's runtime — it runs the built dist/cli.js under Node. This was the deliberate fix for Bun's event loop not holding open for `node-pty` data events; documented in the prior PTY plan. Worth one line in `AGENTS.md` after this change so the next reader doesn't re-discover it.
