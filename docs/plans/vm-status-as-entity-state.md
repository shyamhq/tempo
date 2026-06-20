# Plan — VM provisioning status as durable entity state + SSE push

## Problem statement

The hosted-agent provisioning checklist ("Provision sandbox → Clone repository →
Start Agent") is rebuilt **only from the live `vm_progress` SSE stream**, with no
durable backing. `useProvisioningState` starts empty and accumulates events as they
arrive (`apps/console/hooks/use-thread-events.ts:344`). Any provisioning the browser
was not actively subscribed to is therefore lost:

- A **second provision** triggered by an auto-wake long after page load (the reported
  bug — screenshot shows the checklist skipped, only `sandbox … · just now` rendered).
- Late page-open, or an SSE reconnect past the Redis stream's MAXLEN trim window.

Separately, the current snapshot path **polls** `GET /api/threads/:id/hosted/state`
on a `refetchInterval` (`hosted-agent-control.tsx:52`) — 500–700ms per call, firing
forever (every 5s) after the VM is up. The system already has a first-class push
channel (Redis Streams → SSE) that `presence` rides; polling is the wrong transport.

Root cause: provisioning state is modelled as a transient activity **event** and
reconstructed from a stream, instead of as **durable entity state** on the row that
already represents one VM's lifecycle (`vm_runs`).

## The smallest concrete change

Model VM status the same way `presence` is already modelled: durable truth + an
ephemeral SSE signal + hydrate-once-into-the-thread-view.

### Durable state
- `vm_runs.status text NOT NULL DEFAULT 'provisioning'` and `vm_runs.status_reason text`
  (nullable, sanitized). Migration. `status` ∈ `provisioning | cloning | starting | ready | failed`.
  - `provisioning` — row INSERT (sandbox being created). Default covers it.
  - `cloning` — `Sandbox.create` succeeded.
  - `starting` — runner reports clone finished.
  - `ready` — runner reports agent started.
  - `failed` — `status_reason` carries the sanitized message.

### Contract (`packages/contracts`)
- `VmStatus = z.enum([...])` — single source for the five values.
- `VmStatusSignal = { kind: 'vm_status', status: VmStatus, reason?: string }` — sibling
  of `PresenceSignal`: ephemeral, SSE-only, **not** in the `Event` union, never persisted.
  `shouldDeliverToAgent` → false (browser-only, like presence).
- `GetThreadResponse.vm: { sandbox_id: string|null, started_at, status, reason? } | null`,
  next to `agent_present`.
- `ProvisionStatusRequest = { status: z.enum(['starting','ready','failed']), reason?: string }`
  for the runner→worker route.
- **Delete** `VmProgressEvent` from the `Event` union + `EventKind`, its `shouldWake`/
  `shouldDeliverToAgent` special-cases, and `VmProgressEvent` from `AgentEventRequest`.
- **Delete** `HostedStateResponse` (vm state rides the thread view now).

### Server (`packages/server`)
- `publishVmStatus(threadId, status, reason?)` in `redis.ts` → `pushFrame(...)` (mirror of
  `publishPresence`).
- `setVmRunStatus(threadId, status, reason?)` in `mailbox.ts`: UPDATE the open row's
  `status`/`status_reason` **and** `publishVmStatus` together, so durable state and the
  live push can't diverge.
- `getHostedState` returns the open + heartbeat-fresh row including `status`/`status_reason`
  and a **nullable** `sandbox_id` (so `provisioning`, before `sandbox_id` is set, is
  reported — currently it returns null in that window). Server-side caller `routeWake`
  is unaffected (still `if (vm && !reprovision) return`; reporting the row earlier is
  strictly safer against double-spawn, and the unique index already prevents a double INSERT).

### Worker (`apps/worker`)
- `provision.ts`: set `cloning` on `Sandbox.create` success; `failed` + sanitized reason on
  create error (replaces the two `appendEvent({kind:'vm_progress'})` calls). INSERT relies
  on the column default for `provisioning`.
- New route `POST /api/threads/:id/hosted/provision-status` (`routes/hosted/provision-status.ts`):
  parse → validate `ProvisionStatusRequest` → `setVmRunStatus` → 204. `sk_hosted` caller only.
- `runner.ts`: the 4 `postAgentEvent({kind:'vm_progress'})` calls → POST the new route
  (`repos_cloned` → `starting`, `agent_started` → `ready`, both failures → `failed`).

### Console (`apps/console`)
- `app/api/threads/[id]/route.ts` GET: add `getHostedState(id)` to the `Promise.all` and
  return `vm` in the response (alongside `agent_present`).
- `hooks/use-thread-events.ts`: parse `VmStatusSignal` (before the `Event` guard, like
  `PresenceSignal`) → patch `vm` in the `['thread', threadId]` cache. Add `['thread', id]`
  is already invalidated on SSE reconnect (existing backstop) → re-hydrates `vm`.
  **Delete** `useProvisioningState`, `provisioningKey`, `ProvisioningState`,
  `EMPTY_PROVISIONING`, and the `vm_progress` accumulator case.
- `hosted-agent-control.tsx`: take `vm` as a prop from the thread view; derive the 3-step
  checklist from `vm.status`; **delete** the `useQuery` poll. `thread-view.tsx` passes `vm`.
- `lib/api-client.ts`: delete `getHostedState` + `HostedStateResponse` import.
- Delete the `app/api/threads/[id]/hosted/state/route.ts` endpoint.

## Alternatives considered

1. **Reduce the persisted `vm_progress` event log into the existing poll** (no migration).
   The events ARE persisted (`appendEvent` writes every kind). Rejected: it event-sources a
   single widget's state, keeps polling, and keeps `vm_progress` as a shoehorned activity
   event. Less standard; the Dev explicitly chose migrations-OK + standard over reuse-trick.
2. **`vm_runs.status` column + keep polling the `/hosted/state` endpoint** (no SSE).
   Rejected: polling is the wrong transport in a system that already pushes (`presence`).
   The Dev called out the 500ms poll churn directly.
3. **Chosen: durable column + presence-style SSE signal + fold `vm` into the thread view.**
   Standard entity-state model, consistent with how `agent_present` already works, removes
   polling, removes an endpoint/query/event-kind/accumulator.

## Uncertainties

- Whether to keep a dedicated `getHostedState` HTTP route for any future non-thread-view
  consumer. Current read: no — only `HostedAgentControl` used it; fold into the thread view
  and delete. (Server-side `getHostedState` fn stays for `routeWake` + thread hydration.)
- `status_reason` rendering: a prior note flagged raw `err.message` leaking via the failed
  reason. Mitigation: store only `sanitizeCloneError(...)` output; the runner already
  sanitizes before posting. Worker create-failure path will sanitize before `setVmRunStatus`.
- Brief `starting` window (clone done → agent streaming) may be sub-second; the checklist
  step still exists, so it renders correctly regardless of duration.
- Migration ordering: `drizzle-kit generate` stamps `when` ≈ now (< existing max
  `1782070000004`). Must hand-edit the new journal entry's `when` to `> 1782070000004`
  or the migrator silently skips it (documented trap). Explicit post-generate step.

## Layer assignment

| New fn / file | Layer |
|---|---|
| `VmStatus`, `VmStatusSignal`, `ProvisionStatusRequest` | `packages/contracts` (wire shapes) |
| `publishVmStatus` | `packages/server/src/redis.ts` (realtime transport) |
| `setVmRunStatus`, `getHostedState` change | `packages/server/src/mailbox.ts` (hosted-runtime DB write + publish) |
| `vm_runs.status` / `status_reason` | `packages/db` schema + migration |
| `provision-status` route handler | `apps/worker/src/routes/hosted/provision-status.ts` (thin: parse → validate → server fn → 204) |
| thread GET `vm` hydration | `apps/console/app/api/threads/[id]/route.ts` (route handler → server fn) |
| `VmStatusSignal` SSE patch | `apps/console/hooks/use-thread-events.ts` (SSE consumer) |

## Deletion test (new modules/files)

- `vm_runs.status` column — if deleted, status reverts to being derived from a transient
  stream; the whole missed-events bug class reappears. Not a pass-through.
- `VmStatusSignal` / `publishVmStatus` — if deleted, no realtime VM-status push; complexity
  reappears as polling. Mirrors the accepted `PresenceSignal`/`publishPresence` shape.
- `setVmRunStatus` — real logic (keeps the durable row and the SSE push in sync); 6 callers.
- `provision-status` route — sole channel for the runner to report in-sandbox milestones
  (clone done, agent started). Deletion → checklist stuck at `cloning`. Not a pass-through.

## Destructive-action acknowledgment (rule 24)

Schema migration (adds two columns; **no** column/data drops). Dev acknowledgment, this turn:
> "I am ok with deleting and breaking / refactoring stuff including migrations. but it
> has to be standard not hacky and patchy." … "go."

---

## SUPERSEDED — as-built design (after the-algorithm/ponytail review + runner-timing check)

The status-column design above was **not** built. The algorithm/ponytail review +
verifying the runner's actual sequence collapsed it further, and the result needs
**no migration at all**.

**Runner timing (verified in `runner.ts`):** the runner opens its `/events` SSE
connection (→ Redis presence goes live) *before* it would post any "agent started"
signal, and the clone→presence gap is just `buildToolset` (no network). So:
- `ready` / `agent_started` is redundant with **agent presence** — and arrives *after*
  it. Deleted.
- `starting` is sub-second / unobservable. Deleted.

That leaves two real provisioning phases — `provisioning` (sandbox booting) and
`cloning` (sandbox up) — which are *exactly* `vm_runs.sandbox_id IS NULL` vs `IS SET`,
already on the row. A status column would be a pure function of `sandbox_id`, i.e.
denormalization. So **no column**: phase is derived at the read boundary.

**As built:**
- `VmState` / `VmPhase` (`provisioning | cloning | failed`) + `VmSignal` — an ephemeral
  SSE-only frame, **sibling of `PresenceSignal`** (not in the `Event` union, excluded
  from `shouldDeliverToAgent`). `publishVmSignal` mirrors `publishPresence`.
- `getHostedState` derives `phase` from `sandbox_id` and returns `VmState | null`;
  `vm` is folded into `GetThreadResponse` next to `agent_present`, hydrated once and
  patched live by the `vm` SSE frame (same shape as presence). **No poll.**
- `provision.ts` pushes `provisioning` (INSERT) → `cloning` (sandbox_id set) → `failed`
  (create error, via `failVmRun`). `supervisor.reap` pushes `vm:null` on teardown.
- The runner reports only failures, through the existing `/api/agent-events` as a
  `vm_failed` payload → `failVmRun` (single `UPDATE … RETURNING`: close row + push
  `failed` frame, reason bounded + sanitized by callers).
- Console checklist is **2 steps** (Provision sandbox / Clone repository); "done" =
  `agent_present` swaps to the sandbox line. (A 3rd "Start Agent" step was dropped — it
  could never visibly activate given presence fires first; both reviewers flagged it.)

**Deleted:** `vm_progress` event kind (+ `EventKind`/`shouldDeliverToAgent` entries +
`AgentEventRequest` variant + test), `useProvisioningState`/accumulator, the polling
`/hosted/state` route + `api.getHostedState` + `HostedStateResponse`, the runner's
`repos_cloned`/`agent_started` posts.

**Known tradeoffs (flagged, not machinery'd):**
- Failure (`vm_failed`) isn't stored — shown live, cleared on reload/retry. An unrelated
  thread refetch can clear the banner early; acceptable for a terminal pre-retry state.
- Hard worker death (no `reap`) leaves the checklist up until the thread view's 30s
  `refetchInterval` re-hydrates (`getHostedState` returns null on a stale heartbeat).

**Gate:** typecheck 8/8; lint clean on all changed files; tests contracts 16/0,
server 72/0, worker 62/0. Runner bundle rebuilt (`build:hosted-runner`).

**Spotted but not fixed (out of scope):** pre-existing `packages/server/src/comments.ts`
biome format violation; pre-existing raw-`err` log in `spawnHosted` catch; `appendToStream`
one-line pass-through; `WakeHostedResponse`'s `'pending'` sandbox_id sentinel.
