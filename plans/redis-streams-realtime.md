# Redis Streams real-time event delivery + ACP package migration

> **Execution constraints (binding — do not drift)**
> - Branch: `worktree-redis-streams-realtime` (isolated worktree). Never touch the Dev's `main` working tree.
> - **No judge approval flow** for this work (Dev override).
> - Run **code-simplifier** + **code-reviewer** before calling any task done.
> - **Verify every library/API against current docs (Context7 / web) before implementing.** No assumptions from training data. If a documented standard shape exists, use it.
> - **Prefer libraries over hand-rolled code.** Elegant, idiomatic, standard shapes — not band-aids. (See CLAUDE.md "Standard code, never band-aids".)
> - Commits: agent does NOT commit without explicit per-change Dev approval. Dev raises the PR.

---

## Verified corrections (docs-checked 2026-06-19) — these OVERRIDE the prose below where they conflict

Dispatched docs/codebase verification before implementing. Findings:

**Codebase reality**
- DB is **Postgres** (CLAUDE.md's "libSQL" is stale).
- `sseStream` + `longPoll` + `emptyCursor` are ONE Worker handler: `apps/worker/src/routes/events/sse.ts`. Long-poll = the `?wait=` branch; SSE = the no-`wait` branch. Removing long-poll = delete that branch, keep SSE. Not two endpoints.
- `readEventsAfter` is still needed by `trails.ts` — KEEP it in `event-log.ts`; only stop using it for live delivery.
- `latestEventId`/cursor is ALREADY returned to clients on load (`apps/worker/src/routes/threads/access.ts:63`, `apps/console/app/api/threads/[id]/route.ts:61`). So cursor plumbing exists — reuse it.
- `appendEvent` has many callers; only its internals change. `shouldWake` lives in `packages/contracts/src/events.ts` (wakes on comment_added, user-authored reply_added, user-authored discussion_message_posted).
- Long-poll contract bits in `packages/contracts/src/http.ts`: `EventsQuery.wait` + `EventsLongPollResponse` become dead after long-poll removal — trim them; keep `EventsQuery.cursor` for SSE start.

**ioredis (v5.11.1, types bundled)**
- Blocking reader MUST be its own connection with **`maxRetriesPerRequest: null`** (else the BLOCK is flushed after 20 retries). Shared connection for XADD/cache.
- Fold trim into the append: `redis.xadd(key, 'MAXLEN', '~', 1000, '*', 'payload', json)` — one round-trip, no separate XTRIM.
- `XREAD` returns `[key, [[id, string[]]][]][] | null` (null on BLOCK timeout). Start from the client's cursor id (catch-up + tail); fall back to `$` only when no cursor. Advance `lastId` each iteration.
- Abort a pending block with `reader.disconnect()`. Add `.on('error', ...)` handlers (ioredis won't crash without one, but errors go silent).

**Vercel AI SDK (`ai@6.0.206`)**
- History type is `ModelMessage[]` (CoreMessage removed in v6 — runner already correct).
- `streamText({ abortSignal })` + `onAbort: ({ steps }) => ...`. `steps` = COMPLETED steps only (in-progress excluded). Rebuild history: `history.push(...steps.flatMap(s => s.response.messages as ModelMessage[]))` inside `onAbort`. `consumeStream()` resolves cleanly on abort; detect via `signal.aborted`. Don't await `result.response`/`result.steps` after abort (rejects if 0 steps).
- SSE consume: use **`eventsource-parser/stream`** (`EventSourceParserStream`) — ALREADY installed, no new dep. `res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())`, iterate `{ event, data, id }`. Manual fetch with `Authorization` header + reconnect-on-disconnect loop.

**ACP migration (DECISION: full migration in this PR)** — NOT a 1:1 swap. `@agentclientprotocol/sdk@0.28.1` redesigned the API in v0.26→0.27:
- `ClientSideConnection` deprecated; constructor changed (factory `(agent)=>Client` + Web-Streams `Stream`). Prefer the new `client()` builder OR adapt to the new ctor.
- `ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>)` — Web streams now; wrap Node stdio with `Readable.toWeb()`/`Writable.toWeb()`.
- `McpServer` export name UNCONFIRMED — verify after install (may move to a schema subpath).
- `cancel()` returns Promise (already awaited). `prompt()` response adds `usage`. Subprocess entry confirmed `@agentclientprotocol/claude-agent-acp/dist/index.js`.
- Follow official `MIGRATION_0.26_0.27.md`.

**Test strategy (DECISION: pure-logic unit tests + manual smoke test)** — ioredis-mock can't simulate `XREAD BLOCK`. So: extract pure logic (wake filtering, SSE frame format, stream-entry parse, abort/history rebuild) and unit-test THAT with `bun:test`. No Testcontainers, no mocked block loop. Verify the block/stream paths by running the full stack manually. Drop the plan's 12-mocked-file ambition. (Cache GET/SET tests use `ioredis-mock` via `mock.module` in server `test/_setup.ts`.)

**CLI transport (DECISION by Dev mid-build: Worker SSE, NOT direct Redis)** — the plan had the local CLI XREAD Redis directly. That would require shipping Redis creds to laptops (a new exchange field), an internet-reachable Redis, and Redis has no per-thread authz (broader than the CLI token). Instead the local CLI tails the SAME authenticated Worker SSE endpoint the hosted runner uses (`GET /api/threads/:id/events`, bearer auth, `ensureThreadAccess` per-thread). Consequences:
- `apps/agent` uses `eventsource-parser` (NOT `ioredis`). `apps/agent/src/events/subscriber.ts` = `runWakeSubscriber` (fetch SSE + EventSourceParserStream + classify via shouldWake / agent_cancel_requested).
- `connect.ts` rewritten: continuous SSE + a wake buffer with cancel-on-wake (`turnInFlight` flag; mid-turn wake → `session.cancel()` → re-prompt with buffered events; between-turn wake → notify the idle loop). Dev Stop (`agent_cancel_requested`) cancels without re-prompt. Token refresh + session restart between turns (on `needsRefresh`/near-expiry; refresh token works post-expiry).
- Presence: long-lived SSE bumps `agent_last_seen_at` only at connect, so idle presence needs a heartbeat. Added `POST /api/threads/:id/heartbeat` (Worker, `bumpAgentLastSeen`, CLI-only) which the CLI pings every 20s; a 401 there triggers token refresh.
- SSE route auth: `rejectAgent` blocked `hosted`. Added `rejectWorkspaceAgent` (rejects only workspace-scoped `agent` + `internal`, allows cli/browser/hosted) on the SSE route so the hosted runner can subscribe. Heartbeat keeps `rejectAgent` (hosted presence ≠ this).

---

## Problem

When the Agent writes to a Thread — posting a message, updating the Plan, replying to a Comment — the Dev doesn't see it for up to 500ms. Every open browser tab continuously queries the database twice per second, even when nobody is doing anything. The lag is noticeable on every interaction, and the architecture doesn't support running multiple Worker containers (in-process notification can't cross container boundaries).

## Outcome

* Events arrive in the Console within single-digit milliseconds of being written. Idle connections generate zero database queries.
* Both agent runtimes (local CLI and hosted E2B runner) receive Dev messages mid-turn via cancel + re-prompt, responding within seconds instead of waiting for a full turn to finish.
* Event delivery works across multiple Worker and Console containers sharing one Postgres and one Redis.

## Success criteria

* A discussion message posted by the Agent appears in the Console in <10ms (p95), down from ~250ms average.
* An idle SSE connection generates zero database queries (down from 2/second).
* Event delivery works across 2+ Worker containers sharing one Postgres and one Redis instance.
* `REDIS_URL` is a required env var — the system does not start without it, same as `DATABASE_URL`.
* A Dev comment posted while the Agent is mid-turn triggers cancel + re-prompt — the agent sees the comment within seconds, not after the full turn completes. Works for both local CLI (ACP `session/cancel`) and hosted runner (AI SDK `abortSignal`).

## Scope

**In scope**

* Replace DB polling with Redis Streams for all three consumer types: browsers (SSE via Worker), local Agent CLI (direct `XREAD BLOCK`), and hosted runner (SSE via Worker from E2B sandbox).
* Add `ioredis` to `packages/server`.
* Swap `cache.ts` from `MemoryCache` to Redis-backed cache (same connection).
* Events table stays for trails (historical view on page load). Not read for real-time delivery.
* Delete `tempo_poll` MCP tool, `longPoll` function, and the Worker HTTP long-poll endpoint. Rewrite Agent CLI connect loop to subscribe to Redis directly.
* Rewrite hosted runner (`runner.ts`) to use Worker SSE instead of 2-second `/drain` polling.

**Out of scope**

* Horizontal scaling infrastructure (Docker Compose, K8s) — this Plan makes multi-container *possible*, it doesn't set it up.

## Approach

One write path, one read path. No cursors, no polling, no catch-up reads. Agents receive Dev messages mid-turn via cancel + re-prompt — local CLI uses ACP `session/cancel`, hosted runner uses Vercel AI SDK `abortSignal`. Both preserve conversation history across the interruption.

**Write path:** every mutation (comment, reply, plan edit, agent activity) inserts into Postgres (source of truth) and `XADD`s to a Redis Stream keyed by threadId. Two writes, always together.

**Read path — browser:** page load fetches full state from DB (GET /api/threads/:id — comments, plan, discussion, trails). Then opens SSE, which runs `XREAD BLOCK` from `$` (latest). Every new event appends to local state by kind. On page refresh or SSE disconnect: refetch full state, resubscribe. That's it.

**Read path — Agent CLI:** on connect, receives full Thread state via HTTP (`GET /api/threads/:id/access`). The connect loop then subscribes to the Redis Stream via `XREAD BLOCK`. Between turns, the loop blocks on XREAD — when an event arrives that matches `shouldWake()` (human-authored comment, reply, or discussion message), it immediately sends a new prompt with `{ thread_id, events }`.

During a turn, the loop listens on XREAD concurrently with the in-flight `session.prompt()`. If a wake event arrives mid-turn, the connect loop calls `session.cancel()` — the current turn ends with `stopReason: 'cancelled'`, conversation history is preserved, and the loop immediately re-prompts with the new events included. The agent loses momentum on the interrupted turn but not knowledge — same `sessionId`, full transcript intact. `agent_cancel_requested` (Dev pressing Stop) also fires `session.cancel()` the same way. `tempo_poll` is deleted.

**Read path — Hosted runner (E2B):** the runner inside the E2B sandbox cannot connect to Redis directly — E2B's domain-based firewall only filters HTTP/TLS (ports 80/443), not raw TCP (Redis port 6379). Instead, the runner opens a persistent SSE connection to the Worker — the same Redis-backed SSE endpoint that browsers use. Turn 1 hydration still comes from `POST /api/hosted/drain`. After that, the runner listens on SSE for wake events, replacing the current 2-second `/drain` polling loop. The Worker acts as a Redis-to-SSE bridge — no Redis credentials in the sandbox, no new firewall rules.

Mid-turn event delivery uses the Vercel AI SDK's native `abortSignal`. The runner passes an `AbortController` signal to `streamText`. When a wake event arrives via SSE during a turn, the runner calls `controller.abort()` — the `onAbort` callback captures completed steps (tool calls, text), pushes them to history, then the runner immediately re-calls `streamText` with the new events. Same cancel + re-prompt pattern as the local CLI, just using the AI SDK's abort instead of ACP's `session/cancel`.

Each consumer (browser SSE stream or Agent CLI) gets a dedicated Redis connection for `XREAD BLOCK`. One shared connection handles `XADD`, `XTRIM`, and cache commands.

Stream maintenance: `XTRIM tempo:t:<threadId> MAXLEN ~ 1000` after each `XADD` to bound memory. The stream is purely a delivery channel — old events live in Postgres and are loaded on page load. The stream only needs enough entries to survive a brief `XREAD` timeout cycle.

**Postgres is the source of truth, Redis is the delivery channel.** On page load or Agent connect, the full state comes from DB. After that, every new event flows through Redis only. If the SSE connection drops, the browser refetches full state from DB and resubscribes — no cursors, no replay.

## Steps

**1. Add `ioredis` dependency.** `bun add ioredis` in `packages/server`. (`@types/ioredis` not needed — ioredis ships its own types.)

**2. Create `packages/server/src/redis.ts`.** Initialized from `REDIS_URL` (required). Fails boot if unset. Exports:
* `redis` — shared connection for `XADD`, `XTRIM`, cache `GET`/`SETEX`.
* `createReader()` — factory that returns a new Redis connection for `XREAD BLOCK`. Each SSE stream gets its own.
* `appendToStream(threadId, event)` — `XADD tempo:t:<threadId> * payload <json>` then `XTRIM ~ 1000`.

**3. Modify `packages/server/src/event-log.ts` — `appendEvent`.** After the DB insert in `appendEvent()`, add `await appendToStream(threadId, event);`. DB insert is source of truth; XADD is delivery. If XADD fails, event is safe in Postgres.

**4. Rewrite `packages/server/src/events-stream.ts` — `sseStream`.** Delete the `while (!closed) { readEventsAfter(); sleep(500); }` loop. Delete `longPoll`. Replace `sseStream` with `XREAD BLOCK 25000 STREAMS tempo:t:<threadId> $` loop; on data push SSE frame; on timeout send heartbeat; on cancel disconnect reader. No cursor, no DB reads.

**5. Delete `tempo_poll` and `longPoll`. Rewrite Agent CLI connect loop.** Delete `longPoll` from events-stream.ts. Delete `tempo_poll` MCP tool (`apps/worker/src/mcp/tools/poll.ts`) + registration. Remove `PollInput`/`PollOutput` from `@tempo/contracts/mcp`. Delete Worker HTTP long-poll endpoint (`/api/threads/:id/events`). Rewrite `apps/agent/src/commands/connect.ts`: replace `pollEvents()` with direct Redis `XREAD BLOCK` subscriber. Run XREAD concurrently with `session.prompt()`; on mid-turn wake → `session.cancel()` then re-prompt. Between turns, block on XREAD. Needs `ioredis` in `apps/agent`.

**6. Swap `packages/server/src/cache.ts`.** Replace `MemoryCache` with `RedisCache` using shared `redis` connection (`GET`/`SETEX`). `export const cache: Cache = new RedisCache(redis)`. Delete `MemoryCache`.

**7. Update env config.** Add `REDIS_URL` to `apps/worker/.env.example` and `apps/console/.env.example`. Required. Boot fails without it.

**8. Rewrite hosted runner event loop.** In `apps/worker/src/hosted/runner.ts`, replace 2-second `/api/hosted/drain` polling with persistent SSE to Worker `/api/threads/:id/events` (Redis-backed). Turn 1 hydration still from `/drain`. Add `abortSignal` to `streamText`; AbortController per turn; SSE listener concurrent; on mid-turn wake → `controller.abort()`, `onAbort({ steps })` extracts completed messages → push to `history` → re-call `streamText` with buffered events.

## ACP package migration (folded into this pass)

Both ACP packages in `apps/agent/package.json` are deprecated on npm. Since step 5 rewrites the connect loop and touches the ACP session layer, upgrade in the same pass.

```
OLD (deprecated)                              NEW (active)
@zed-industries/agent-client-protocol ^0.4.5  →  @agentclientprotocol/sdk ^0.28.1
@zed-industries/claude-code-acp ^0.16.2       →  @agentclientprotocol/claude-agent-acp ^0.48.0
```

Symbols used in `apps/agent/src/acp/session.ts` + `notifications.ts` map 1:1 from `@agentclientprotocol/sdk`: `Client`, `ClientSideConnection`, `ContentBlock`, `McpServer`, `ndJsonStream`, `PROTOCOL_VERSION`, `RequestPermissionRequest`, `RequestPermissionResponse`, `SessionNotification`.

Adapter resolution (`resolveAdapter()` at session.ts:~217): change `@zed-industries/claude-code-acp/dist/index.js` → `@agentclientprotocol/claude-agent-acp/dist/index.js`. **VERIFY entry point after install — may be `dist/lib.js` per its exports map.**

Migration steps: (1) `bun remove` old two; (2) `bun add` new two; (3) update imports in two files; (4) update `resolveAdapter()` path; (5) update build `--external` flags in package.json; (6) `bun run typecheck`.

## Code structure

```
packages/server/src/
├── redis.ts              NEW  — connection, createReader(), appendToStream(), XTRIM
├── event-log.ts          MOD  — appendEvent calls appendToStream after DB insert
├── events-stream.ts      MOD  — sseStream uses XREAD BLOCK via createReader()
├── cache.ts              MOD  — RedisCache replaces MemoryCache
└── index.ts              MOD  — re-export redis.ts public API

apps/agent/src/
├── events/
│   ├── subscriber.ts     NEW  — RedisEventSubscriber: XREAD loop, wake detection
│   └── index.ts          NEW  — barrel
└── commands/connect.ts   MOD  — uses subscriber, cancel+re-prompt orchestration

apps/worker/src/
├── hosted/
│   ├── event-source.ts   NEW  — SSE subscription, wake detection, abort-on-wake
│   └── runner.ts         MOD  — uses event-source, abortSignal per turn
└── mcp/
    ├── tools/poll.ts      DEL
    └── server.ts          MOD  — remove poll registration

packages/contracts/src/mcp.ts   MOD  — remove PollInput/PollOutput
```

## Test plan

`bun:test`, mirror-src structure, idempotent `install*()` mock pattern (see `apps/worker/test/_mocks/tempo-server.ts`). All Redis mocked — no real Redis in CI. **CHECK `ioredis-mock` (or similar) before hand-rolling Redis mocks — prefer a library.** Roughly:

```
packages/server/test/   _setup.ts(REDIS_URL) · _mocks/redis.ts · redis.test.ts · events-stream.test.ts · cache.test.ts
apps/agent/test/        _setup.ts · _mocks/redis.ts · _mocks/acp-session.ts · events/subscriber.test.ts · commands/connect.test.ts
apps/worker/test/       _setup.ts(REDIS_URL) · _mocks/event-source.ts · hosted/event-source.test.ts · hosted/runner.test.ts
```

## Sequencing (single worktree, dependency order)

Original plan describes 4 tasks / 2 waves across separate sessions. Executing here in ONE worktree in dependency order:

- **Wave 1 (independent):**
  - **Task A — Server Redis foundation:** steps 1,2,3,4,6,7 + add redis service to docker-compose.yml + remove PollInput/PollOutput from contracts + REDIS_URL in test/_setup files.
  - **Task A' — ACP migration:** the ACP package migration section (apps/agent package.json + session.ts + notifications.ts only).
- **Wave 2 (depends on Wave 1):**
  - **Task B — Agent CLI rewrite:** step 5 (subscriber + connect.ts rewrite, delete tempo_poll + long-poll endpoint).
  - **Task C — Hosted runner rewrite:** step 8 (event-source + runner.ts, eventsource-parser, abortSignal).

Each task: implement → `bun run typecheck && bun run lint` → relevant `bun test` → code-simplifier + code-reviewer → address findings.

## Stop-and-ask triggers

* New ACP adapter entry point is neither `dist/index.js` nor `dist/lib.js`.
* `ioredis` `XREAD BLOCK` return shape doesn't match expected `[key, [id, fields][]][]`.
* E2B sandbox can't reach Worker SSE endpoint.
* Vercel AI SDK `abortSignal`/`onAbort` API differs from plan — check SDK docs first.

## Risks

* **Redis downtime:** XADD fails but DB insert succeeds — events safe in Postgres; SSE refetches on reconnect.
* **Stream memory:** `XTRIM ~ 1000` per thread bounds memory.
* **Connection count:** one reader per SSE stream / CLI + one shared writer/cache — negligible at current scale.
* **ACP v1 no mid-turn push:** cancel + re-prompt is the supported workaround (history preserved, in-progress turn work discarded).
* **ACP packages deprecated:** migration included; symbol surface 1:1; adapter entry point may differ — verify after install.

## Follow-ups (out of this PR — contract changes)

* **Vestigial event-id cursor fields.** `last_event_id` in `GetThreadResponse` and `latest_event_id` in `ThreadAccessResponse` are now dead: SSE starts from the live tail (`$`), so no consumer reads them as cursors. The Console (`use-thread-events.ts`) still writes `last_event_id` into its cache on every event but nothing reads it; the CLI receives `latest_event_id` from `/access` and ignores it. Removing them is a contract change touching `packages/contracts` + the Console cache write + CLI + tests — left for a follow-up PR to keep this one focused.
