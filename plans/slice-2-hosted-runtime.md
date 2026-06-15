# Slice 2 — Hosted runtime (Always-VM + Mailbox + Agent SDK loop)

**Status:** task breakdown, ready for sequencing. **Per-task `judge` gate
required at task start time** (VM provisioning, queue infra, billing-affecting
toggle, new Caller.kind are all "new product surfaces" per CLAUDE.md).

**Slice 1d (CLI lifecycle) is the prerequisite** — it establishes the
Session/Turn vocabulary, in-memory presence, and SSE-as-wake-up patterns that
Slice 2 mirrors on the Hosted side.

---

## Scope (one paragraph)

The Hosted runtime: a per-Thread VM provisioned at Hosted-Session start that
runs the Claude Agent SDK loop. The VM always exists during an active
Hosted-Session — no "lazy provisioning" split brain. Repo clone inside the
VM is **conditional** on whether the Thread is repo-linked. The wake-up
mechanism is a **Mailbox** Postgres table that Worker writes to whenever a
Dev event arrives for a Thread with no fresh Local Session. The VM polls
Mailbox for events between Turns; ~10 minutes of idle ends the VM. Cold
re-spawn happens on the next event. The same MCP surface (`tempo_*`) the
Local CLI uses serves the Hosted runner — Worker's MCP endpoint is the
single shared contract.

## Vocabulary (CONTEXT.md updates this slice lands)

- **Hosted Agent** — new term. *"The Claude Agent SDK loop running inside
  an ephemeral VM, driven by Worker. Owns async work (Dev events when no
  Local Session is fresh)."* (Mirrors agent-harness.md §2 Hosted but with
  the always-VM correction.)
- **Mailbox** — rewrite. Drop the "~60s debounce" sentence. After: *"Per-Thread
  outbox table. Worker writes one row whenever a Dev event arrives on a
  Thread that has no fresh Local Session and whose Workspace has Hosted
  enabled. The Hosted VM polls its Mailbox between Turns; ~10 min of no
  new rows ends the VM. New events that arrive mid-Turn naturally batch
  via the VM's in-Turn poll loop."*
- **VM** — new term. *"The isolation boundary the Hosted Agent runs in. One
  E2B Sandbox per Hosted Session, egress-locked to Anthropic + GitHub +
  Worker via E2B's `allowOut`/`denyOut` network config. Per-second billed;
  ~10 min keep-alive on idle then teardown. Scratch disk + short-lived API
  key + git App token all die on teardown. Cold start ~80ms same-region;
  Firecracker microVM under the hood."*

## Architecture decisions (locked from 2026-06-16 grilling)

