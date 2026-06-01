# Node-driven PTY loop (`TEMPO_AGENT_LOOP=pty`)

## Problem

The Agent's polling loop is distributed across three components — the spawned `claude` child (drives `tempo_poll` via `ScheduleWakeup`), the Stop hook (25 s long-poll on turn end), and the optional PostToolBatch hook — and none of them owns the loop. After a laptop sleep/wake the in-flight `fetch()` in `apps/agent/src/http-client.ts:100` has no `AbortSignal`, so undici's 5-minute `bodyTimeout` is the only backstop; meanwhile `ScheduleWakeup` may not fire on wake, MCP stdio servers don't auto-reconnect, and the Console UI keeps showing the Session `connected` because nothing updates `last_seen_at`. The Dev sees "Agent stuck for minutes after wake," kills the CLI, and reconnects.

The fix is to move the loop into the Node CLI parent process where it can own its lifecycle (timeout + retry + wake watchdog), and push events into Claude as injected stdin text instead of having Claude poll. This collapses ScheduleWakeup, Stop-hook, PostToolBatch, the `tempo_poll` MCP tool, and the cursor file into one Node-side async loop.

## Smallest concrete change

Land the new driver as a third A/B arm behind a renamed env var. Existing `stop-hook` and `midturn-hook` paths stay intact and runnable.

1. **Rename the flag.** Repo-wide: `TEMPO_MIDTURN_HOOK=1` → `TEMPO_AGENT_LOOP=midturn-hook`. Default (unset / anything else) is `stop-hook`. New value `pty`.
   - `apps/agent/src/spawn-claude.ts:98` — `process.env.TEMPO_MIDTURN_HOOK === '1'` becomes `process.env.TEMPO_AGENT_LOOP === 'midturn-hook'`.
   - `AGENTS.md:183` — retirement note rewritten in terms of the new flag and the three arms.

2. **Add `apps/agent/src/pty-loop.ts`** (new, ~150 lines). One exported function `runPtyLoop({ token, sessionId, threadId })`:
   - Spawns `claude` inside a `node-pty` pseudo-terminal with `cols`/`rows` from `process.stdout` and listens for `SIGWINCH` to resize.
   - Pipes PTY output to `process.stdout`. **Does not** pipe `process.stdin` into the PTY — the terminal is a read-only view per Tempo's product model (Dev iterates via Console Comments, not by typing into the terminal).
   - Runs an async long-poll loop against `ConsoleClient.poll(threadId, cursor, 25)`. On non-empty events, writes one `[Tempo] …\n` line per event into the PTY via `pty.write(...)`. Cursor lives in a local variable — no `/tmp` file.
   - Wake watchdog: `setInterval(1000)` checks wall-clock drift > 5 s; on detected wake, calls `controller.abort()` on the in-flight poll so it retries immediately instead of waiting on the timeout.
   - Waits for the PTY child to exit; returns its exit code.

3. **`apps/agent/src/http-client.ts`** — add `AbortSignal.timeout(waitSeconds * 1000 + 5000)` to the `poll` method, and accept an optional caller-supplied `AbortSignal` (combined with `AbortSignal.any` if provided). Same minimum change benefits all three drivers — without it, the existing `stop-hook` and `midturn-hook` arms still hang after wake. ~10 lines.

4. **`apps/agent/src/connect.ts`** — dispatch on `process.env.TEMPO_AGENT_LOOP`. `pty` → `runPtyLoop(...)`. Anything else → existing `spawnInteractiveClaude(...)` path, unchanged. ~8 lines branching.

5. **`apps/agent/src/spawn-claude.ts`** is **not** reused for `pty` mode. The hook settings (`Stop`, `PostToolBatch`), `ScheduleWakeup` in `TEMPO_TOOL_NAMES`, `TEMPO_CURSOR_FILE`, and the `--allowedTools` list are all tied to the polling architecture this driver replaces. The MCP-config write is the only piece both drivers share verbatim, so extract it (see step 6).
   - Tempo MCP tools allowed by `pty-loop.ts`: `tempo_attach`, `tempo_pull_plan`, `tempo_write_plan`, `tempo_post_reply`, `tempo_post_discussion_message`. (Note `tempo_poll` is dropped — Node owns the loop.)
   - Read-only repo tools: `Read`, `Glob`, `Grep`, `Bash`. The Plan is written via `tempo_write_plan` (an MCP call, not a file edit), so `Edit`, `Write`, `MultiEdit` are deliberately excluded. No `--permission-mode acceptEdits`, no `--dangerously-skip-permissions`.
   - The MCP stdio server (`apps/agent/src/mcp-server.ts`) is unchanged: `tempo_poll` stays registered for the other two A/B arms; in `pty` mode it's simply not listed in `--allowedTools`, so Claude won't call it.

