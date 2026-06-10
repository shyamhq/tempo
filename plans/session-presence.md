# Session presence: graceful disconnect + heartbeat-based staleness

## Problem

The Console dashboard shows `session_status: 'connected'` indefinitely after the Dev kills the CLI. The only code path that flips a session to `disconnected` today is `createSessionFromToken` in `apps/console/server/sessions.ts:33`, which only fires when a *new* `tempo-agent connect` displaces the old one. None of these paths exist:

- The CLI's `SIGINT`/`SIGTERM`/`beforeExit` handlers (`stream-pump.ts:56`, `pty-terminal.ts:125`) tell the Console anything before exit — they just `rmSync` the configDir and die.
- There is no liveness signal from the Console toward the CLI (no heartbeat, no read-side staleness check).

Net effect: Ctrl-C leaves a permanently-`connected` row; `kill -9`, laptop sleep, network drop, or process crash do the same. The Dev sees a stale dashboard until the next `connect` displaces it.

## Smallest concrete change

Three layers, all in one feature. The whole feature exists because the events long-poll is **already a heartbeat** — server-side bookkeeping turns it into a presence signal at near-zero cost.

### Layer 1 — Graceful disconnect endpoint

- **New route**: `POST /api/sessions/[id]/disconnect` (agent-auth via Bearer token only — Dev cannot disconnect another Dev's CLI by accident).
- **New server function**: `markSessionDisconnected(sessionId: string)` in `apps/console/server/sessions.ts`. Idempotent: if status is already `disconnected`, no-op (no event re-emit). On a real flip: `UPDATE sessions SET status='disconnected', last_seen_at=now WHERE id=?` and `appendEvent(thread_id, { kind: 'session_disconnected' })`.
- **CLI wiring**: in both drivers (`stream-pump.ts` and `pty-terminal.ts`), the `SIGINT`/`SIGTERM`/`beforeExit` handlers call `client.disconnectSession(sessionId)` with a 500ms timeout. Fire-and-forget — exit does not wait on the Console.

### Layer 2 — Long-poll = heartbeat

- The events route (`apps/console/app/api/threads/[id]/events/route.ts`) is the long-poll path the CLI hits continuously. It currently has **no auth**.
- Add `authFromRequest(req)` at the top. If `actor === 'agent'` and `session_id` is non-null, call `touchSessionLastSeen(session_id)` (new function in `server/sessions.ts`) **before** delegating to `longPoll`/`sseStream`. Single `UPDATE sessions SET last_seen_at=now WHERE id=? AND status='connected'`.
- No behavior change for the Dev or for unauthenticated callers — `authFromRequest` returns `null` for them and the heartbeat call is skipped.

### Layer 3 — Lazy stale flip on read

- **New server function**: `reapStaleSessionForThread(threadId: string)` in `server/sessions.ts`. Checks the connected session for the thread; if `last_seen_at < now - STALE_MS`, flips it to `disconnected` and appends `session_disconnected`. Returns the (possibly-just-reaped) outcome.
- Call this at the top of `cancelCurrentSessionForThread` (already in the file) so a Dev hitting Stop on a stale session sees the correct error instead of a futile cancel.
- Call this lazily inside `longPoll` (server module) before it queries events — this is the path the dashboard hits. So a dashboard that comes alive after the CLI dies will see the flip on the next poll cycle.
- `STALE_MS = 90_000` (3× the 25s `POLL_WAIT_SECONDS` in `event-stream.ts`, generous margin for one missed poll + retry backoff).

### Constants and shape

```ts
// apps/console/server/sessions.ts
const STALE_MS = 90_000;
const DISCONNECT_TIMEOUT_MS = 500;  // CLI-side, exported for use by http-client

export async function markSessionDisconnected(sessionId: string): Promise<void>
export async function touchSessionLastSeen(sessionId: string): Promise<void>
export async function reapStaleSessionForThread(threadId: string): Promise<void>
```

No new events (reuses existing `session_disconnected`). No schema change (uses existing `last_seen_at` column). No new contract types.

## Alternatives considered

**A. Dedicated `/heartbeat` endpoint, CLI pings every N seconds.**
- Pro: explicit, no auth added to events route.
- Con: every CLI must learn a new path; one more thing to maintain; the long-poll *is* already a perfect heartbeat. Rejected — deletion test fails (delete the endpoint, complexity reappears as "how do we know the CLI is alive?" which the long-poll already answers).

**B. WebSocket / SSE keepalive.**
- Pro: bidirectional, real-time disconnect detection.
- Con: massive scope vs. the bug. Rejected — not justified.

**C. Active cron in Console process (setInterval scanning for stale rows).**
- Pro: dashboard self-heals without a viewer.
- Con: background task, multi-replica gotcha (two Console instances each fire `session_disconnected`). Rejected for v1 in favor of lazy-on-read — single-process Console is the current reality and lazy is replica-safe. Easy to add later if needed.

**D. CLI-driven `session_disconnected` HTTP call from inside `signal` handlers, no heartbeat.**
- Pro: simplest possible — Layer 1 alone.
- Con: misses the ungraceful cases the user explicitly called out (`kill -9`, crash, sleep). Rejected — solves half the problem.

## Layer assignment

| Symbol | File | Layer (per CLAUDE.md §"Layer placement") |
|---|---|---|
| `markSessionDisconnected` | `apps/console/server/sessions.ts` | business rule (server module) |
| `touchSessionLastSeen` | `apps/console/server/sessions.ts` | business rule |
| `reapStaleSessionForThread` | `apps/console/server/sessions.ts` | business rule |
| `POST /api/sessions/[id]/disconnect` route | `apps/console/app/api/sessions/[id]/disconnect/route.ts` | thin route handler (parse → auth → call server module → respond) |
| Heartbeat call site | `apps/console/app/api/threads/[id]/events/route.ts` | thin route handler (existing) — add auth + fire-and-forget heartbeat |
| Reap call site | `apps/console/server/events-stream.ts` (`longPoll`) and `server/sessions.ts` (`cancelCurrentSessionForThread`) | business rule (server modules) |
| `disconnectSession` HTTP method | `apps/agent/src/http-client.ts` | CLI HTTP client |
| Disconnect-on-exit handlers | `apps/agent/src/stream-pump.ts`, `apps/agent/src/pty-terminal.ts` | CLI driver glue |

No new directories, no new event kinds, no new contract files. All new functions land in existing modules.

## Deletion test

- **`markSessionDisconnected`** — if deleted, the disconnect endpoint and the reaper have no consolidated way to update status + emit event. Complexity reappears as duplicated 5-line blocks at two call sites. Keep.
- **`touchSessionLastSeen`** — if deleted, the heartbeat write is inlined in the events route handler. The route handler is the only caller. **Borderline — could inline.** Decision: keep as a named function so the reaper's threshold and the touch site live next to each other in `sessions.ts`, and so the heartbeat write doesn't pollute the route handler.
- **`reapStaleSessionForThread`** — if deleted, the lazy stale check has nowhere to live. Without it, Layer 3 collapses. Keep.
- **`POST /api/sessions/[id]/disconnect` route** — if deleted, the CLI cannot announce graceful exit. Layer 1 collapses. Keep.
- **`disconnectSession` HTTP method** — if deleted, every CLI exit handler hand-rolls fetch + token + timeout. Keep.

No library adoptions, no new abstractions beyond named functions.

## Uncertainties

- **Auth on the events route.** Today this route is unauthenticated; the dashboard (Dev) and CLI (Agent) both poll it. Adding `authFromRequest` at the top is a behavior expansion. **Verified safe**: `authFromRequest` returns `null` for unauthenticated callers, and the new code path only calls `touchSessionLastSeen` when `auth?.actor === 'agent'`. Existing Dev/CLI traffic continues to flow through the same `longPoll`/`sseStream` branches.
- **The session_id in `authFromRequest`.** `actor.ts:34` shows the auth helper already does a session lookup (`s?.id ?? null`). For an Agent token whose connected session was reaped or displaced, `session_id` is null, and the heartbeat is skipped — correct behavior.
- **Race between `markSessionDisconnected` and an in-flight heartbeat.** If the CLI calls `disconnect` (flips status to `disconnected`) and a concurrent poll's heartbeat lands a half-second later, the heartbeat's `WHERE id=? AND status='connected'` filter skips it. **No resurrection.** Verified by predicate inspection.
- **Reaper-during-poll feedback loop.** When `longPoll` calls the reaper and the reaper appends `session_disconnected`, the very same poll picks it up and forwards to the Dev dashboard. **Intended** — the dashboard learns about the death on the same round-trip that would otherwise have returned empty.
- **PTY mode caveat.** PTY `kill('SIGINT')` exits the child entirely (we already noted this is the open Stop-feature gap). Disconnect-on-exit fires from the *parent's* SIGINT, not from the PTY child's death — so this feature is decoupled from the PTY/Stop divergence. Unaffected.
- **Machine sleep.** Laptop sleeps with the CLI alive. Reaper flips to `disconnected` after 90s. On wake, the CLI's wake-watchdog in `event-stream.ts:29` aborts the in-flight poll and re-polls — that poll now hits a session whose status is `disconnected`. The poll itself still works (it's keyed on thread_id and cursor, not session status), so the CLI keeps receiving events forever against a dead-marked session. **Decision: not in scope for this PR.** Documented as a follow-up — fixing it cleanly requires the events endpoint to return a structured "session ended" signal, which is its own design. The dashboard correctly shows disconnected in the meantime.

## Destructive actions

None. No migrations, no data drops, no force-push, no external messages.

## Implementation order

1. Server module additions (`markSessionDisconnected`, `touchSessionLastSeen`, `reapStaleSessionForThread`).
2. Disconnect route handler.
3. Wire reaper into `cancelCurrentSessionForThread` and `longPoll`.
4. Add auth + heartbeat to events route.
5. Add `disconnectSession` to `http-client.ts`.
6. Wire exit handlers in `stream-pump.ts` and `pty-terminal.ts`.
7. `bun run typecheck && bun run lint`.
8. Run code-simplifier and code-reviewer in parallel; address findings.
9. Hand back for Dev's manual smoke test, then commit on Dev's word.