| Decision | Choice | Rationale |
|---|---|---|
| VM granularity | One Sandbox per Hosted-Session per Thread | Per-Workspace requires multi-Thread isolation in-VM (more work, more risk). Per-Thread is cheap with E2B (~80ms cold start same-region; ~$0.05/hr per 1 vCPU sandbox, RAM included, billed per-second). |
| Sandbox provider | **E2B** (`@e2b/sdk` TypeScript) | Picked over Fly Machines: 35× faster cold start (80ms vs 2.8s p50), purpose-built TypeScript SDK for AI agents, native egress allowlist via `allowOut`/`denyOut` (added Nov 2025), per-sandbox-second pricing matches our use pattern. Tradeoffs accepted: younger company; no persistent disk (we want ephemeral anyway per agent-harness.md §6). Migration to Daytona / another sandbox SDK is ~1 week if E2B becomes a problem — same shape of code. |
| Mailbox transport | Postgres `LISTEN`/`NOTIFY` + 5s polling fallback | Single Postgres; no Redis. Polling fallback covers missed NOTIFYs across Worker restarts. |
| Always-VM vs lazy | Always-VM. Repo clone is conditional. | Single mental model (matches Manus / Zo / Devin pattern). agent-harness.md §2 "lazy VM" intent preserved by conditional clone — pure-planning Threads pay only the VM cost (~$0.0013 per Session in the abandoned-walk-away worst case). |
| Repo access | `git clone --depth 1 --filter=blob:none` via GitHub App installation token (minutes TTL), in-VM | Direct path, no per-call network tax (agent-harness.md §5 chose this; carry over). |
| Agent driver | Claude Agent SDK as a library (Node entrypoint inside VM) | agent-harness.md §7 rule: "Never write a raw agent loop. Use the SDK as a library." |
| Wake-up timing | No pre-debounce. Fire on first event. | Mid-Turn events naturally batch via VM's `tempo_poll`. Post-Turn keep-alive coalesces stragglers without cold-start. Matches Slice 1d shape. |
| Hosted identity | New `sk_hosted_*` Bearer flavor + 4th `Caller.kind = 'hosted'` | Distinct from `agent` (Workspace API key, durable) and `cli` (User, durable) — Hosted is per-Session, short-lived, workspace-scoped. Auth shape worth being explicit about. |
| Routing decision | At enqueue time, Worker checks `presence.isFresh(threadId)`. If fresh → event-log only (Local picks up via SSE). If not fresh AND `workspaces.hosted_enabled` → also enqueue into Mailbox. | Single decision point. No race-to-consume between Local and Hosted. |
| Conversation continuation across VMs | `tempo_attach` rehydrate from artifact | Already in agent-harness.md §6: *"Resume = fresh VM + rehydrate from artifact + re-clone repo. The agent rebuilds its state from the Plan + comment + discussion, not from a frozen process."* Same mechanism covers crash-resume and idle-teardown-then-event. |

## Out of scope (deferred)

- **Parallel sub-agent fan-out per channel.** When the Hosted Agent has
  multiple independent channels in a batch (e.g. 3 Comments on 3 different
  Plan blocks + 1 Discussion thread), the natural extension is parallel
  sub-agents (one per channel) via Claude Agent SDK's native `Task` tool +
  a coordinator that merges results into the next-Turn context. MVP ships
  serial per-channel (matches existing WORKFLOW contract). **Trigger to
  revisit:** Dev complaint that "the agent took forever to reply to my
  comment because it was busy with someone else's," or active Threads
  consistently seeing 5+ concurrent comments. **Known risks at that
  point:** concurrent `tempo_update_plan` / `tempo_update_block` calls
  from sibling sub-agents racing on the same artifact. Mitigation
  candidates: route Plan-mutating channels to serial only; or add an
  artifact-level optimistic-lock with retry on `etag` mismatch. The
  channel concept is already in the wire contract (`WORKFLOW`), so adding
  parallelism is a Hosted-internal, non-breaking change.
- **Hosted toggle UI in Console.** Schema (`workspaces.hosted_enabled`)
  lands in Slice 2; the Workspace admin UI toggle ships in a follow-up
  Console slice. MVP can toggle via SQL.
- **Multiple Sandbox sizes ("light" vs "full").** Single E2B Sandbox spec
  (1 vCPU, default RAM) for all Hosted Sessions in MVP — repo clone is
  cheap enough that a single small instance handles both cases. Splitting
  becomes interesting only when cost data shows abandoned-Session waste,
  at which point E2B's `Sandbox.create({ cpu, memoryMB })` allows tuning.
- **Connector calls / Gateway.** Slice 3.

---

## Task breakdown

Each task is ~1 day of work. The first 4 are foundational; 5–7 are the
runtime; 8 is the toggle path. Tasks are sequenceable as listed (each one
unblocks the next).

### Task 2.1 — DB schema + migrations

**Output:** new Drizzle migration adding:

- `mailbox_events`:
  - `id` (event id), `thread_id` (FK), `event_id` (FK to events table —
    the canonical row), `kind`, `payload_json`, `created_at`,
    `consumed_at?`, `scheduled_at?` (for future rechecks; NULL = ASAP).
  - Index on `(thread_id, consumed_at)` for `WHERE consumed_at IS NULL`
    drain.
  - Idempotency: unique `(thread_id, event_id)` so duplicate enqueues are
    no-ops.
