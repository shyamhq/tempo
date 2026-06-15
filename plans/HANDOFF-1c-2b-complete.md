# Handoff — End of slice 1c-2b

Branch: `main`, ahead of `origin/main` by 9 commits at time of handoff.
Phase 1 of Tempo's Worker topology flip is done. Phase 2 (hosted runtime)
is the next pickup.

You will be picking up where the previous agent stopped. Read this in full
before touching code. The build playbook (`AGENTS.md`) and vocabulary
(`CONTEXT.md`) are still authoritative; this is a snapshot, not a
replacement.

## What "done" looks like right now

```
[x] Slice 1a — packages/db
[x] Slice 1b — apps/worker skeleton + stub tempo_attach
[x] Slice 1c-1 — CLI auth foundation (sk_user_*, Clerk JWT, no breaking
    changes to Console)
[x] Slice 1c-2a — Reshape apps/agent into `tempo-agent init` + `tempo-agent
    connect` (PKCE OAuth-style code exchange + Worker MCP HTTP transport)
[x] Slice 1c-2b — Route migration + Console cutover (Worker now serves
    every browser HTTP route, the SSE stream, and all 9 MCP tools; Console
    became UI + Clerk-bound surfaces only)
[x] Unified auth refactor (folded into 1c-2b — see §"Unified auth" below)

[ ] Slice 2 — Hosted runtime (Mailbox + Hosted Agent SDK loop + VM)
[ ] Slice 3 — Gateway + first Connector + allowlist + approve-gate
[ ] CONTEXT.md — add forward-linked terms (Allowlist, Approve-gate, VM,
    Hosted Agent) once their shapes are concrete
```

## Topology, post-1c

```
┌───────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│  apps/console     │    │  apps/worker             │    │  apps/agent      │
│  (Next.js UI)     │    │  (Express + MCP SDK)     │    │  (local CLI)     │
│                   │    │                          │    │                  │
│  • Clerk auth     │◀──▶│  • bearerAuth            │◀──▶│  • init: PKCE    │
│  • Tiptap editor  │    │  • ensureThreadAccess    │    │    → sk_user_*   │
│  • TanStack Query │    │  • ensureCommentAccess   │    │  • connect:      │
│  • Zustand store  │    │  • /mcp HTTP-streamable  │    │    spawn claude  │
│  • workerApi()    │    │  • /api/threads/:id/*    │    │    + MCP HTTP    │
│    bearer JWT     │    │  • SSE: /events          │    │    via .mcp.json │
│  • SSE via        │    │  • /api/agent-events     │    │  • stream-pump   │
│    fetchEventSrc  │    │  • CORS for Console      │    │    posts events  │
└───────────────────┘    └──────────────────────────┘    └──────────────────┘
        ▲                            ▲
        │                            │
        └────────── Drizzle ─────────┘
                  Postgres
```

Three Bearer flavors enter Worker, one canonical authorization API leaves
the middleware layer:

| Token prefix | Caller kind | Identity |
|---|---|---|
| `sk_agent_*` | `agent`   | `workspaceId` (workspace-scoped key) |
| `sk_user_*`  | `cli`     | `userId` |
| Clerk JWT    | `browser` | `userId` (`sub`) |

Every thread-scoped route mounts `bearerAuth → ensureThreadAccess →
handler`. Comment-scoped routes use `ensureCommentAccess`. SSE adds
`rejectAgent`. MCP tools call `authorizeThread(caller, threadId)` directly.

## What shipped in 1c-2b (concrete inventory)

### Route migration (Console → Worker)

Deleted from `apps/console/app/api/**` and re-implemented in
`apps/worker/src/routes/**`:

- `POST /api/threads/:id/plan`, `POST /api/threads/:id/plan/recheck`
- `POST /api/threads/:id/comments`, `DELETE /api/comments/:id`,
  `POST /api/comments/:id/(un)resolve`
- `POST /api/comments/:id/replies`
- `POST /api/threads/:id/discussion/messages`
- `POST /api/threads/:id/attachments/init`
- `GET  /api/threads/:id/events` (SSE)
- `POST /api/agent-events` (CLI activity ingestion)
- `GET  /api/threads/:id/access` (CLI + browser preflight)

