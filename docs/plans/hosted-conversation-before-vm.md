# Plan — Hosted conversation before the VM (repo-gated provisioning)

**Status:** Draft for judge.
**Scope:** Hosted-agent runtime + per-Thread GitHub repos. GitHub-only for v1.

## Problem

Today every Hosted Thread auto-provisions an E2B VM on the first wake
(`routeWake` → `spawnHosted` → `provision`), regardless of whether there's any
code to work on. That burns money and cold-start latency for pure planning
conversations, and the blank "Provisioning sandbox…" state is the same surface
that hangs forever when a runner fails to boot.

A VM exists for exactly one reason: to clone a repo and run repo I/O. With no
repo, the VM isolates nothing — the agent only calls in-Worker `tempo_*` tools
and web search.

## The smallest change

Gate VM provisioning on a single programmatic predicate:

```
wake on a hosted Thread (in the Worker's wakeHostedHandler):
   threads.repos non-empty  → spawn VM   (today's path, unchanged)
   threads.repos empty      → run one in-process conversation turn (NEW)
```

A repo-less Hosted Thread runs its planning conversation **in-process in the
Worker** — no Sandbox. Attaching a repo flips the predicate and the next wake
routes to a freshly-provisioned VM that hydrates the full conversation from the
persisted Discussion. No process handoff: both runtimes derive context from the
artifact (Plan + Comments + Discussion), so the in-process agent never holds
private RAM state to lose.

## Two runtimes, one principle

- **In-process turn (no repo).** Per-wake, stateless. Rebuilds history from
  `getTurnHydration`, runs one `streamText` turn with a small toolset, emits
  `agent_narration`/`agent_tool_use`/`agent_turn_ended` via `appendEvent`,
  returns. No SSE-to-self, no idle keep-alive.
- **VM turn (repo).** Unchanged `runner.ts` — kept-alive, hydrates via
  `/access`, SSE wake subscriber, idle exit. Reached only when repos exist.

**Principle (the ADR):** keep-alive earns its keep only when in-context state is
expensive to rebuild (repo exploration). The no-repo conversation's state is
fully captured by the persisted Discussion, so it runs per-wake.

## Trigger

Programmatic, never an LLM decision. The Dev attaches repos in the composer's
**Thread context** bar (`apps/console/prototypes/thread-resources.html`, variant
A — Dev-picked 2026-06-20, chips below the input); the selection rides with the
discussion-message send. The server diffs the sent list against `threads.repos`
and, if changed, updates the column **and** appends a `repo_linked` event in one
transaction. The agent may *ask* for a repo in prose; it never provisions or
clones.

## Cloning

Provision-time, deterministic. At spawn the Worker reads `threads.repos`, mints
the GitHub **App installation token**, and passes the repo list + token into the
sandbox. The runner clones each `owner/name` into `/workspace/<name>` before
Turn 1. Never an agent tool call (token is ~1h TTL; mint immediately before
`Sandbox.create`).

## Six design decisions (from the adversarial gap pass)

1. **In-process serialization.** A wake acquires a Redis `SET NX EX` lock per
   thread before running; the holder re-drains `getEventsSinceLastTurn` (DB) at
   the end so events that arrived on any container are coalesced. One turn at a
   time, globally — no double replies.
2. **Presence.** Read-path override: `agent_present = true` when
   `agent_type === 'hosted' && repos empty`, in `getThread` + `listThreads`. No
   Redis write.
3. **Provisioning failure.** A `failed` step on the `vm_progress` event (not a
   separate kind). Runner/provision emit it on create/boot/clone failure so the
   checklist shows an error instead of hanging on "Provisioning…".
4. **Mid-session repo add.** `repo_linked` reaching a **live** runner = the
   runner self-exits; the next wake re-provisions a fresh VM with the full repo
   list. No mutable env, no clone tool.
5. **Connector allowlist.** **Move** the existing `assertConnectorEnabled`
   wrapper (`apps/worker/src/gateway/connector-call.ts`, over `isConnectorEnabled`
   already in `@tempo/server`) into `@tempo/server/connectors`; both the MCP path
   and the in-process tools call it before hitting GitHub. Closes an allowlist
   bypass.
6. **Branch location.** The repos gate lives in the Worker's `wakeHostedHandler`
   (reads `threads.repos`), not in `routeWake` (stays thin, HTTP-only).

## Multi-container coordination

The Worker runs as N replicas. Correctness lives in Redis + Postgres, never in a
single container's memory:

