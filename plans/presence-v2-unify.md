# Blueprint — Unified agent presence (Redis + SSE) + drop /drain + cursor cleanup

**Objective:** One presence + hydration interface for BOTH agent styles (local CLI, hosted runner). Presence = a Redis key bound to the agent's SSE connection (truth = TTL, abrupt-safe; propagation = push via the thread stream). Turn-1 hydration unified on `GET /api/threads/:id/access` for both → delete `POST /api/hosted/drain`. Remove dead cursor fields. Drop `threads.agent_last_seen_at`.

**Mode:** direct (one branch `worktree-redis-streams-realtime`, ONE commit at the end — not per-step PRs). gh not authed (PR is the Dev's).

**Design invariants (the-algorithm / ponytail — hold across every step):**
- Truth = Redis key `tempo:presence:<threadId>` with TTL; detection = SSE connection close; propagation = a `presence` stream frame. Never trust a goodbye.
- `PresenceSignal` is SSE-only, NOT a persisted `Event` (never `appendEvent`, never in Postgres/trails).
- `vm_runs` + supervisor + `routeWake`(vm_runs liveness) are UNTOUCHED — sandbox lifecycle / spawn-dedup is a different question than presence (Redis key would double-spawn during provisioning).
- Net-deletion: removing more than we add.

## Dependency graph + parallelism

```
S1 contracts ──> S2 server ──> ┌ S3 worker ┐
                               ├ S4 agent  ├──> S6 db drop+migration ──> S7 verify+commit
                               └ S5 console┘
```
- S1 → S2 serial (foundation). S3, S4, S5 parallel (separate packages, zero shared files) after S2. S6 after S3+S4+S5 (no code may reference the column). S7 last.
- I build S1, S2, S3, S6 (subtle: Redis presence, SSE-route presence, migration). Delegate S4 (agent) + S5 (console) in parallel (mechanical given finalized contracts).

---

## S1 — Contracts (foundation)  [me]
**Files:** `packages/contracts/src/events.ts`, `packages/contracts/src/http.ts`
**Brief:** Add the SSE-only presence frame; remove the now-dead `agent_disconnected` event + cursor fields; reshape presence fields from timestamp → boolean; add catch-up `events` to the access response.
**Tasks:**
- events.ts: delete `AgentDisconnectedEvent` (def + from `Event` union + from `EventKind`). Add `export const PresenceSignal = z.object({ kind: z.literal('presence'), online: z.boolean() })` + type. (NOT in the `Event` union.)
- http.ts: `import { Event } from './events'` (re-add). `ListThreadsResponse` + `GetThreadResponse`: `agent_last_seen_at: IsoTimestamp.nullable()` → `agent_present: z.boolean()`; `GetThreadResponse` drop `last_event_id`. `ThreadAccessResponse`: drop `latest_event_id`, add `events: z.array(Event)`, fix the lying comment. `AgentEventRequest`: remove `AgentDisconnectedEvent` from the union + delete its def.
**Verify:** `bun run --filter @tempo/contracts typecheck`. **Exit:** contracts compile; no `agent_last_seen_at`/`latest_event_id`/`last_event_id`/`agent_disconnected` symbols remain in contracts.

## S2 — Server: Redis presence + truth  [me]
**Files:** `packages/server/src/redis.ts`, `packages/server/src/threads.ts`, `packages/server/src/index.ts`
**Brief:** Redis presence helpers; presence frame publish; reshape list query to read presence; delete the column writers.
**Tasks:**
- redis.ts: `presenceKey(id)`; `setPresent(id)` = `SET key "1" EX 45`; `refreshPresent(id)` = `EXPIRE key 45`; `clearPresent(id)` = `DEL`; `isPresent(id)` = `EXISTS`→bool; `arePresent(ids[])` = `MGET`→`Map<id,bool>`; `publishPresence(id, online)` = `XADD tempo:t:<id> … payload {kind:'presence',online}` (stream-only, MAXLEN-capped like appendToStream). Broaden `parseStreamEvent` return to `Event | PresenceSignal | null`.
- threads.ts: `listThreads` — drop `agent_last_seen_at` from SQL+return; after the query, `arePresent(ids)` → add `agent_present`. DELETE `bumpAgentLastSeen` + `markAgentDisconnected`.
- index.ts: ensure the new redis presence helpers are exported (re-export `./redis` is gone — add named exports or export `./redis` selectively; presence helpers must be importable by worker + console).
**Verify:** `cd packages/server && bun run typecheck && bun test`. **Exit:** server compiles, `bumpAgentLastSeen`/`markAgentDisconnected` gone, presence helpers exported.

## S3 — Worker: SSE-connection presence + hydration unify  [me]
**Files:** `apps/worker/src/routes/events/sse.ts`, `apps/worker/src/routes/threads/access.ts`, `apps/worker/src/index.ts`, `apps/worker/src/auth.ts`, `apps/worker/src/server/auth-lookup.ts`, `apps/worker/src/gateway/resolve.ts`, `apps/worker/src/routes/agent-events/index.ts`, `apps/worker/src/hosted/runner.ts`; DELETE `apps/worker/src/routes/hosted/drain.ts`, `apps/worker/src/routes/threads/heartbeat.ts`.
**Brief:** The agent's SSE connection drives presence; both agents hydrate via /access; delete drain + heartbeat + the column bumps.
**Tasks:**
- sse.ts: for `caller.kind === 'cli' || 'hosted'`: on connect `setPresent` + `publishPresence(true)` + `setInterval(refreshPresent, 15s)`; on `req.on('close')` clear the interval + `clearPresent` + `publishPresence(false)`. Browser callers: unchanged.
- access.ts: allow `hosted` (reject only `agent`/`internal`). Return `{…display, context, events }` where `events = getEventsSinceLastTurn(threadId)`. Drop `latest_event_id` (+ the `latestEventId` import/call).
- runner.ts (hosted): replace `drainFirst()` (POST /drain) with `GET /api/threads/:id/access` using the hosted JWT; turn 1 = `{ events: access.events, context: access.context }`. Remove the `DrainResponse`/`drainFirst` code.
- index.ts: delete the `/hosted/drain` + `/heartbeat` routes + imports. SSE route auth stays `rejectWorkspaceAgent`. `/access` stays `bearerAuth`.
- auth-lookup.ts + gateway/resolve.ts: delete the `bumpAgentLastSeen` calls. agent-events/index.ts: delete the `agent_disconnected`→`markAgentDisconnected` branch. auth.ts: delete `rejectAgent` if now unused.
- DELETE drain.ts + heartbeat.ts.
**Verify:** `cd apps/worker && bun run typecheck && bun test`. **Exit:** worker compiles + tests pass; no drain/heartbeat/bump; sse.ts manages presence for both agent kinds.

## S4 — Agent CLI cleanup  [delegate, parallel with S3/S5]
**Files:** `apps/agent/src/commands/connect.ts`
**Brief:** Presence is now the SSE connection (Worker-managed); delete the heartbeat + goodbye; use access.events for turn 1.
**Tasks:** delete the heartbeat `setInterval` + `postHeartbeat` + `HEARTBEAT_INTERVAL_MS` + the heartbeat-401→needsRefresh path (KEEP the subscriber's `onAuthError`→needsRefresh). Delete `postAgentDisconnected` + its `finally` call. Turn 1 payload `events: []` → `events: access.events`. Keep cancel+re-prompt, token refresh, subscriber.
**Verify:** `cd apps/agent && bun run typecheck && bun test && bun run build`. **Exit:** agent compiles/builds, 8 tests pass, no heartbeat/goodbye.

## S5 — Console: presence display + cursor cleanup  [delegate, parallel with S3/S4]
**Files:** `apps/console/app/api/threads/[id]/route.ts`, `apps/console/hooks/use-thread-events.ts`, `apps/console/components/thread/thread-view.tsx`, `apps/console/app/(app)/page.tsx`
**Brief:** Read presence from Redis (`isPresent`); flip the chip on the `presence` SSE frame; drop the timestamp/window hook + dead cursor writes.
**Tasks:**
- route.ts: `agent_last_seen_at` → `agent_present: await isPresent(threadId)` (import from `@tempo/server`); drop `last_event_id` (+ its query).
- use-thread-events.ts: handle the `presence` frame → set `agent_present` in cache; DELETE the `agent_last_seen_at` cache write + the `agentAlive` allowlist + the `last_event_id` write + the `agent_disconnected` case. ThreadView type `agent_last_seen_at` → `agent_present: boolean`.
- thread-view.tsx: replace `useAgentPresence(timestamp)` with `view.agent_present` (delete the window/5s-tick hook). Keep the ~30s refetch (backstop).
- page.tsx: list uses `t.agent_present` (delete the `agentPresent(timestamp)` window helper).
**Verify:** `cd apps/console && bun run typecheck` + biome on changed files. **Exit:** console compiles + lint-clean; chip driven by `agent_present`.

## S6 — DB: drop the column + migration  [me, after S3/S4/S5]
**Files:** `packages/db/src/schema.ts`, new migration in `packages/db/drizzle/` + `meta/_journal.json`.
**Brief:** Remove `agent_last_seen_at` once no code references it.
**Tasks:** schema.ts: delete the `agent_last_seen_at` column (+ comment). `cd packages/db && bun run db:generate` (drizzle-kit) → produces `0014_*.sql` (`ALTER TABLE threads DROP COLUMN agent_last_seen_at;`) + snapshot + journal entry. **Then fix `_journal.json`**: the new entry's `when` must be `> 1782070000002` (latest is idx 13 @ 1782070000002) — set `1782070000003` (the future-dated-0011 trap). Verify the generated SQL is exactly the DROP COLUMN (no spurious diffs).
**Verify:** `bun run typecheck` (root). **Exit:** column gone from schema; one migration file dropping it; journal `when` > 1782070000002.

## S7 — Integration verify + review + commit  [me]
**Brief:** Whole-workspace green, reviewed (ponytail + the-algorithm), one commit.
**Tasks:** `bun run typecheck` (7/7); `bun test` per package (server/agent/worker); biome on all changed files. Run `code-simplifier:code-simplifier` + `everything-claude-code:code-reviewer` (Sonnet) — **instruct both to apply the `ponytail` + `the-algorithm` skills**. Address findings. `git add -A && git commit` (Co-Authored-By trailer). Do NOT push/PR (Dev's).
**Exit:** typecheck 7/7, all tests pass, lint-clean on changed files, reviewers' findings resolved, committed.

## Rollback
Per step: `git checkout -- <files>` (uncommitted). The migration (S6) is the only destructive piece — it's a separate file; revert = delete the migration file + journal entry + restore the schema column. The Dev runs `db:migrate` only when ready.