What stayed in Console (routes that only touch Console state or use the
Clerk admin SDK):
- `GET /api/threads`, `POST /api/threads`, `GET /api/threads/:id`,
  `PATCH /api/threads/:id`, `DELETE /api/threads/:id`,
  `POST /api/threads/:id/approve`, `POST /api/threads/:id/reopen`,
  `GET  /api/threads/:id/connect-token`
- Spaces routes (`/api/spaces/**`)
- Workspace + members + invitations (`/api/workspace/**`) — Clerk admin SDK
- Webhooks (`/api/webhooks/**`)

### MCP tools (now on Worker)

All 9 active tools registered in `apps/worker/src/mcp/server.ts`:
`tempo_attach`, `tempo_pull_plan`, `tempo_update_plan`, `tempo_update_block`,
`tempo_add_blocks`, `tempo_delete_block`, `tempo_poll`, `tempo_post_reply`,
`tempo_post_discussion_message`, `tempo_set_thread_meta`, `tempo_load_skill`.
(Two former Console MCP routes, `tempo_workflow_stub` and friends, were
deleted as dead code.)

Skills bundle moved to `apps/worker/src/skills/` and is served by the
`tempo_load_skill` tool. R2 helpers moved to `apps/worker/src/lib/r2`.

### Console-side cutover

- `apps/console/lib/api-client.ts` split into two factories:
  `api.*` (Console routes, session-cookie auth) and
  `workerApi(getToken).*` (Worker routes, Bearer Clerk JWT).