- **Double in-process turn** → Redis `SET NX EX` lock (decision 1).
- **VM liveness via heartbeat** → add a `vm_runs.last_seen_at` column, touched by
  any container on activity (the same container also reconnects-by-`sandbox_id`
  to refresh E2B's wallclock). "Live" = an open row with a **fresh** heartbeat
  (within ~2× the E2B idle window). `getHostedState` / `isHostedReadyToWake`
  treat a lapsed-heartbeat row as **dead**, so a phantom row never shows a ghost
  VM or blocks the wake.
- **Double VM spawn + stale-row reap** → partial unique index
  `vm_runs(thread_id) WHERE ended_at IS NULL` blocks *genuine* concurrent spawns.
  Before its `INSERT`, the spawn path **lazily reaps** any open row whose
  heartbeat has lapsed. **The reap UPDATE must carry the freshness predicate —
  `WHERE ended_at IS NULL AND last_seen_at < <threshold>` — never `ended_at IS
  NULL` alone, or it re-becomes the sibling-killing boot sweep we just deleted.**
  Threshold ~2× `SANDBOX_INACTIVITY_MS` (comment *why* 2× not 1×: a live VM's
  heartbeat can lag briefly during a long tool call). This is the load-bearing
  pair: the reap guarantees a corpse row is closed first, so the unique index can
  never wedge a thread permanently — it only rejects a real second spawn racing
  in the same instant.
- **Boot orphan sweep** → **deleted** (`startSupervisor` closing all open
  `vm_runs` would kill sibling containers' live VMs on every deploy). The
  heartbeat + lazy reap **replaces** it; E2B's wallclock remains the backstop
  that actually kills the sandbox.
- **Presence, SSE, event delivery** → already Redis-backed, already safe.

## Build checklist (wiring — no decisions)

- **Schema:** `threads.repos text[] not null default '{}'`;
  `vm_runs.last_seen_at timestamptz` (heartbeat); partial unique index on
  `vm_runs(thread_id) where ended_at is null`. (Bump `_journal.json` `when`
  above `1782070000003`.)
- **Contracts:** `CreateThreadRequest.repos`, `PostDiscussionMessageInput.repos`,
  `TurnHydration.thread.repos`; new event kinds `repo_linked` (wake-eligible) and
  `vm_progress` with a `failed` step (browser-only, excluded from
  `shouldWake`/`shouldDeliverToAgent`); `owner/name` regex on each element.
  `repos` on `PostDiscussionMessageInput` is **Dev-only, enforced server-side**
  by an author-role check (exactly as `questions` is Agent-only today — not a
  schema rule, and not advertised in the MCP tool description the Agent sees), so
  the Agent cannot set it.
- **Server:** `createThread` accepts repos; `postMessage` diffs + emits
  `repo_linked`; `getInstallationToken(workspaceId)` returns the raw token (new
  surface — the GitHub client only ever holds an `Octokit` today; verify the
  `octokit.auth({type:'installation'})` shape against the installed version);
  **move** the existing `assertConnectorEnabled` wrapper
  (`apps/worker/src/gateway/connector-call.ts` over `isConnectorEnabled` in
  `@tempo/server`) into `@tempo/server/connectors` so the in-process tools share
  it; in-process turn module (Redis lock + re-drain + small `tool()` set over
  `@tempo/server` fns); presence override.
- **Worker:** `wakeHostedHandler` reads repos and branches; `spawnHosted` /
  `provision` accept `repos[]` + token; the spawn path **lazily reaps a
  stale-heartbeat `vm_runs` row before its INSERT** and touches `last_seen_at` on
  activity; supervisor drops the boot orphan-sweep; `provision` emits
  `vm_progress: sandbox_ready`.
- **Runner:** `maybeCloneRepo` (exists, single-repo; `repoUrl`/`ghToken` already
  plumbed through `provision`) becomes a loop into `/workspace/<name>`; emits
  `vm_progress: repos_cloned` / `agent_started` and `vm_progress: failed` on
  clone/boot failure; self-exits on `repo_linked`.
- **Console:** `thread-resources.html` **variant A** (Thread-context chip bar
  *below* the input + `+` modal repo picker — Dev-picked 2026-06-20) wired into
  `new-thread-compose` and the discussion composer; provisioning checklist UI
  from `vm_progress`.

## Alternatives considered

- **Keep "always provision," skip clone when no repo.** Rejected — keeps the
  cold-start, cost, and stuck-spinner surface for zero isolation benefit.
- **Kept-alive in-process loop** (in-RAM history per thread). Rejected — imports
  the runner's keep-alive complexity to amortize a cost (provisioning) that the
  in-process path doesn't have; per-wake rebuild from the Discussion is cheap and
  faithful for repo-less context.
- **In-process reuses runner over `127.0.0.1/mcp`.** Rejected — drags VM-shaped
  scaffolding (SSE-to-self, abort controllers) into a place with no VM.
- **LLM decides when to provision.** Rejected — a clean boolean exists
  (`repos` non-empty); an LLM gate adds cost and both failure modes.
- **General `thread_resources` table now.** Deferred — GitHub is the only
  VM-relevant and only per-thread-wired connector; ship `threads.repos text[]`,
  generalize when a second connector type actually attaches per-Thread
  (CONTEXT §"one adapter is hypothetical").

## Uncertainties

- E2B reconnect-by-id semantics for refreshing the wallclock from a non-spawning
  container need a docs check before relying on it as the multi-container reap
  path.
- `getInstallationToken` raw-token extraction via `octokit.auth({type:
  'installation'})` is the assumed API; verify against the installed octokit
  version.
- In-process turn token cost under rapid messages assumes Anthropic ephemeral
  cache covers the static prefix; confirm a cache breakpoint on the rebuilt
  history actually warms.

## Layer assignment

- `assertConnectorEnabled`, `getInstallationToken`, in-process turn module,
  presence override, `postMessage` repo-diff → `@tempo/server/**` (business +
  connector logic).
- Schema + index → `packages/db/**`.
- Contract shapes + event kinds → `packages/contracts/**`.
- `wakeHostedHandler` branch, `provision`/`runner` repo wiring → `apps/worker/**`.
- Repo picker + checklist → `apps/console/components/**`; route handlers stay thin.

## Deletion test

- **In-process turn module:** if deleted, every repo-less Hosted Thread would
  have to provision a VM again — complexity concentrates here, earns its keep.
- **`assertConnectorEnabled`:** if deleted, the allowlist check scatters into
  every connector call site (MCP + in-process). Concentrates — keep.
- **`vm_progress`:** if deleted, the provisioning state has no data source and
  the UI goes back to a blank spinner. Keep.

## Destructive actions

None in this plan. Schema migration is additive (new column + index, no drops).
Deleting the boot orphan sweep removes a harmful-in-multi-container behavior; no
data loss.
