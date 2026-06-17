# Plan — Per-Thread Agent Type Selection (Local vs Hosted) + Auto-Wake Routing

## Problem

Today every Thread is implicitly Local: the Dev runs `npx tempo-agent connect <token>` and the CLI Agent drives the Thread. The Hosted runtime exists (Slice 2) but is gated by a workspace-level `workspaces.hosted_enabled` flag, has no per-Thread choice on the compose screen, and spawns a VM only via an explicit "Run Hosted Agent" button click (`/hosted/wake`).

Two gaps:

1. **No runtime choice at creation.** The Console's new-thread compose screen offers no Hosted-vs-Local selection. Users get implicit Local; Hosted is hidden behind a manual workspace flip plus a wake-button click.
2. **No auto-provision on Dev work.** A Hosted Thread receives no VM unless someone clicks the button. The `WAKE_KINDS` machinery exists in `packages/contracts/src/events.ts` but is only used by the *already-running* runtime to drain events into a Turn — not as a wake trigger. (The header comment in `packages/server/src/mailbox.ts:11–14` makes this explicit: "Wake-on-NOTIFY is deliberately not a thing.")

## Smallest concrete change

### 1. DB schema (one migration, atomic)

```sql
-- packages/db/drizzle/000N_add_agent_type.sql
ALTER TABLE threads ADD COLUMN agent_type text;
UPDATE threads SET agent_type = 'local' WHERE agent_type IS NULL;
ALTER TABLE threads ALTER COLUMN agent_type SET NOT NULL;
ALTER TABLE workspaces DROP COLUMN hosted_enabled;
```

Drizzle schema (`packages/db/src/schema.ts`):
- `threads`: add `agent_type: text('agent_type', { enum: ['local', 'hosted'] }).notNull()`
- `workspaces`: remove `hosted_enabled`

### 2. Contract changes (`packages/contracts/src/`)

- `events.ts` — `WAKE_KINDS` shrinks to `{ comment_added, reply_added, discussion_message_posted }`. Drop `comment_resolved`, `comment_unresolved`, `comment_deleted` (Dev housekeeping; no Agent re-spawn needed).
- `http.ts` —
  - `CreateThreadRequest`: add `agent_type: z.enum(['local','hosted'])`, **required** (no server default).
  - `ThreadSummary`: add `agent_type: z.enum(['local','hosted'])`.
  - `HostedStateResponse`: drop `hosted_enabled` field.
  - `WakeHostedResponse`: drop the `'hosted_off'` discriminator variant (workspace gate gone).
- `CreateThreadResponse`: shape unchanged — `connect_token` still always returned (cheap, ignored by Hosted clients).

### 3. Server-side wake routing — `appendEvent` post-hook

In `packages/server/src/event-log.ts:14`, after the `db.insert(events)` call, add:

```ts
if (shouldWake(event)) {
  await routeWake(threadId, event);
}
```

New helper `routeWake(threadId, event)` (same file, no new module — single small function):

- Read `thread.agent_type`, `thread.workspace_id` (single query).
- If `'hosted'`: call existing `isHostedReadyToWake(threadId)`. If `live`, return. Else fire-and-forget `POST {WORKER_INTERNAL_URL}/hosted/wake` with `{ id: threadId }`. Don't await. Failures logged via Pino, never thrown — the manual wake button is the fallback.
- If `'local'`: no-op. Existing CLI long-poll picks up wake events on its own; UI banner handles the disconnected case.

Comment on the routeWake call:
```ts
// ponytail: HTTP fire-and-forget, upgrade to pending_wakes table + worker LISTEN
// when multi-worker / at-least-once delivery matters.
```

### 4. Server-side hosted helpers (`packages/server/src/mailbox.ts`)

- Delete `readHostedFlag` (workspace flag gone).
- `getHostedState`: return `{ vm: { sandbox_id, started_at } | null }`. Drop the workspace join.
- `isHostedReadyToWake`: returns `{ live: boolean }` only.
- Update the file header comment — replace "Wake-on-NOTIFY is deliberately not a thing" with the new architecture note (post-hook in event-log.ts).

### 5. Worker `/hosted/wake` handler (`apps/worker/src/routes/hosted/wake.ts`)

- Drop the `hosted_enabled` lookup.
- Add a guard: if `thread.agent_type !== 'hosted'`, respond 400 `{ error: 'agent_type_mismatch' }`.
- Same for `GET /hosted/state` (`apps/console/app/api/threads/[id]/hosted/state/route.ts`) — 400 on Local Threads.

