# Slice 1c-2a — Reshape `apps/agent` to `init` + `connect` (CLI rewrite)

**Status:** sub-plan, strict subset of the already-approved slice 1c
plan at `plans/slice-1c-routes-cli-migration.md` Section A. No new
judge gate (subset of an approved plan is not "materially different"
per CLAUDE.md). The full 1c plan + slice 1c-2b plan bind for the
remaining route migration + cutover.

**Decomposition trigger:** the full slice 1c-2 (CLI + route migration
+ cutover + everything) was estimated at ~3000–4000 LOC across 30+
files. Same scale as the slice-1c full-scope dispatch that exited
mid-exploration. 1c-2a ships only the CLI rewrite so the
auth-to-claude-to-Worker round-trip is testable end-to-end before
1c-2b does the breaking route migration.

## Problem statement

After slice 1c-1, the foundation exists: the Member can OAuth via
`/cli/authorize`, mint `sk_user_*` tokens at `/api/cli/exchange`,
refresh at `/api/cli/refresh`, check Thread access at
`/api/threads/:id/access`, post stream-json events at
`/api/agent-events`, and the Worker's MCP endpoint hosts the upgraded
`tempo_attach({ thread_id })` tool with sticky-session mapping and
the three-branch Bearer middleware (sk_agent_, sk_user_, Clerk JWT).

But `apps/agent` still ships the OLD `tempo-agent connect <token>`
CLI with the embedded Claude Agent SDK loop. The new CLI binary
that consumes the 1c-1 endpoints doesn't exist yet. Slice 1c-2a
rewrites `apps/agent` into the two-subcommand shape the plan
calls for; the route migration that powers the rest of the
`tempo_*` surface follows in 1c-2b.

After 1c-2a is committed, a Member can E2E-test this path:
1. Open the Console, sign into Clerk, create a Thread.
2. `npx tempo-agent init` → browser opens to `/cli/authorize` →
   Allow → CLI receives code → exchanges at Worker → saves
   `~/.tempo/credentials.json`.
3. `npx tempo-agent connect <thread-id>` → CLI does the access
   preflight → spawns `claude` with `--output-format stream-json`
   and a temp `.mcp.json` carrying the `sk_user_*` Bearer.
4. The LLM invokes `tempo_attach({ thread_id })` first; Worker
   responds with the AttachOutput.
5. As the LLM uses local tools (Read/Grep/Bash) the CLI tees the
   stream-json events to Worker's `/api/agent-events`. Console
   activity feed receives them via SSE (the SSE endpoint still
   lives in Console for 1c-2a; 1c-2b moves it to Worker).
6. The LLM tries `tempo_pull_plan` or any of the other 9 tools →
   **MCP returns "tool not found"**. That's expected for 1c-2a;
   1c-2b registers them.

This is enough to validate every new piece introduced by 1c-1.

## Smallest concrete change

### A. Delete from `apps/agent/src/` (~700 LOC)