- `WORKER_URL` exported for direct fetch sites (SSE, unloadBeacon).
- All 12 client call sites moved to `workerApi(...)` or `useWorkerApi()`.
- SSE rewritten with `@microsoft/fetch-event-source` (native EventSource
  can't send headers). Token is refreshed inside a custom `fetch` so every
  reconnect gets a fresh JWT.
- `unloadBeacon` now POSTs to Worker with a 30 s–refreshed JWT held in a
  ref (page-unload is synchronous; an async `getToken()` won't resolve in
  time).
- Browser routes no longer require `template: 'tempo-worker'` in
  `getToken()` — Worker derives identity from `sub` and resolves workspace
  via DB+Clerk membership lookup per request.

### Contracts package extracted

- `WORKFLOW` constant lifted to `packages/contracts/src/workflow.ts`.
- `packages/db` got a new `./queries/plans` subpath export so both Worker
  and Console plan modules share the same `readPlanRow` helper. (The other
  7 duplicated server modules between Console and Worker are documented in
  AGENTS.md "Spotted but not fixed" with a deferred-extraction plan.)

### CLI verbose mode

`apps/agent/src/cli.ts` accepts `--verbose` / `-v`, which flips
`TEMPO_LOG_MODE=verbose`. The logger then surfaces:
- `claude line` for every stream-json message from Claude
- `tempo call` for every `mcp__tempo__*` tool invocation Claude makes
- `event` with kind + status for every POST to `/api/agent-events`

Use this when `tempo-agent connect` appears to hang silently.

### Unified auth (final shape)

The browser auth bug uncovered during live-testing the rest of 1c-2b
turned into a deeper refactor — see `plans/unified-auth-refactor.md` for
the plan + judge approval + ponytail revision.

The result is one file: `apps/worker/src/auth.ts`. Three Bearer flavors,
one `Caller` union, one `authorizeThread` function (which delegates to
`assertMembership` for cli/browser), three Express middlewares
(`bearerAuth`, `ensureThreadAccess`, `ensureCommentAccess`), plus a small
`rejectAgent` middleware for user-facing routes.

Code-reviewer flagged three findings, all fixed before commit:
1. `agent` kind was not blocked from SSE — added `rejectAgent` middleware.
2. `assertMembership`'s `NotAMemberError` swallowed the "thread doesn't
   exist" case — added `ThreadNotFoundError`, mapped to
   `ForbiddenError('thread_not_found')` in `authorizeThread`.
3. `ensureCommentAccess` had an unguarded `await` before its try/catch —
   moved inside.

Code-simplifier suggestions applied: `callerMatches` collapsed by
discriminator, redundant workspace cross-check in `threads/access.ts`
removed, obvious comments in `Express.Request` augmentation dropped.

`AGENTS.md` "Spotted but not fixed" gained an entry for the Clerk SDK
per-request cost (~100–300 ms × N), with a "revisit when > 100 calls/min"
trigger.

## What still needs testing before declaring 1c-2b shipped

The Dev was live-testing when this handoff was written. The unified auth
refactor passed typecheck, lint, build, and a fresh Worker boot, but the
end-to-end happy path has not been re-run since the refactor landed.
Recommended order:

1. `bun run --filter @tempo/worker dev`,
   `bun run --filter @tempo/console dev`.
2. Sign in to Console; create a Thread; open the editor.
3. Confirm browser → Worker requests succeed (Network tab on the editor
   save, comment create, discussion-message post). Previously this 403'd.
4. Spawn `tempo-agent connect <thread-id> --verbose`; watch the verbose
   stream to confirm `tempo_attach` succeeds and the activity feed
   populates.
5. Cross-workspace test: sign in as a different Clerk user / org and try
   to load the previous thread's URL — should 403 cleanly, not silently
   succeed (this is the security bug 1c-2b's auth refactor closes).
6. SSE test: pipe an `Authorization: Bearer sk_agent_*` to
   `/api/threads/:id/events` and confirm 403 (not 200) — `rejectAgent`
   middleware guards this.

If anything 403s that shouldn't, check Worker logs at `:3001`. Verbose
mode on the CLI side is `TEMPO_LOG_MODE=verbose` or `--verbose`.

## Spotted but not fixed (carried forward)

Already in `AGENTS.md` — bullet-summary so you don't have to re-grep:

- Seven server modules duplicated between Console and Worker
  (`comments.ts`, `discussion.ts`, `event-log.ts`, `sessions.ts`,
  `replies.ts`, `threads.ts`, `attachments.ts`). Extraction to a shared
  `@tempo/server` requires lifting `attachments → r2`, `ids`, and
  `event-log` together — ~7-file refactor. Deferred to a focused slice
  after the surface stabilizes.
- Clerk Organization Memberships API call on every authorized CLI/browser
  request. Acceptable for MVP; cache when usage warrants it.
- A few pre-existing items the previous agents filed (mermaid renderer,
  `createEditor` per-call cost, `extractText` duplication, etc.) — none
  of those block 1c-2b.

---

# Slice 2 — Hosted runtime

## Goal in one paragraph

Today the Agent runs **on the Dev's machine** — `npx tempo-agent connect`
spawns a local Claude Code subprocess that reads the Dev's repo, calls
`tempo_*` MCP tools, and posts activity events. Slice 2 lifts the Agent
into Tempo-owned infrastructure: a hosted runner (a small VM or container
per Thread) that runs the Claude Agent SDK loop and talks to Worker over
the same MCP surface. The trigger that *wakes* a Hosted Agent is a
**Mailbox** — a queue of "do something" requests that originate from the
Console (Dev comments, plan edits, "ask Agent to recheck").

The local CLI does not go away — it remains the way a Dev attaches a
Hosted Agent to a specific repo. But the Hosted Agent owns the LLM
context, the tool calls, and the lifecycle across Dev-side network blips.

## Files / paths likely to grow

- `apps/runner/` (new) — Hosted Agent loop. Probably a small Express-less
  Node service that:
  - Subscribes to its Thread's Mailbox.
  - On each Mailbox event, runs the Claude Agent SDK turn loop.
  - Exposes the same tool surface as the CLI does today (the SDK can be
    pointed at the same Worker `/mcp` HTTP endpoint, so the tool surface
    doesn't have to be duplicated — just the *driver* changes from
    spawning `claude` to using the SDK).
- `apps/worker/src/routes/mailbox/` (new) — write side. Console publishes
  events; Hosted Agent consumes.
- `apps/worker/src/routes/mailbox/sse.ts` (new) or — more likely — a
  Postgres LISTEN/NOTIFY bridge. The plan doc should pick one before
  starting.
- `packages/contracts/src/mailbox.ts` (new) — wire shape of Mailbox
  events.
- `packages/db/src/schema.ts` — at minimum a `mailbox_events` table
  (`id`, `thread_id`, `kind`, `payload_json`, `created_at`, `consumed_at?`).
- `apps/console` — drop the connect-token + handoff-card flow, replace
  with a "Hosted Agent is connected to this Thread" pill. The user
  experience goes from "I run a command in my terminal" to "I click
  Connect to repo, select a GitHub installation, and the Hosted Agent
  picks it up."

## Decisions the planner must make before writing code

1. **VM granularity.** One VM per Thread? Per Workspace? Per Workspace with
   per-Thread isolation via process? Fly Machines are cheap to start —
   per-Thread is plausible. Container-per-Thread is simpler than VM. The
   plan should pick.
2. **Mailbox transport.**
   - Option A: Postgres `LISTEN/NOTIFY` + a polling fallback. Zero new
     infra. Slow under burst but fine for MVP.
   - Option B: Redis pub/sub. New infra (Upstash on Fly is cheap).
   - Option C: pgmq or River. Heavyweight; over-built for "wake the
     Agent" semantics.
   - Recommendation worth defending: A. The existing event log is
     already Postgres; adding a second store is the band-aid.
3. **Agent driver.** Claude Agent SDK has a programmatic API; today the
   CLI uses the `claude` subprocess with `--output-format stream-json`.
   Hosted runner should use the SDK directly — but it should call the
   *same* MCP HTTP transport that the CLI uses (Worker's `/mcp`). That
   keeps the tool surface canonical.
4. **State on the runner.** The Hosted Agent has to read the Dev's repo
   somehow. Slice 2 doesn't ship Connectors yet (that's Slice 3) — for
   MVP the runner can clone via a GitHub PAT scoped to the Workspace, or
   pull a snapshot the Console uploaded. Keep this scope tight.
5. **How does a Hosted Agent get "connected" to a Thread.** Today CLI
   does `tempo_attach({ thread_id })`. The Hosted Agent should call the
   same tool — its identity is a new Bearer flavor:
   `sk_hosted_*` (workspace-scoped, same shape as `sk_agent_*` but
   provisioned per-Thread on first wake). Plan should decide if this is a
   fourth `Caller.kind` or a sub-variant of `agent`.
6. **Lifecycle.** When does a runner sleep? When does it wake? What
   happens if the runner crashes mid-turn? The Mailbox is the
   authoritative source — a crashed runner should resume from its last
   unconsumed Mailbox event.

## Forward-linked CONTEXT.md entries to add

These are mentioned all over `AGENTS.md` "Build progress" without being
defined yet. Define them as Slice 2 starts so the rest of the codebase
can use them:
- **Hosted Agent** — the runner process bound to one Thread, owning the
  LLM loop.
- **Mailbox** — the durable queue/stream of "do something" requests
  consumed by the Hosted Agent.
- **VM** — the isolation boundary the runner executes in (terminology
  for the unit of compute; either a container or a Fly Machine).

## Acceptance check for Slice 2

The Dev should be able to: open a Thread in Console, click "Connect to
repo" (or any flow that hands a GitHub installation to the Workspace),
type a Discussion message, see the activity feed populate with Agent
narration + tool calls, and approve the Plan — **without running any CLI
on their machine.** The `tempo-agent` CLI still exists for the local-dev
escape hatch but should no longer be the only path.

---

# Slice 3 — Gateway + first Connector + allowlist + approve-gate

## Goal in one paragraph

Today the Agent can only do what `tempo_*` MCP tools expose: read/edit
the Plan, post comments, post discussion messages. Slice 3 opens the
door to **external systems** — first Linear, then GitHub, then Sentry —
by introducing a **Gateway**: a proxy through which Hosted Agents call
*third-party* APIs. Two safety rails are introduced at the same time:
the **Allowlist** (Workspace admin pre-approves which Gateway operations
the Agent may invoke) and the **Approve-gate** (any operation that
*writes* to a third-party — opens an issue, comments on a PR — pauses
for explicit Dev approval before firing).

After Slice 3, the Agent's planning surface stops being "a single
markdown doc" and becomes "a doc plus a chain of operations against
external systems that the Dev can preview and approve".

## Files / paths likely to grow

- `apps/gateway/` (new) — a small HTTP service the Hosted Agents call
  out to. Owns OAuth installation state per (Workspace, Connector). Owns
  the per-operation allowlist. Owns the approve-gate UI handoff (it
  emits a "I want to do X, approve?" event onto the Mailbox that goes
  back to Console).
- `apps/gateway/src/connectors/` — one file per integration. First one
  is Linear (read-only, then write). Each Connector declares: its
  OAuth shape, the set of operations it exposes, which ones are
  read-vs-write (and thus subject to the approve-gate).
- `packages/contracts/src/gateway.ts` (new) — wire shape of Connector
  operations and approve-gate prompts.
- `apps/worker/src/mcp/tools/` — at minimum a new MCP tool the Hosted
  Agent calls: `tempo_gateway_call(connector, op, args)`. Worker proxies
  to Gateway after checking the allowlist.
- `apps/console/app/(app)/settings/connectors/` — UI for the Workspace
  admin to install Connectors and tick which operations the Agent is
  allowed to perform.
- `packages/db/src/schema.ts` — `workspace_connectors`,
  `workspace_allowlist`, `approve_gate_requests`.

## Decisions the planner must make

1. **Allowlist granularity.** Per operation (`linear.createIssue`)? Per
   resource (`linear.createIssue` only in team X)? MVP recommendation:
   per operation, scoped to the (Workspace, Connector). Resource-level
   gating is Slice 3.5.
2. **Approve-gate UX.** When does the Console show the prompt? On
   Discussion side? Inline in the Plan? On a separate "Pending
   approvals" surface? The Plan ergonomics matter — Slice 3 should not
   regress the editing flow.
3. **OAuth installation flow.** Cleanest: Connector OAuth lives in
   Gateway, never touches Worker or Console. Console redirects the
   admin's browser to Gateway, Gateway redirects back. Tokens are
   stored encrypted in `workspace_connectors`.
4. **Failure modes.** A Connector call can fail mid-operation (network,
   401, 5xx). Approve-gated calls should be idempotent or have a
   "rollback" instruction the Agent can be told to attempt. MVP: log
   failures clearly; Slice 3.x can add the retry/rollback story.
5. **First Connector choice.** Linear has the cleanest read+write API
   shape and is the most-asked feature in early Tempo conversations.
   Recommendation: Linear. GitHub is more complex (App vs PAT, repo
   scopes) — defer to Slice 3.2.

## Forward-linked CONTEXT.md entries to add

- **Connector** — a binding between a Workspace and an external system
  (Linear, GitHub, Sentry). Owns OAuth state, exposes a set of
  operations.
- **Gateway** — the service that proxies Connector calls, enforces the
  Allowlist, and routes Approve-gate prompts to Console.
- **Allowlist** — the per-Workspace set of Connector operations the
  Hosted Agent may invoke without per-call approval.
- **Approve-gate** — the per-call confirmation surface for write
  operations the Agent wants to perform on a third-party system.

## Acceptance check for Slice 3

The Dev should be able to: install Linear in their Workspace, tick
"Agent may read issues" and "Agent may create issues (with approval)",
and then in a Thread ask the Agent "Open a Linear issue for the bug we
discussed". The Agent calls `tempo_gateway_call`, Worker checks the
allowlist, Gateway emits an approve-gate prompt to Console, Dev clicks
Approve, the issue is created and a link surfaces in the Plan.

---

# Repo navigation cheat sheet for a fresh agent

| Question | Read |
|---|---|
| What's the binding playbook? | `AGENTS.md` (start with "Working conventions" and "Build progress") |
| Vocabulary | `CONTEXT.md` |
| Per-agent guardrails (review pipeline) | `CLAUDE.md` |
| Worker architecture | `apps/worker/src/index.ts`, `apps/worker/src/auth.ts`, `apps/worker/src/mcp/server.ts` |
| Auth shape | `apps/worker/src/auth.ts` (one file, ~170 LOC, contains everything) |
| What Console keeps vs sends to Worker | `apps/console/lib/api-client.ts` |
| CLI flow | `apps/agent/src/cli.ts`, `apps/agent/src/commands/{init,connect}.ts`, `apps/agent/src/stream-pump.ts` |
| Contracts | `packages/contracts/src/{http,events,mcp,workflow}.ts` |
| DB | `packages/db/src/schema.ts`, `packages/db/drizzle/` |
| Recent design refactor | `plans/unified-auth-refactor.md` |
| Skill bundle | `apps/worker/src/skills/` |

When in doubt about scope, default to the deletion test
(`CONTEXT.md` §2) and the "Standard code, never band-aids" rule in
`CLAUDE.md`. The Dev has been explicit about preferring net-deletion
rewrites over patch-on-patch.