### 6. Console UI — new-thread compose (`apps/console/components/dashboard/new-thread-compose.tsx`)

- Add Hosted/Local card row **above** the textarea (Variant A from `apps/console/prototypes/agent-choice.html`).
- Hosted card pre-selected; cards always visible.
- "Hosted agent" / "Local agent" titles. No SOLO DEV / TEAMS tags. Quiet permanence note: *"Tempo runs where you point it — can't switch mid-Thread."*
- Delete `CreatedCard` entirely.
- On submit success: `router.push('/threads/{id}' + (agentType === 'local' ? '?connect=1' : ''))`.
- Pass `agent_type` to `api.createThread()`.

### 7. Console UI — thread page (`apps/console/components/thread/thread-view.tsx`)

- Branch on `thread.agent_type`:
  - `'local'` → existing `<ConnectButton>`, with new `defaultOpen` prop wired to `useSearchParams().get('connect') === '1'`. On mount, if `defaultOpen` is true, also call `router.replace('/threads/{id}')` to strip the param.
  - `'hosted'` → new `<RunHostedAgentButton>`.
- If `'local'` and no connected session → render `<LocalDisconnectedBanner>` above the discussion.

### 8. `<RunHostedAgentButton>` (new — `apps/console/components/thread/run-hosted-agent-button.tsx`)

Three states driven by polling `GET /api/threads/:id/hosted/state`:

| `vm` state | Render |
|---|---|
| `null` | Primary button "Run Hosted Agent" (click → `POST /api/threads/:id/hosted/wake`) |
| Optimistic post-click | "Starting…" with spinner; disabled |
| Non-null | Status pill "Hosted Agent Running" + tooltip (`sandbox_id`, `started_at`); not clickable |

Polling: `refetchInterval: 5000` while `vm: null`, `15000` while running. `staleTime: 0`. Errors → existing toast surface.

### 9. `<ConnectButton>` change (`apps/console/components/thread/connect-button.tsx`)

Add optional `defaultOpen?: boolean` prop. Internal `useState<boolean>(defaultOpen ?? false)`. No other behavior change.

### 10. `<LocalDisconnectedBanner>` (new — `apps/console/components/thread/local-disconnected-banner.tsx`)