6. **Extract `apps/agent/src/mcp-config.ts`** (new, ~18 lines). One exported function `writeMcpConfigFile({ sessionId, threadId, token, extraEnv? })` that contains the `mkdtempSync` + `writeFileSync({mode: 0o600})` block currently at `spawn-claude.ts:115-142`. Both drivers call it with the same JSON shape; the only difference between them is the env block passed to Claude (the hook drivers pass `TEMPO_CURSOR_FILE`, the pty driver doesn't). Optional `extraEnv` parameter handles that.
   - Why extract instead of duplicate: 15 of 18 lines are byte-identical (`mkdtempSync`, `mcpServers` JSON shape, `command: process.execPath`, `args: [CLI_PATH, 'mcp-stdio']`, the four `TEMPO_*` env keys, the `0o600` mode bit). The diff between the two callers is the optional `TEMPO_CURSOR_FILE` env key. That's not "three similar lines" — it's 15-of-18 verbatim duplication of a security-sensitive file write. Deletion test passes cleanly: when the A/B concludes and only one driver survives, the helper has exactly one caller — but the helper still earns its keep as the seam between "what config Claude needs" and "how we write a tempfile securely." If both drivers are deleted at A/B retirement (unlikely — one wins), the helper deletes too. Not a hypothetical adapter (P13): two real callers exist the moment this PR lands.

7. **`apps/agent/package.json`** — `bun add node-pty` (already verified at install time, see Uncertainties → "Install probe results").

8. **`AGENTS.md`** — under "Build progress", a new `[ ]` row: _Agent loop A/B — pty driver (third arm)_. Update the retirement note (item 1 in this plan) and the autonomous-decisions log entry naming the rename and the node-pty postinstall step.

## Alternatives considered

1. **Just add `AbortSignal.timeout` + a Node wake watchdog to today's loop (no PTY driver).** Tradeoff: keeps the three-component loop intact (`ScheduleWakeup` + Stop-hook + `tempo_poll`); we patch the worst symptom but ScheduleWakeup-after-sleep is still undocumented behaviour and the Console pill still lies. Useful as a stopgap. **Step 3 of this plan does this anyway**, so the small win lands either way; the `pty` arm is the structural fix.

2. **Go back to the `@anthropic-ai/claude-agent-sdk` `query()` driver (the pre-2.7 design).** Tradeoff: the cleanest architecturally (no PTY needed, Node fully owns the message stream) but runs against the paid Claude API and using a Claude Code subscription via the SDK violates Anthropic's ToS. Ruled out by billing model. Decision recorded in this plan, not as a new D-decision (the 2.7 commit already chose spawned `claude` and named the TTY reason; this plan adds the ToS reason).

3. **Selected: `node-pty` wrapper, Node-owned long-poll, text injection.** Backend stays as the spawned `claude` CLI (subscription path preserved). Loop lives in one place that can `AbortSignal.timeout` + wake-watchdog its way out of any sleep. Terminal becomes read-only — fine because Tempo's product model already routes all Dev intent through the Console.

## Uncertainties

### Install probe results (resolved 2026-06-01)

Ran `bun add node-pty@1.1.0` followed by a probe script that spawns `/bin/cat` in a PTY, writes two lines via `pty.write(...)`, and prints what came back. Two concrete findings:

1. **Bun strips the executable bit on `node-pty`'s `spawn-helper` binary during install.** The prebuilt `prebuilds/darwin-arm64/spawn-helper` lands as `-rw-r--r--`. At first `pty.fork()` call, posix_spawnp returns EACCES — surfaced as `Error: posix_spawnp failed.` with no further context. Resolution: a `postinstall` script in `apps/agent/package.json` that does `chmod +x node_modules/.bin/../node-pty/prebuilds/<platform>-<arch>/spawn-helper`. Will be added in this plan's step 7. Verified working under both Bun and Node after the chmod.

2. **`bun run src/cli.ts` does not hold the event loop open for `node-pty` data events.** Probe script exited with no data received under Bun, even after timing the writes well within the script's lifetime. Same script under `node --experimental-strip-types` echoed both injected lines correctly:
   ```
   [from pty] "hello from node\r\nhello from node\r\n"
   [from pty] "second line\r\nsecond line\r\n"
   ```
   This is a Bun runtime issue (the native addon's event listeners aren't keeping Bun's main loop alive). **Consequence:** the `pty` driver cannot run under `bun run dev`. The published agent (`npx tempo-agent`) runs under the user's Node, so production is fine. For local development the dev workflow becomes `bun run build && node dist/cli.js connect <token>` instead of `bun run dev connect <token>`. Will be documented in `AGENTS.md` and a new `agent:dev:pty` script in `apps/agent/package.json` will codify the build-then-node sequence so the Dev doesn't have to remember it. The other two A/B arms (`stop-hook`, `midturn-hook`) continue to work under `bun run dev` exactly as today — this only affects the `pty` arm.

### Stdin-injection mechanism (resolved 2026-06-01)

The probe under Node confirmed that `pty.write('text\n')` results in the child receiving `text\n` on its stdin and processing it as if typed. For `cat`, that meant echoing it back. For `claude` in interactive mode, the stdin reader is its chat-input prompt: an injected line ending in `\n` submits as a Dev message. The mechanism is the same as `tmux send-keys` or `expect` — terminal stdin, not a side channel.

That said, two structural unknowns remain that I am explicitly marking as risks the smoke test must demonstrate before the feature is called done:

- **Injection while Claude is mid-turn.** If Claude is generating a response when Node injects a line, does the PTY input layer queue it for after the current turn, or does it drop on the floor? Standard terminal semantics queue it (`cat` accepts stdin even while writing stdout). Claude Code's input layer probably does the same. Smoke test: while Claude is mid-response, write a `[Tempo] ...` line via `pty.write(...)` and verify it is read at the next prompt boundary.
- **Injection during a permission dialog.** If Claude is paused on an in-terminal permission dialog ("Allow Bash?"), an injected line would answer the dialog with whatever character it starts with. Mitigation: the `pty` driver's allowedTools list covers all tools Claude is expected to use (no surprise prompts). If a prompt still appears, the Dev sees the terminal frozen — same failure mode as today's `stop-hook` driver. Acceptable for the A/B.

These two checks are part of definition-of-done for the `pty` arm. They are demonstrated by a manual end-to-end run, not automated tests (per T12, MVP has no tests).

### Remaining (not yet verified)

- **`--allowedTools` syntax for read-only Bash.** Claude Code accepts patterns like `Bash(git diff:*)` for subcommand allowlists in some doc revisions, but the exact syntax has shifted across versions. Will verify against the installed `claude --help` output before wiring the list. If subcommand restriction isn't reliable, accept full `Bash` in the allowlist — the Agent is sandboxed by intent (the workflow text instructs read-only behaviour) and the Plan's deletion test still passes (the Agent's worst case is `git log` on a repo it already has read access to).

- **`SIGWINCH` propagation.** Need to wire `process.stdout.on('resize', () => pty.resize(cols, rows))` and verify Claude's ink UI repaints on resize. Reading `node-pty` docs at implementation time.

- **Wake-watchdog drift threshold.** Proposing 5 s. The standard libraries (`wake-event`, `sleeptime`) use 2 – 10 s. 5 s is the midpoint and avoids false positives from event-loop pauses under load. Easy to tune in code review.

- **What gets shown for the injected line.** Proposing `[Tempo] <one-line summary>` followed by `\n`. If the prefix renders awkwardly in Claude Code's UI, iterate on the shape; this is cosmetic, not structural — the mechanism is proven.

## Layer assignment

- `apps/agent/src/pty-loop.ts` — **CLI driver** layer. Same layer as today's `spawn-claude.ts`: it spawns the child, owns the lifecycle, talks to the `ConsoleClient`. Does not import from `apps/console/server` (no cross-app coupling). Imports only from `@tempo/contracts`, `http-client`, `logger`, and `node-pty`.
- `apps/agent/src/connect.ts` — **CLI entry point**, unchanged layer. Dispatch is one switch.
- `apps/agent/src/http-client.ts` — **HTTP client adapter**, unchanged layer. `AbortSignal` is plumbing inside the same module.
- `apps/agent/src/mcp-server.ts` — **MCP adapter**, unchanged. Tool list isn't filtered there; filtering happens at `--allowedTools` in the spawn caller (per existing pattern).
- No changes to Console-side layers (route handlers, server modules, db-queries). The optional Console heartbeat (Fix 3 in the diagnosis HTML) is **not** in this plan — separate plan, separate judge review.
- No changes to `packages/contracts`. No new wire shapes.

## Deletion test

- **`pty-loop.ts` (new).** If deleted in 6 months: `TEMPO_AGENT_LOOP=pty` stops working; the other two arms still do, so the CLI is degraded, not broken. The sleep/wake pain returns. Load-bearing, not a pass-through.
- **`runPtyLoop` function.** If inlined into `connect.ts`: `connect.ts` grows by ~150 lines and the spawn-claude.ts / pty-loop.ts symmetry breaks. Worth its own file once it crosses ~50 lines — it will.
- **`mcp-config.ts` (new helper, step 6).** Two real callers at land time (`spawn-claude.ts` and `pty-loop.ts`). If `pty-loop.ts` wins the A/B and `spawn-claude.ts` is deleted, the helper has one caller and could be inlined — but at A/B retirement, `tempo-agent`'s entire spawn shape is reviewed anyway, so the inlining decision is made then. If both are deleted (i.e., the A/B concludes "kill all three and re-architect"), the helper has zero callers and deletes with them. Not a hypothetical adapter: two real call sites the moment this PR lands.
- **Step 3's `AbortSignal.timeout`.** If deleted in 6 months, the sleep/wake hang returns. Load-bearing across all three drivers.
- **The flag rename.** Pure rename. Same env-var concept, more honest name. No code-shape change.
- **The `postinstall` chmod in `package.json` (Uncertainties → install probe).** If deleted, the first `bun install` of node-pty on macOS/Linux produces a runtime `posix_spawnp failed` with no useful context. Load-bearing on every fresh install. One line; will sit next to the `bin` entry so the relationship is visible.

## Destructive actions

None. No `git push`, no migration, no schema change, no publish, no `rm -rf` outside the safe list. The `bun add node-pty` writes to `bun.lock` — reversible.

The flag rename is not destructive; the old name had a single documented call site (`spawn-claude.ts:98`) and the retirement note says the flag was always going to be revisited. No external consumers of `TEMPO_MIDTURN_HOOK`.

## Vocabulary check

- **"Driver"** is the existing word in this plan for "the thing in `apps/agent/src/` that owns Claude's lifecycle." It's not a CONTEXT.md noun, but it's also not a contested architectural noun (it's not "service" / "boundary" / "manager"). Acceptable.
- **"Loop"** matches existing usage ("polling loop", "Agent loop") in `AGENTS.md` and the 2.13 commit.
- **"Inject"** for writing into the PTY: descriptive, not a new abstraction.
- **"PTY"** is a Unix term, not Tempo vocabulary, but unavoidable for the mechanism.
- Product nouns (Agent, Dev, Console, Thread, Session, Plan, Comment, Reply, Discussion) preserved.

## Spotted but not fixed

Filing in `AGENTS.md` under that heading, not folded in:

- Console session pill keeps showing `connected` after the Agent dies. The schema (`last_seen_at`) exists but nothing updates it; the long-poll route is token-only and doesn't know the calling session. Fix is a separate plan ("Console-side Agent heartbeat") with its own judge review.
- The five-minute `bodyTimeout` window is also reachable on the Console side if a browser tab's long-poll hangs across sleep. Same mechanism, different process. Out of scope.