- `workspaces.hosted_enabled` (boolean, default `false`).
- `vm_runs` (audit):
  - `(id, thread_id, started_at, ended_at?, exit_reason, cost_estimate_usd)`.
  - Written by the VM provisioner; informational only.

**Files:** `packages/db/src/schema.ts`, `packages/db/drizzle/<next>_*.sql`.

**Judge gate:** required (schema change).

### Task 2.2 — Mailbox writer + routing decision

**Output:** A single function `enqueueIfHostedRoute(threadId, eventRow)`
called from every Dev event ingestion site (comment_added, plan_edited_by_dev,
discussion_message_posted, etc.).

Behavior:
- Read `presence.isFresh(threadId)` (from Slice 1d's registry).
- Read `workspaces.hosted_enabled` for the Thread's Workspace.
- If `!isFresh && hosted_enabled`: INSERT into `mailbox_events` with
  `ON CONFLICT (thread_id, event_id) DO NOTHING`. Then `pg_notify('mailbox',
  threadId)` for live wake-up.
- Otherwise: no-op.

**Files:** new `apps/worker/src/server/mailbox.ts` (writer + decision). Call
sites: every Worker route handler that appends to the event-log.

**Judge gate:** required (new product surface, decision logic).

### Task 2.3 — Mailbox consumer (per Thread)

**Output:** A consumer that, given a `threadId`, drains all pending
`mailbox_events` rows in order and returns a batch payload. Used by the
Hosted Agent at the top of every Turn (and as the pre-Turn keep-alive poll).

`drainPending(threadId)`:
- `SELECT * FROM mailbox_events WHERE thread_id = $1 AND consumed_at IS NULL ORDER BY created_at`.
- `UPDATE mailbox_events SET consumed_at = NOW() WHERE id IN (...)`.
- Return the batch.

`waitForWake(threadId, timeoutMs)`:
- Subscribes via `LISTEN mailbox` once per Worker boot; filters NOTIFY
  payload by threadId; resolves when received OR timeout (5s polling
  fallback re-checks the table).

**Files:** extend `apps/worker/src/server/mailbox.ts`.

**Judge gate:** required (queue infra is the "new product surface" line in
CLAUDE.md).

### Task 2.4 — Hosted identity (`sk_hosted_*` + `Caller.kind = 'hosted'`)

**Output:** Worker mints a short-lived `sk_hosted_*` token at VM-provision
time (lives in memory; never persisted — fresh per Session). Token carries:
issued_at, expires_at (~1 hour), threadId, workspaceId. Verified by Worker's
existing `bearerAuth` middleware (extended).

`Caller` union grows a fourth variant: `{ kind: 'hosted', threadId,
workspaceId, sessionId }`. `authorizeThread` handles it directly (Hosted is
pre-authorized to its own threadId; mismatch = 403).

**Files:** `apps/worker/src/auth.ts` (extend); `apps/worker/src/server/cli-auth.ts`
(add `issueHostedToken(threadId)`).

**Judge gate:** required (new Caller kind = new auth surface).

### Task 2.5 — Sandbox provisioner (E2B)

**Output:** `apps/worker/src/vm/provision.ts` — given a `threadId` +
`hostedToken` + optional `repo_url`, creates an E2B Sandbox via
`@e2b/sdk`:

```ts
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create('tempo-hosted-runner', {
  apiKey: env.E2B_API_KEY,
  timeoutMs: 10 * 60 * 1000, // 10 min idle keep-alive
  envs: {
    TEMPO_THREAD_ID: threadId,
    WORKER_MCP_URL: env.WORKER_PUBLIC_URL,
    TEMPO_HOSTED_TOKEN: hostedToken,
    ...(repoUrl ? { REPO_URL: repoUrl, GITHUB_APP_TOKEN: ghToken } : {}),
  },
  // Egress allowlist — non-negotiable per agent-harness.md §6.
  allowOut: [
    'api.anthropic.com',
    'api.github.com',
    'github.com',
    'codeload.github.com',
    env.WORKER_HOST,
  ],
});
// Start the runner inside the sandbox.
await sandbox.commands.run('node /app/runner.js', { background: true });
// Write vm_runs.started_at row with sandbox.id as the external ref.
```

- **Template** `tempo-hosted-runner` is an E2B custom template (built via
  `e2b template build`) containing: Node 22, git, the bundled
  `apps/worker/dist/hosted-runner.js` (built by Task 2.6) at `/app/runner.js`,
  `@anthropic-ai/claude-agent-sdk`.
- **Cold start**: ~80ms same-region; first-time template pull adds a one-time
  ~1s overhead per region.
- **`timeoutMs`** is the auto-kill — sandbox dies if no command activity for
  10 min, so even if our supervisor misses a teardown call, E2B reaps it.

`teardown.ts` — `await sandbox.kill()` + write `vm_runs.ended_at` +
`exit_reason`. Idempotent on already-killed sandboxes.

**Files:** `apps/worker/src/vm/provision.ts`, `apps/worker/src/vm/teardown.ts`.

**Dependencies:** `bun add e2b` in `apps/worker`. New env var
`E2B_API_KEY` (Worker only; never reaches the sandbox).

**Judge gate:** required (sandbox provisioning is a "new external
infra surface" per CLAUDE.md; also adds a new paid dependency).

### Task 2.6 — Hosted runner (Node entrypoint inside E2B sandbox)

**Output:** A bundled Node script (`apps/worker/dist/hosted-runner.js`)
baked into the `tempo-hosted-runner` E2B template (Task 2.5). The script
runs inside the sandbox:

```
// runner.ts pseudocode
1. If REPO_URL: git clone --depth 1 --filter=blob:none $REPO_URL /workspace
2. Initialize Claude Agent SDK (@anthropic-ai/claude-agent-sdk) with:
   - System prompt for Tempo planning behavior (port the prompt from
     apps/agent/src/turn.ts — same content)
   - MCP HTTP transport pointing at WORKER_MCP_URL with TEMPO_HOSTED_TOKEN
   - Built-in tools: Read, Grep, Glob, Bash (operating on /workspace)
   - permission hook (canUseTool) — Plan-write tools always allowed during
     unapproved; connector-write tools deny (slice 3 will swap this in)
3. Call tempo_attach (gets WORKFLOW guide + state)
4. Initial Turn: drain Mailbox via tempo_poll-like surface for hosted (TBD
   below), run SDK loop until SDK signals done
5. Idle poll loop: every 5s, check mailbox; if pending → next Turn; if
   nothing for 10 min → process.exit(0)
   (E2B's timeoutMs is the backstop — sandbox auto-kills if we miss this.)
```

**The Mailbox-drain MCP surface for Hosted:** the simplest option is to
reuse `tempo_poll` (long-polls the event-log) and have the Hosted runner
also separately query Mailbox via a new `tempo_mailbox_drain` MCP tool that
returns the batch + marks consumed. **Decision required during this task's
plan**: one tool or two; recommendation is a single `tempo_poll_hosted`
variant that returns Mailbox rows + advances cursor on event-log, so the
Hosted SDK loop has one wake-up surface (mirroring the Local CLI's
"one nudge per Turn").

**Template build:** `e2b template build` against an `e2b.toml` in
`apps/worker/e2b/` that specifies the base image (Node 22 + git +
the bundled `hosted-runner.js`). Build once per release; provision
references the template by name.

**Files:** `apps/worker/src/hosted/runner.ts` (the Node entrypoint source),
`apps/worker/e2b/e2b.toml` (template manifest), `apps/worker/scripts/build-hosted-runner.ts`
(bundle the runner with bun, prepare the template build context).

**Judge gate:** required (new product surface: the runtime that runs the SDK).

### Task 2.6b — Activity stream from inside the VM

**Output:** The Hosted runner forwards every Agent step — thinking,
narration, tool calls, tool results, sub-task expansions, todo updates — to
Worker's existing `POST /api/agent-events` endpoint so Console's activity
feed populates identically for Hosted as it does for Local. (Reference UX:
Manus-style "Knowledge recalled / Search / Extract detailed information"
inline step list — the Dev sees what the Agent is doing in real time, not
just the final reply.)

How:

- The Claude Agent SDK exposes typed callbacks/iterators for each event
  the model emits (text deltas, tool_use, tool_result, thinking blocks,
  subagent dispatch). The runner subscribes once at SDK init, transforms
  each event into the existing `AgentEventRequest` shape from
  `packages/contracts/src/events.ts`, and POSTs to Worker.
- Wire shape is identical to what Local emits today — Worker's
  `/api/agent-events` handler appends to the event log unchanged, SSE
  fans out to Console unchanged. Console's activity-feed component needs
  no awareness of which runtime produced the event.
- Auth: the `sk_hosted_*` Bearer issued in Task 2.4 is accepted by the
  same `bearerAuth → ensureThreadAccess` chain that Local uses.
- Subagent fan-out events (when we land the deferred parallel-channel
  optimization) flow through the same path — each sub-agent's step is
  one more event on the same Thread's event log. No new transport.

What stays out of scope here:

- **No new event kinds** unless absolutely necessary. Reuse
  `agent_text_delta`, `agent_tool_use`, `agent_narration`,
  `agent_todos_updated`, `agent_turn_ended` from the existing contract.
- Local's `apps/agent/src/stream-pump.ts` is NOT lifted to a shared
  package. Local parses raw stream-json (it spawns `claude` as a
  subprocess); Hosted consumes typed SDK callbacks. The two emitters
  differ but converge on the same `AgentEventRequest` wire shape — that's
  where the seam belongs.

**Files:** part of `apps/worker/src/hosted/runner.ts` (the entrypoint
already exists in Task 2.6; this is one block inside it). One small
helper that maps SDK event → AgentEventRequest.

**Judge gate:** not separately required if Task 2.6's plan already covers
this. If the implementer splits 2.6 into separate plans, then yes.

### Task 2.7 — Wire Hosted lifecycle from Mailbox writes

**Output:** A small "supervisor" inside Worker that listens for NOTIFY on
`mailbox` and, for each `threadId`:
- If a VM is already running for this Thread (Worker tracks in-memory) →
  no-op (the VM polls Mailbox itself).
- If not → provision a VM (Task 2.5), inject token + env.

**Files:** `apps/worker/src/hosted/supervisor.ts`. In-memory
`Map<threadId, SandboxHandle>` (where `SandboxHandle` wraps E2B's `Sandbox`
instance + start timestamp) keyed identically to the presence registry shape
(deliberate parallel — see Slice 1d).

**Judge gate:** required (orchestration logic, billing-affecting).

### Task 2.8 — Console toggle (Workspace admin)

**Output:** A single setting on the Workspace admin page:
*"Hosted Agent: [off | on]"*. Maps to `workspaces.hosted_enabled`.

**Files:** existing Workspace settings page + a new `PATCH /api/workspace/settings`
on Console (Clerk admin gate). Worker reads `hosted_enabled` per request
via existing DB lookup.

**Judge gate:** not required — UI toggle on an existing schema column;
trivial route.

## Forward-compat constraints

- Local CLI loop (Slice 1d) must NOT touch Mailbox. Its in-memory queue
  stays purely Local. Mailbox is a Hosted-only concept.
- Worker's presence registry from Slice 1d is read by Task 2.2's enqueue
  decision. If/when Worker becomes multi-process, the registry must move
  to a shared store at the same time the Mailbox supervisor does (both
  are single-Worker assumptions today).
- The MCP `tempo_*` surface stays single. Hosted speaks the same tools as
  Local. New `tempo_poll_hosted` or equivalent is the only addition.

## Files / paths that grow

```
apps/worker/src/
├── server/mailbox.ts            (Tasks 2.2 + 2.3 — writer, router, consumer)
├── auth.ts                      (Task 2.4 — extend Caller union)
├── server/cli-auth.ts           (Task 2.4 — issueHostedToken)
├── vm/
│   ├── provision.ts             (Task 2.5)
│   └── teardown.ts              (Task 2.5)
├── hosted/
│   ├── runner.ts                (Task 2.6 — runs INSIDE the VM)
│   └── supervisor.ts            (Task 2.7 — runs IN Worker)
├── routes/admin/workspace.ts    (Task 2.8 — toggle endpoint; in Console)

packages/db/
├── src/schema.ts                (Task 2.1 — mailbox_events, hosted_enabled, vm_runs)
└── drizzle/<next>_*.sql         (Task 2.1)

packages/contracts/src/
├── workflow.ts                  (Task 2.6 — Hosted-flavored WORKFLOW or shared)
└── mcp.ts                       (Task 2.6 — tempo_poll_hosted schema if separate)
```

## Net-deletion opportunities

- None in Slice 2 directly; this is additive infrastructure.
- agent-harness.md "lazy VM" wording is replaced by "always-VM, conditional
  clone" — net char delta, no LOC.

## Acceptance check (end of Slice 2)

The Dev should be able to:
1. Toggle `hosted_enabled=true` on their Workspace (SQL or UI from 2.8).
2. Open a Thread (no Local CLI running).
3. Post a Discussion Message asking the Agent something.
4. **Within ~10 seconds**, see the activity feed populate: VM provisioned,
   `tempo_attach` succeeds, Agent reads Discussion + replies.
5. Reply again with a follow-up. The same VM picks it up via Mailbox poll
   — no cold start (keep-alive window).
6. Walk away for 15 minutes. Come back, post another message. Cold-start
   happens (~5–10s), Agent re-attaches via `tempo_attach`, conversation
   continues coherently because Plan + Discussion are the persistent
   state.
7. Verify `vm_runs` table shows each VM's started_at / ended_at, exit
   reason, cost estimate.

## Open questions for task-time judge review

(Captured so they don't get rediscovered mid-task.)

1. **`tempo_poll_hosted` vs reuse `tempo_poll`** — does the Hosted runner
   need a separate MCP tool for Mailbox drain, or can `tempo_poll` (which
   long-polls event-log) be extended to return Mailbox-batched payloads
   when called by a `hosted` caller? Recommendation: extend; one tool;
   payload shape gains an optional `mailbox_batch` field.
2. **Repo clone failure handling** — what happens if `git clone` fails
   (token expired, repo deleted, permissions revoked)? Recommendation:
   VM stays up, reports the failure as an `agent_text_delta`, Dev sees the
   error in activity feed, can fix and re-trigger.
3. **VM cost-cap** — should there be a per-Workspace daily cost ceiling?
   MVP: no, but instrument `vm_runs.cost_estimate_usd` so a future cap is
   easy.
4. **API key shape** — Tempo-metered vs BYOK? agent-harness.md §2 hosted
   says "API keys (Tempo-metered or BYOK)." Recommendation for MVP:
   Tempo-metered only; BYOK is a follow-up.

---

## Reading order for the implementer

1. `plans/agent-harness.md` (binding architecture; §2 Hosted, §3 brain
   location, §4 input flow, §6 VM lifecycle, §7 agent layer — but read with
   the corrections in this document overriding the "lazy VM" / "60s
   debounce" passages).
2. This document.
3. `plans/slice-1d-cli-lifecycle.md` (prerequisite — the presence registry,
   Session/Turn vocabulary, and routing-decision input come from there).
4. `CONTEXT.md` (vocabulary; Hosted Agent + Mailbox + VM definitions land
   alongside this slice).
5. `CLAUDE.md` (judge gate criteria, layer placement rules).

## Judge gate strategy

This document itself does **not** need a judge approval — it's a task
breakdown, not an implementation plan. **Each task's full plan invokes the
judge** before implementation per CLAUDE.md, because each is a "new product
surface" or schema change. That keeps the judge load proportional to each
concrete decision rather than one giant gate at the start.