Renders iff `agent_type='local'` AND no `sessions` row with `status='connected'` exists. Driven by a new `useLocalSessionStatus(threadId)` query (10s poll). If the existing event SSE stream already carries `session_connected`/`session_disconnected` events, piggyback on that subscription instead of polling (verify during implementation — uncertainty #1).

Copy: *"Local Agent isn't connected. Click Connect above to start working."* — with a CTA that opens the `<ConnectButton>` dialog.

### 11. Env var

New: `WORKER_INTERNAL_URL` in Console env. Default `http://localhost:3001` in dev (verify port — uncertainty #4). Read once in `routeWake`.

---

## Alternatives considered

### Drop `workspaces.hosted_enabled` vs keep gate

- **(a)** Keep gate, show Hosted card disabled with "Enable in Settings →" on disabled workspaces.
- **(b)** Keep gate, hide Hosted card entirely.
- **(c)** Drop gate.

**Chose (c)** per Dev quote: *"what about we drop it. and let the user only select this per thread wise ? there will be no workspace level hosted or not hosted"*.

Trade-off accepted: no workspace-level brake on E2B costs (any user can spin a VM per Thread). Acceptable for dev-mode / solo. Future re-add path: add a `workspaces.max_concurrent_vms` quota when billing matters.

### Auto-wake transport: HTTP vs pending_wakes table

- **(a)** HTTP fire-and-forget from `appendEvent` to Worker `/hosted/wake`.
- **(b)** New `pending_wakes` table; Worker polls or `LISTEN`s and pulls. Durable.

**Chose (a)** — dev-mode, single Worker process. Failure mode: Worker down → manual Run Hosted Agent button still works. Documented upgrade path inline.

### Local-disconnected surface: persistent banner vs event-triggered toast

- **(a)** Persistent UI banner derived from `sessions.status='connected'` query.
- **(b)** New `local_agent_unreachable` event kind; UI shows transient toast.

**Chose (a)** — banner reflects current state honestly, survives reload, no new event kind, no backend wake routing for the Local case.

### Compose-screen layout (Variant A vs B vs C)

Three prototypes in `apps/console/prototypes/agent-choice.html`. Chose **Variant A** — inline cards above textarea — per earlier copy iteration with Dev. Lowest cognitive load, choice gates submission.

### Hosted button: keep "Run Hosted Agent" or remove entirely

Auto-wake on every wake-eligible event reduces the Run button's primary use to: VM died after idle-timeout, or initial wake HTTP failed. **Keep the button** as a fallback — it shows iff `vm: null` AND `agent_type='hosted'`.

---

## Uncertainties

1. **Whether the existing event SSE stream already carries `session_connected`/`session_disconnected`.** If yes, `<LocalDisconnectedBanner>` should subscribe rather than poll. To be confirmed by reading `apps/console/hooks/use-thread-events.ts` during implementation. Either way works.
2. **Console→Worker auth for the fire-and-forget call.** The Worker's `/hosted/wake` today validates `req.caller.kind === 'browser'`. Need to confirm whether a service-token path exists or needs adding for a server-originated call. If absent, minimal addition: a shared secret in `WORKER_INTERNAL_TOKEN` env, validated by a new caller kind `'server'`.
3. **`appendEvent` is called from both Console and Worker.** `shouldWake`'s author filter already excludes Agent-originated writes. Loopback safe.
4. **Worker dev port.** Default value for `WORKER_INTERNAL_URL` — likely 3001, to be confirmed.

---

## Layer placement

| Symbol | Layer | File |
|---|---|---|
| `routeWake` helper | Server (business rule) | `packages/server/src/event-log.ts` (same file as `appendEvent` — single small function, no module split warranted) |
| Thread `agent_type` + `workspace_id` lookup | DB queries | `packages/db/src/queries/threads.ts` (existing pattern) or inline in `routeWake` (one query, no reuse — inline acceptable) |
| HTTP fetch to Worker | Server (side effect) | Inline in `routeWake` (one call site; extract a `worker-client.ts` only when a second call site appears) |
| `<RunHostedAgentButton>` | UI | `apps/console/components/thread/run-hosted-agent-button.tsx` |
| `<LocalDisconnectedBanner>` | UI | `apps/console/components/thread/local-disconnected-banner.tsx` |
| `useLocalSessionStatus` hook | UI data | `apps/console/hooks/use-local-session-status.ts` |
| Env var | Config | `apps/console/lib/env.ts` (or existing equivalent) |

---

## Deletion test

| Module / file | If deleted, what happens? | Justifies existence? |
|---|---|---|
| `routeWake` | Auto-wake doesn't fire; user clicks manual button every time. Auto-wake feature lives nowhere else. | Yes. |
| `<RunHostedAgentButton>` | Hosted Threads have no way to show VM state or manually re-wake. | Yes. |
| `<LocalDisconnectedBanner>` | Dev silently writes messages that the disconnected CLI never sees. | Yes. |
| `useLocalSessionStatus` hook | Banner has no data source. | Yes. |
| `worker-client.ts` (proposed earlier) | **N/A — not creating it.** Inlined into `routeWake`. Extract only when second call site appears. | (Skipped per deletion test.) |

---

## Destructive-action acknowledgments

Dev explicit quotes (per CLAUDE.md / AGENTS.md rule 24):

1. **Drop `workspaces.hosted_enabled` column** (irreversible without restore from backup):
   > "what about we drop it. and let the user only select this per thread wise ? there will be no workspace level hosted or not hosted"

2. **Shrink `WAKE_KINDS`** (changes Agent re-spawn behavior for three event kinds):
   > "we should remove comment resolved, comment delted, and comment unresolved from these"

3. **Delete `CreatedCard`** (loses inline post-create connect-command surface):
   > "ok all five" (Q5 explicitly proposed deleting `CreatedCard`).

---

## Out of scope

- VM stop/kill UX. Supervisor idle-timeout handles cleanup; manual stop is a follow-up.
- Per-workspace VM quotas / billing limits. Acceptable solo-dev cost profile; add when multi-tenant.
- Migrating off HTTP fire-and-forget to a durable `pending_wakes` table. Upgrade path documented inline.
- `agent_type` exposure to the Agent's system prompt. Agent behavior is runtime-agnostic.
- A `PATCH /api/threads/:id` route to change `agent_type` post-create. Permanence enforced by absence-of-route.