- `cli.ts` (entry — replaced)
- `connect.ts` (today's handshake + subprocess launcher — replaced)
- `stream-pump.ts` (291 LOC SDK-aware driver — replaced by a much
  thinner JSONL forwarder)
- `mcp-server.ts` (in-process stdio MCP — Worker hosts MCP now)
- `mcp-config.ts` (temp stdio config writer — replaced by an
  ephemeral HTTP `.mcp.json` writer)
- `prompts/system-prompt.ts`, `prompts/initial-prompt.ts`,
  `prompts/allowed-tools.ts`, `prompts/nudge.ts` (planning behavior
  moves into Worker's `tempo_attach` workflow output, which is the
  WORKFLOW constant)
- `cancel.ts`, `disconnect-on-exit.ts`, `nudge.ts`, `tool-summary.ts`
  (driver-side concerns; the new wrapper doesn't drive)

**Not deleted in 1c-2a (1c-2b moves them to Worker):**
- `skills/loader.ts`, `skills/index.ts`, `skills/*.md` — keep alive
  so the OLD `bun build --bundle src/cli.ts` doesn't break for
  reproducibility; 1c-2b deletes them as part of the move to Worker.
- `r2-fetcher.ts` — same reason.

Wait — `cli.ts` is the entry point. The new `cli.ts` argv-parses
`init` vs `connect <thread-id>` and dispatches to the new command
files. The skills loader stays unused (no caller from the new CLI)
but it's not deleted in 1c-2a to keep the move simpler.

Actually correct: 1c-2a's new CLI doesn't reference the skills
bundle or `r2-fetcher.ts` at all. Both files become **dead code**
in 1c-2a. The deletion-test answer is "1c-2b moves them to Worker,
where they have a real caller." Leaving them in `apps/agent` for
one PR is the smallest cleanly-attributable change; the alternative
would be to move skills and r2 into Worker as part of 1c-2a, which
expands the scope.

**Decision for 1c-2a:** leave the skills bundle and `r2-fetcher.ts`
in place but mark them with a one-line comment at the top:
`// TODO(slice-1c-2b): moves to apps/worker/src/skills` /
`// TODO(slice-1c-2b): moves to apps/worker/src/lib/r2.ts`. That
preserves the "no transitional shims" rule (no compat re-exports;
just dead files awaiting a known move).

### B. Add to `apps/agent/src/` (~500 LOC total)

```
apps/agent/src/
├── cli.ts                       NEW — argv dispatch (init|connect)
├── commands/
│   ├── init.ts                  NEW (~180 LOC) — OAuth flow controller
│   └── connect.ts               NEW (~180 LOC) — spawn claude + stream-json tee
├── credentials.ts               NEW (~80 LOC) — ~/.tempo/credentials.json read/write/refresh
├── stream-pump.ts               NEW (~110 LOC) — parses claude's JSONL, POSTs agent-events
│                                (REPLACES the deleted 291 LOC SDK-aware version)
├── env.ts                       KEEP — env validation (extend with TEMPO_CONSOLE_URL,
│                                  TEMPO_WORKER_URL defaults)
├── errors.ts                    KEEP — error hierarchy
├── logger.ts                    KEEP — pino, stderr
└── http-client.ts               DELETE — the new CLI doesn't talk to Console's MCP-adjacent
                                  routes; it POSTs to Worker via plain fetch in commands/.
```

### C. `commands/init.ts` (~180 LOC)

Steps:
1. Generate `state` (16 bytes random) + `code_verifier` (43 chars
   from `[A-Za-z0-9-_]`).
2. Compute `challenge = base64url(sha256(verifier))`.
3. Start a `node:http` listener on a random port in 49152–65535,
   bound to `127.0.0.1` only.
4. Open the user's browser to
   `${TEMPO_CONSOLE_URL}/cli/authorize?state=...&port=...&challenge=...`
   via the `open` npm package.
5. Wait up to 5 minutes for `GET /callback?code=...&state=...` or
   `?error=...&state=...`.
6. Verify `state` matches; close the listener.
7. POST `{ code, code_verifier }` to
   `${TEMPO_WORKER_URL}/api/cli/exchange`.
8. On success: write `~/.tempo/credentials.json` with mode `0600`
   and print `✓ Authenticated as <email>. Run \`tempo-agent connect
   <thread-id>\` to start planning.`
9. On any error: print a clear message and `process.exit(1)`.

Error UX (verbatim error strings):
- `tempo init failed: browser flow timed out after 5min` (timeout)
- `tempo init failed: state mismatch (possible replay)` (state)
- `tempo init failed: user denied authorization` (`?error=denied`)
- `tempo init failed: token exchange failed (HTTP 401)` (exchange 4xx)
- `tempo init failed: token exchange failed (network error)` (network)

### D. `commands/connect.ts` (~180 LOC)

Steps:
1. Read `~/.tempo/credentials.json` (fail clean if absent: "run
   tempo-agent init first").
2. Refresh if `expires_at` within 60 s: POST `{ refresh_token }` to
   `/api/cli/refresh`, overwrite credentials file under a
   `proper-lockfile` mutex.
3. Preflight: `GET /api/threads/${thread_id}/access` with the
   Bearer. Print `→ Connecting to <workspace_name>'s Thread
   "<thread_title>" …` on 200; print error + exit on 403/404.
4. Write ephemeral `/tmp/tempo-${pid}-${random}.json` (mode 0600):

   ```json
   {
     "mcpServers": {
       "tempo": {
         "type": "http",
         "url": "${TEMPO_WORKER_URL}/mcp",
         "headers": { "Authorization": "Bearer sk_user_..." }
       }
     }
   }
   ```

5. Spawn `claude --output-format stream-json --mcp-config <tmp> --print "/tempo-plan <thread-id>"`
   via `node:child_process`. Stdin inherited; stderr inherited;
   stdout piped to `stream-pump`.
6. The implicit `/tempo-plan` slash command is NOT yet installed in
   the user's repo or `~/.claude/commands`. For 1c-2a's smoke test,
   the LLM may not have a `/tempo-plan` command to execute. Two
   options:

   - **Option (i):** include a hand-rolled system prompt as a CLI
     arg: `claude --append-system-prompt "<SHORT_INSTRUCTION>"`.
     The instruction tells the LLM to extract `thread_id` from the
     `--print` argument and call `tempo_attach({ thread_id })`
     first. This is the simplest path for 1c-2a.

   - **Option (ii):** the CLI writes the slash command to
     `~/.claude/commands/tempo-plan.md` once during `init`. More
     setup but matches the long-term design.

   **Choose (i) for 1c-2a** — keep the CLI side as thin as possible.
   The slash command file gets written when 1c-2b ships the
   skills bundle to Worker (which the LLM may consult via
   `tempo_load_skill`).

7. Pipe claude's stdout to `stream-pump` which parses JSONL and
   POSTs each event to `/api/agent-events`.
8. On SIGINT, claude exit, or a stream-json `result` event with
   `is_error=true`: kill child, `unlinkSync` temp file, exit with
   the appropriate code.

### E. `credentials.ts` (~80 LOC)

```ts
type Credentials = {
  version: 1;
  user_id: string;
  email: string;
  worker_url: string;
  token: string;          // sk_user_*
  refresh_token: string;  // rt_*
  issued_at: string;      // ISO
  expires_at: string;     // ISO
};

export async function read(): Promise<Credentials>;
export async function write(creds: Credentials): Promise<void>;  // 0600
export async function refresh(creds: Credentials): Promise<Credentials>;
```

`refresh` uses `proper-lockfile` to mutex the credentials file —
two concurrent `tempo-agent connect` invocations on the same
machine racing the refresh would otherwise destroy the token pair.

### F. `stream-pump.ts` (~110 LOC)

Replaces today's 291 LOC SDK-aware driver. Pure parse-and-forward:

1. Subscribe to claude's stdout, split by newlines.
2. For each line: `JSON.parse`, route by `type` (`assistant`,
   `tool_use`, `tool_result`, `system`, `result`, …) and `subtype`.
3. Map each event to an `AgentEventRequest` payload (per
   `@tempo/contracts/http`):
   - `tool_use` → `{ kind: 'tool_use', tool_name, summary, started_at_ms }`
   - `assistant` (text deltas) → `{ kind: 'narration', text, emitted_at_ms }`
   - `system` (todos updates) → `{ kind: 'todos_updated', todos }`
   - `result` → `{ kind: 'turn_ended', duration_ms, reason }`
4. POST each to `${TEMPO_WORKER_URL}/api/agent-events` with the
   `sk_user_*` Bearer. Buffer + retry on transient failure (max 3
   attempts with exponential backoff). Drop after 3 failures (don't
   block the agent's progress for a missed activity event).

### G. `cli.ts`

```ts
import { initCommand } from './commands/init';
import { connectCommand } from './commands/connect';

const [, , subcommand, ...rest] = process.argv;
switch (subcommand) {
  case 'init': return initCommand();
  case 'connect': return connectCommand(rest[0]);
  default:
    console.error('unknown subcommand "' + subcommand + '"');
    console.error('usage: tempo-agent init');
    console.error('       tempo-agent connect <thread-id>');
    process.exit(2);
}
```

### H. `package.json` updates

```diff
- "version": "0.x.y",
+ "version": "1.0.0",
  ...
- "@modelcontextprotocol/sdk": "^...",
+ // removed — Worker hosts MCP now
+ "open": "^X.Y.Z",          // bun add
+ "proper-lockfile": "^X.Y.Z",  // bun add
  ...
```

All deps via `bun add` — no hand-written versions.

### I. README + npm publish prep

Update `apps/agent/README.md` (if it exists) with:
- `npx tempo-agent init` (once per Member per machine)
- `npx tempo-agent connect <thread-id>` (per planning session)
- Note: Console URL + Worker URL via env (`TEMPO_CONSOLE_URL`,
  `TEMPO_WORKER_URL`), with sensible defaults pointing at
  production.

Do NOT `npm publish` — that's the Dev's manual step after 1c-2a's
PR merges.

## What 1c-2a does NOT include

- Moving any Console route or server module to Worker — 1c-2b
- Registering the other 9 `tempo_*` tools on Worker — 1c-2b
- Deleting Console MCP-adjacent routes — 1c-2b
- Browser fetch refactor (Tiptap saves, comment adds, etc.) — 1c-2b
- CORS middleware on Worker — 1c-2b (no browser is hitting Worker
  yet; only the CLI does, and CLI doesn't need CORS)
- DNS provisioning for `worker.tempo.dev` — 1c-2b
- Skills bundle move from CLI to Worker — 1c-2b (CLI still has the
  dead bundle in 1c-2a)
- R2 fetcher move — 1c-2b
- WORKFLOW constant lift — 1c-2b
- `plans/agent-harness.md` §2 ephemeral-mcp-json clarification — 1c-2b
- `npm publish @gmeher/tempo-agent@1.0.0` — Dev's manual step
  after the 1c-2a PR merges

## Verification

- `bun install` clean
- `bun run typecheck` green across all 5 packages
- `bun run lint` clean on all new files
- `bun run --filter @gmeher/tempo-agent build` produces a tiny
  bundled `dist/cli.js`
- Manual E2E smoke (Dev runs):
  1. `npx tempo-agent init` — completes OAuth, writes
     `~/.tempo/credentials.json` (verify with `cat -v`; mode 0600
     via `ls -l`).
  2. Open the Console, create a Thread, copy the `thd_*` id.
  3. `npx tempo-agent connect thd_<id>` — `claude` opens; LLM
     calls `tempo_attach({ thread_id })`; Plan reads back.
  4. The LLM uses `Read`/`Grep` on the repo; `tempo-agent`
     receives stream-json events on stdout and POSTs them to
     Worker `/api/agent-events`; Console Activity Feed shows
     them via SSE (Console's SSE still lives in Console for
     1c-2a).
  5. The LLM tries `tempo_pull_plan` → MCP returns "tool not
     found". Expected — 1c-2b registers it.
  6. SIGINT (Ctrl-C) cleans up the temp file and exits.

## Judge gate

Skip. Subset of the already-approved slice-1c plan; no material
deviation from `plans/slice-1c-routes-cli-migration.md` Section A.
The remaining route migration + cutover gets its own slice (1c-2b)
which will get its own judge pass since it carries the destructive
actions (Console route deletion, npm publish, DNS, agent-harness.md
update).
