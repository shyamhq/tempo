# Session lifecycle visibility — `initiating` + `failed`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface CLI agent-boot lifecycle in Console so the Dev sees `initiating…` between clicking Connect and `tempo_attach` landing, plus a `failed — <reason>` state when claude crashes / isn't installed / isn't logged in before attach fires.

**Architecture:** Reuse the existing event-log + SSE pipe. CLI POSTs two new lifecycle event kinds (`session_initiating`, `session_failed`) to the existing `/api/agent-events` route, the worker appends them to the event log, the SSE stream pushes them to Console, the Console hook flips `session_status` in the query cache, and `SessionPill` renders the new states. Zero new routes, zero schema changes, zero new infra.

**Tech Stack:** TypeScript, Zod (`@tempo/contracts`), Express handler in `apps/worker`, React + TanStack Query in `apps/console`.

---

## Problem statement

A `tempo-agent connect <thread-id>` invocation does this before any UI signal lands:

1. PKCE token read (~0 ms — local file).
2. Token refresh if within 60 s of expiry (~300 ms — Worker round trip).
3. `GET /api/threads/:id/access` preflight (~200 ms).
4. Spawn `claude` subprocess (~500 ms cold start).
5. Claude reads system prompt, initialises MCP HTTP transport, calls `tempo_attach`. **This is the first signal Console sees** — `apps/worker/src/mcp/tools/attach.ts:78` inserts the `sessions` row with `status='connected'` and `packages/server/src/sessions.ts:55` would emit `session_connected` (Worker side already wired — see `transport.ts` heartbeat work landed in `commits prior to this plan`).

That's a 3–10 s window where Console renders no signal. Worse, if step 4 fails — claude binary missing, `claude` exits with "not logged in", spawn ENOENT — there is no event at all and the Dev sees a perpetually-empty Activity panel.

## Smallest concrete change

Three files do real work; two are mechanical widenings.

- `packages/contracts/src/events.ts` — add two event kinds, extend `EventKind` enum.
- `packages/contracts/src/http.ts` — add the two kinds to `AgentEventRequest`'s discriminated union so the CLI can POST them on the existing route.
- `packages/contracts/src/primitives.ts` — widen `SessionStatus` enum with `'initiating' | 'failed'`.
- `apps/agent/src/lifecycle.ts` (new) — one exported `postLifecycleEvent` helper that wraps `postEvent`'s retry logic so `stream-pump.ts` and `connect.ts` share one network path.
- `apps/agent/src/commands/connect.ts` — POST `session_initiating` immediately after preflight succeeds, before `spawn`. On spawn failure or non-zero exit *before* the first activity event has been pumped, POST `session_failed` with a `reason` string.
- `apps/console/hooks/use-thread-events.ts` — two extra `case` branches in the SSE reducer.
- `apps/console/components/thread/pills.tsx` — two extra render states (`initiating` = pulsing accent dot, `failed` = red dot with tooltip on `failed_reason`).
- `apps/console/lib/api-client.ts` (or wherever the `LiveThreadView` shape lives) — add an optional `session_failed_reason: string | null` field stashed alongside `session_status`.

No DB migration. No new route. No new Drizzle column. The existing `events` table already accepts arbitrary JSON payloads — the kind enum lives only in the Zod contract.

## Alternatives considered

**A. Row-driven preflight (rejected).**
CLI POSTs a new `/api/sessions/initiate` route that inserts a `sessions` row with `status='pending'` before spawn. Attach later flips the same row to `connected`. Rejected because: (1) the `mcp_session_id` is unknown at preflight (the SDK assigns it on first MCP request), so the row would have a null `mcp_session_id` until attach, which conflicts with the partial unique index on `mcp_session_id WHERE NOT NULL` only after attach migrates the row; (2) the unique-connected-per-thread index complicates the pending→connected transition; (3) we'd be modelling state as rows when the rest of the lifecycle is modelled as events.

**B. Pure client-side ephemeral (rejected).**
Console tracks "Dev clicked Connect" locally and shows `initiating…` for 30 s. Rejected because: (1) a second viewer of the same thread sees nothing; (2) no path to surface CLI-side errors; (3) the dead-zone is real on the agent side, so we want a real signal, not a local stub.

**C. Event-log driven (chosen).**
Two new event kinds; CLI emits them on the existing route; SSE delivers; Console renders. Fits the pattern, no new infra, no schema change. Multi-viewer-correct.

## Uncertainties

1. **Reason classification.** The CLI can detect a few cases cleanly (`ENOENT` → `'claude not installed'`, exit code 0 with no `agent_*` events → `'claude exited before attach'`), but distinguishing "not logged in" from "model unavailable" from "Claude SDK crashed" requires parsing claude's stderr. For MVP I will capture exit code + first 200 chars of stderr verbatim and call that the `reason`. Categorisation can come later if patterns emerge.
2. **Initiating timeout.** If the CLI POSTs `session_initiating` but the process is `kill -9`'d before `session_failed` fires, Console will show `initiating…` forever. Option: client-side, auto-clear `initiating` to `disconnected` after 30 s with no follow-up event. I will include this in the plan as it's two lines and dodges a real footgun.
3. **Ordering vs `session_connected`.** `tempo_attach` (which triggers `session_connected`) runs inside claude after some boot time. Initiating → connected is the happy path. Events are server-ordered by id; Console applies in order; last writer wins. No race.
4. **Existing dead `failed_reason` field.** Console doesn't currently track any reason for a non-connected state. Adding an optional field to `LiveThreadView` is harmless — TanStack Query merges patches and Zod schemas use `.optional()` for new fields by convention here. **Verify in implementation:** the existing `LiveThreadView` Zod schema accepts `session_failed_reason` without breaking older event log entries that don't carry it.

## Layer placement (CLAUDE.md rule 19)

| New surface | Layer | Justification |
|---|---|---|
| Event kinds in `events.ts` | Contracts | All wire shapes live in `@tempo/contracts`; no exceptions. |
| `AgentEventRequest` widening in `http.ts` | Contracts | Same. |
| `SessionStatus` widening in `primitives.ts` | Contracts | The status enum already lives here; widening the same enum, not forking. |
| `postLifecycleEvent` helper | Agent CLI utility | A pure POST helper with the existing retry policy — belongs next to `stream-pump.ts`'s retry shape, not in a server module. |
| CLI POST call sites | `apps/agent/src/commands/connect.ts` | The lifecycle decisions live where the CLI orchestrates the subprocess. |
| Worker route | **No change.** Existing `/api/agent-events` route accepts the discriminated union; widening the union flows through. |
| SSE reducer cases | `apps/console/hooks/use-thread-events.ts` | The reducer is the single mapping from event kinds to view state. |
| UI states | `apps/console/components/thread/pills.tsx` | Same component, two new render branches. |

## Deletion test (CLAUDE.md "no premature seams")

| New element | If deleted in 6 months, where does the complexity reappear? |
|---|---|
| `session_initiating` event | Console renders nothing during agent boot; Devs ping support about "Connect button does nothing." Genuine signal — not pass-through. |
| `session_failed` event | A failed claude spawn is invisible. Dev waits indefinitely; no recovery hint. Genuine signal. |
| `postLifecycleEvent` helper | Two duplicated inline `fetch` + retry blocks in `connect.ts` (one before spawn, one in the error handler). Helper saves real duplication — pass. |
| `'initiating'` / `'failed'` UI branches | The pill would still render with `effective='disconnected'` as today's fallback for unknown states. Not strictly load-bearing — the new events without new branches would render as the muted disconnected state. Branches earn their existence by giving the Dev distinct UX (spinner vs error). |

## Judge gate

This plan **must** be reviewed by the judge agent before implementation (CLAUDE.md "When to use the judge agent" — new event kinds change a Zod contract in `packages/contracts/**` and the wire shape the Agent/Console exchange).

Send this plan to the `judge` agent (`subagent_type: 'judge'`, `model: 'opus'`) and wait for `APPROVED` before starting Task 1. If `CHANGES REQUESTED`, revise this document inline and re-invoke; if `REJECTED`, rethink and rewrite.

---

# File map

| File | Action | Responsibility |
|---|---|---|
| `packages/contracts/src/events.ts` | Modify | Add 2 event kinds; extend `EventKind` enum. |
| `packages/contracts/src/http.ts` | Modify | Extend `AgentEventRequest` discriminated union with the 2 new event shapes; add `session_failed_reason` field to `GetThreadResponse`. |
| `packages/contracts/src/primitives.ts` | Modify | Widen `SessionStatus` enum to `['pending', 'initiating', 'connected', 'disconnected', 'failed']`. |
| `apps/agent/src/lifecycle.ts` | Create | One exported `postLifecycleEvent(workerUrl, token, threadId, event)` wrapping the existing 3× retry loop. |
| `apps/agent/src/stream-pump.ts` | Modify | Use `postLifecycleEvent` instead of inline `postEvent` so the retry logic lives in one place. |
| `apps/agent/src/commands/connect.ts` | Modify | POST `session_initiating` after preflight; POST `session_failed` on `child.on('error')` and on non-zero exit when no agent event has fired. |
| `apps/console/hooks/use-thread-events.ts` | Modify | Two new SSE reducer cases. |
| `apps/console/components/thread/pills.tsx` | Modify | Render `initiating` (pulsing accent dot) and `failed` (red dot + tooltip on reason). |
| `apps/console/components/thread/thread-view.tsx` | Modify | Pass `failedReason={view.session_failed_reason ?? null}` to `SessionPill`. |

---

# Tasks

Per CLAUDE.md, **do not commit without explicit Dev approval per change** — each task ends with "stage + prepare commit message + await Dev OK" rather than running `git commit`.

---

## Task 1 — Contracts: add the two event kinds

**Files:**
- Modify: `packages/contracts/src/events.ts`
- Modify: `packages/contracts/src/primitives.ts`
- Modify: `packages/contracts/src/http.ts`

- [ ] **Step 1.1 — Add the two event shapes to `packages/contracts/src/events.ts`** alongside the existing `session_connected` / `session_disconnected` schemas (around line 88):

```ts
z.object({
  kind: z.literal('session_initiating'),
}),
z.object({
  kind: z.literal('session_failed'),
  reason: z.string().max(200),
}),
```

- [ ] **Step 1.2 — Extend the `EventKind` enum (around line 133):**

```ts
export const EventKind = z.enum([
  // ...existing kinds...
  'session_connected',
  'session_disconnected',
  'session_initiating',
  'session_failed',
  // ...remaining kinds...
]);
```

- [ ] **Step 1.3 — Widen `SessionStatus` in `packages/contracts/src/primitives.ts:31`:**

```ts
export const SessionStatus = z.enum(['pending', 'initiating', 'connected', 'disconnected', 'failed']);
export type SessionStatus = z.infer<typeof SessionStatus>;
```

- [ ] **Step 1.4 — Add `session_failed_reason` to `GetThreadResponse` in `packages/contracts/src/http.ts:89`** so the SSE reducer can stash the reason on the same view object the initial `GET /api/threads/:id` populates. Place next to `session_status`:

```ts
session_status: SessionStatus,
session_failed_reason: z.string().nullable().optional(),
```

The Console route handler for `GET /api/threads/:id` does not need to populate this field — it stays `undefined` until the SSE reducer writes it.

- [ ] **Step 1.5 — Add the lifecycle event shapes to `AgentEventRequest` in `packages/contracts/src/http.ts` (around line 360):**

```ts
export const AgentSessionInitiatingEvent = z.object({
  kind: z.literal('session_initiating'),
});

export const AgentSessionFailedEvent = z.object({
  kind: z.literal('session_failed'),
  reason: z.string().max(200),
});

export const AgentEventRequest = z.object({
  thread_id: ThreadId,
  event: z.discriminatedUnion('kind', [
    AgentToolUseEvent,
    AgentNarrationEvent,
    AgentTodosUpdatedEvent,
    AgentTurnEndedEvent,
    AgentSessionInitiatingEvent,
    AgentSessionFailedEvent,
  ]),
});
```

- [ ] **Step 1.6 — Verify the package typechecks:**

```bash
bun run --filter @tempo/contracts typecheck
```

Expected: clean.

- [ ] **Step 1.7 — Stage and prepare a commit message; await Dev OK:**

```
feat(contracts): session_initiating + session_failed event kinds

Two new lifecycle events let the CLI announce its progress between
`tempo-agent connect` start and the first `tempo_attach`. Widens
SessionStatus to carry the same states.
```

---

## Task 2 — Agent: extract lifecycle POST helper

**Files:**
- Create: `apps/agent/src/lifecycle.ts`
- Modify: `apps/agent/src/stream-pump.ts`

- [ ] **Step 2.1 — Create `apps/agent/src/lifecycle.ts` with the shared retry-aware POST:**

```ts
import type { AgentEventRequest } from '@tempo/contracts/http';
import type { ThreadId } from '@tempo/contracts';
import { logger } from './logger';

const RETRY_DELAYS_MS = [250, 500, 1000] as const;

export async function postLifecycleEvent(args: {
  workerUrl: string;
  token: string;
  threadId: ThreadId;
  event: AgentEventRequest['event'];
}): Promise<void> {
  const { workerUrl, token, threadId, event } = args;
  const body: AgentEventRequest = { thread_id: threadId, event };
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${workerUrl}/api/agent-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok || res.status < 500) {
        logger.debug({ kind: event.kind, status: res.status }, 'event');
        return;
      }
      logger.debug({ status: res.status, attempt }, 'lifecycle: server error, retrying');
    } catch (err) {
      logger.debug({ err, attempt }, 'lifecycle: network error, retrying');
    }
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by loop guard
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
    }
  }
  logger.warn({ kind: event.kind }, 'lifecycle: dropped after retries');
}
```

- [ ] **Step 2.2 — Refactor `apps/agent/src/stream-pump.ts` to import and use `postLifecycleEvent`** for its existing 4 event sites (replacing the local `postEvent` function). Net diff: delete the local `postEvent` + retry loop + `delay` helper (lines ~139–182), keep `handleMessage` calling `postLifecycleEvent(...)` with the same payloads. Keep the `RETRY_DELAYS_MS` constant only inside `lifecycle.ts`.

```ts
import { postLifecycleEvent } from './lifecycle';
// ...inside handleMessage:
void postLifecycleEvent({
  workerUrl,
  token,
  threadId,
  event: { kind: 'agent_narration', text: block.text.slice(0, 8000) },
});
```

- [ ] **Step 2.3 — Verify typecheck + lint pass:**

```bash
bun run --filter @gmeher/tempo-agent typecheck
bun run --filter @gmeher/tempo-agent lint
```

Expected: clean. (Worker won't have changed — no need to lint.)

- [ ] **Step 2.4 — Stage and prepare commit; await Dev OK:**

```
refactor(agent): extract retry-aware lifecycle POST helper

stream-pump's POST loop moves into apps/agent/src/lifecycle.ts so
connect.ts can reuse the same retry policy for session_initiating /
session_failed without duplicating the loop.
```

---

## Task 3 — Agent: emit `session_initiating`

**Files:**
- Modify: `apps/agent/src/commands/connect.ts`

- [ ] **Step 3.1 — Import the helper at the top of `connect.ts`:**

```ts
import { postLifecycleEvent } from '../lifecycle';
```

- [ ] **Step 3.2 — After the preflight access check succeeds (just before "4. Write ephemeral MCP config" — around line 89, after `process.stdout.write('Connecting to ...\\n')`), POST `session_initiating`:**

```ts
await postLifecycleEvent({
  workerUrl,
  token,
  threadId: threadId as ThreadId,
  event: { kind: 'session_initiating' },
});
```

Add the import for `ThreadId`:

```ts
import type { ThreadId } from '@tempo/contracts';
```

- [ ] **Step 3.3 — Verify typecheck:**

```bash
bun run --filter @gmeher/tempo-agent typecheck
```

Expected: clean.

- [ ] **Step 3.4 — Stage and prepare commit; await Dev OK:**

```
feat(agent): emit session_initiating after preflight

Closes the dead zone between `tempo-agent connect` start and the first
tempo_attach. Console SSE picks up the event and renders an
"Initiating…" pill until session_connected lands.
```

---

## Task 4 — Agent: emit `session_failed` on early failure

**Files:**
- Modify: `apps/agent/src/commands/connect.ts`

Two failure paths to cover:

1. `child.on('error', ...)` — `spawn` itself failed (claude binary missing → `ENOENT`, permission denied, etc.).
2. Non-zero `exit` code from `claude` at any point in the session lifetime.

The heuristic is intentionally coarse: **any non-zero exit fires `session_failed`**. This means a crash *after* `session_connected` already landed (e.g. mid-second-turn crash) also fires `session_failed` — the Console reducer is last-writer-wins, so the status flips to `failed` and that's correct. We accept the rare "happy boot, sad mid-session" framing as the right MVP UX; categorising boot-failure vs. runtime-failure is a Slice 2 concern.

- [ ] **Step 4.1 — Replace the existing `child.on('exit', ...)` block (around `connect.ts:159`) with:**

```ts
const exitCode = await new Promise<number>((resolve) => {
  child.on('exit', (code) => {
    resolve(code ?? 1);
  });
  child.on('error', (err) => {
    const reason = `claude failed to spawn: ${err.message}`.slice(0, 200);
    void postLifecycleEvent({
      workerUrl,
      token,
      threadId: threadId as ThreadId,
      event: { kind: 'session_failed', reason },
    });
    process.stderr.write(
      `tempo connect: failed to spawn claude — ${err.message}\n` +
        `Make sure claude is installed: https://docs.anthropic.com/en/docs/claude-code\n`,
    );
    resolve(1);
  });
});

if (exitCode !== 0) {
  const reason = `claude exited with code ${exitCode}`.slice(0, 200);
  await postLifecycleEvent({
    workerUrl,
    token,
    threadId: threadId as ThreadId,
    event: { kind: 'session_failed', reason },
  });
}
```

- [ ] **Step 4.2 — Verify typecheck:**

```bash
bun run --filter @gmeher/tempo-agent typecheck
```

Expected: clean.

- [ ] **Step 4.3 — Manually smoke-test the failure path** (no automated test — MVP rule T12 in CLAUDE.md):

```bash
# In one terminal: bun run --filter @tempo/worker dev
# In another: PATH=/dev/null bun run --filter @gmeher/tempo-agent dev connect <thread-id>
```

Expected: CLI prints "failed to spawn claude — ..."; Worker logs show a `session_failed` event appended; Console SSE delivers it.

- [ ] **Step 4.4 — Stage and prepare commit; await Dev OK:**

```
feat(agent): emit session_failed on spawn error or non-zero exit

When claude isn't installed or exits with a non-zero status, the CLI
now POSTs session_failed with a short reason. Console can render an
error state instead of leaving the Dev staring at "Initiating…".
```

---

## Task 5 — Console: handle the two events in the SSE reducer

**Files:**
- Modify: `apps/console/hooks/use-thread-events.ts`

The `session_failed_reason` schema field was added to `GetThreadResponse` in Task 1.4, so the field flows into the Console query cache as `undefined` until the SSE reducer writes it. No console-side schema change needed.

- [ ] **Step 5.1 — Add two cases to the reducer in `apps/console/hooks/use-thread-events.ts:225`** (alongside `session_connected` / `session_disconnected`):

```ts
case 'session_initiating':
  return { ...next, session_status: 'initiating', session_failed_reason: null };
case 'session_failed':
  return { ...next, session_status: 'failed', session_failed_reason: ev.reason };
```

- [ ] **Step 5.2 — Verify console typecheck:**

```bash
bun run --filter @tempo/console typecheck
```

Expected: clean (`SessionStatus` was widened in Task 1, so the new literals are accepted).

- [ ] **Step 5.3 — Stage and prepare commit; await Dev OK:**

```
feat(console): handle session_initiating + session_failed in SSE

Two new reducer branches mirror the new lifecycle event kinds and
stash session_failed_reason on the LiveThreadView so the pill can
render the error tooltip.
```

---

## Task 6 — Console: render `initiating` + `failed` in `SessionPill`

**Files:**
- Modify: `apps/console/components/thread/pills.tsx`

- [ ] **Step 6.1 — Widen `SessionPill` props to accept the optional reason:**

```ts
export function SessionPill({
  status,
  agentPresent,
  failedReason,
}: {
  status: SessionStatus;
  agentPresent: boolean | null;
  failedReason?: string | null;
}) {
```

- [ ] **Step 6.2 — Extend the `effective`/`tone`/`dot` derivation to cover the new states:**

```ts
const effective: SessionStatus =
  status === 'connected' && agentPresent === false ? 'disconnected' : status;

const tone =
  effective === 'connected'
    ? 'success'
    : effective === 'pending' || effective === 'initiating'
      ? 'accent'
      : effective === 'failed'
        ? 'danger'
        : 'muted';

const dot =
  effective === 'connected'
    ? 'bg-success'
    : effective === 'pending' || effective === 'initiating'
      ? 'bg-accent animate-pulse'
      : effective === 'failed'
        ? 'bg-danger'
        : 'bg-ink-tertiary';
```

Verify `tone="danger"` exists on the shared `Badge` component (check `apps/console/components/ui/badge.tsx`); if not, fall back to `tone="muted"` and rely on the dot colour. **Do not add a new tone variant in this PR** — that's UI-token work outside scope.

- [ ] **Step 6.3 — Render the reason as a tooltip when `failed`:**

```tsx
return (
  <Badge tone={tone} title={effective === 'failed' ? (failedReason ?? 'Unknown error') : undefined}>
    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    Session {effective}
  </Badge>
);
```

- [ ] **Step 6.4 — Update the `SessionPill` call site in `apps/console/components/thread/thread-view.tsx:289` to pass the reason:**

```tsx
<SessionPill
  status={view.session_status}
  agentPresent={agentPresent}
  failedReason={view.session_failed_reason ?? null}
/>
```

- [ ] **Step 6.5 — Verify console typecheck + lint:**

```bash
bun run --filter @tempo/console typecheck
```

Expected: clean.

- [ ] **Step 6.6 — Stage and prepare commit; await Dev OK:**

```
feat(console): render initiating + failed in SessionPill

initiating shows a pulsing accent dot; failed shows a red dot with
the CLI's reason in the tooltip.
```

---

## Task 7 — Console (optional, low-risk): client-side `initiating` timeout

**Files:**
- Modify: `apps/console/hooks/use-thread-events.ts`

If the CLI is `kill -9`'d after posting `session_initiating` but before posting `session_failed`, Console will be stuck on the pulsing dot. Add a 30 s self-clearing timer.

- [ ] **Step 7.1 — When the reducer transitions to `'initiating'`, set a timeout that flips to `'disconnected'` if no subsequent event arrives.** Implementation outline (place inside the same `setQueryData` block, or as a `useEffect` watching `session_status`):

```ts
// In the same hook, after the reducer body:
useEffect(() => {
  const view = qc.getQueryData<LiveThreadView>(threadKey);
  if (view?.session_status !== 'initiating') return;
  const t = setTimeout(() => {
    qc.setQueryData<LiveThreadView>(threadKey, (prev) =>
      prev?.session_status === 'initiating' ? { ...prev, session_status: 'disconnected' } : prev,
    );
  }, 30_000);
  return () => clearTimeout(t);
}, [/* effect deps: include the relevant signal */]);
```

- [ ] **Step 7.2 — Verify typecheck:**

```bash
bun run --filter @tempo/console typecheck
```

- [ ] **Step 7.3 — Stage and prepare commit; await Dev OK:**

```
feat(console): auto-clear initiating after 30s of silence

Catches the kill -9 path where the CLI posted session_initiating but
never landed session_failed.
```

This task is optional — skip if the Dev wants to see real-world initiating durations before adding the timer.

---

## Task 8 — End-to-end manual verification

No automated tests in MVP (CLAUDE.md). Run the three happy/sad paths by hand.

- [ ] **Step 8.1 — Happy path:**
  1. `bun run dev` (Worker + Console).
  2. Sign in to Console; open a Thread.
  3. In a terminal: `bun run --filter @gmeher/tempo-agent dev connect <thread-id> --verbose`.
  4. Console pill should flip: `pending` → `initiating` (within 1 s of CLI start) → `connected` (when `tempo_attach` lands).
  5. Quit claude with Ctrl-C → pill flips back to `disconnected` (Worker's `transport.onclose` → `markSessionDisconnected` from prior session-lifecycle work).

- [ ] **Step 8.2 — Sad path A: claude not installed:**
  1. `PATH=/dev/null bun run --filter @gmeher/tempo-agent dev connect <thread-id>`.
  2. CLI prints "failed to spawn claude".
  3. Console pill flips: `pending` → `initiating` → `failed` with tooltip `claude failed to spawn: spawn claude ENOENT`.

- [ ] **Step 8.3 — Sad path B: claude exits non-zero:**
  1. Run with a deliberately-broken `--model` arg to force claude to fail boot quickly.
  2. Console pill flips: `pending` → `initiating` → `failed` with tooltip `claude exited with code N`.

- [ ] **Step 8.4 — Mandatory review pair (CLAUDE.md rules 21–22):** before final commit, run `code-simplifier:code-simplifier` (Sonnet) and `everything-claude-code:code-reviewer` (Sonnet) on the working tree in parallel, address findings.

- [ ] **Step 8.5 — If everything green, await Dev OK on the final stack of commits.**

---

# Out of scope (explicitly)

- New tone variants on the `Badge` component (no design-token edits in this PR).
- Categorising claude exit reasons beyond the raw exit-code-or-stderr-prefix string.
- A reaper that flips stale `connected` rows after a deadline — Slice 2 redesigns this entirely.
- Server-side validation that the CLI POSTs `session_initiating` before `session_failed` (the event log is append-only; ordering is the renderer's problem).
- Slice 2's Mailbox/Hosted Agent lifecycle — that's a separate plan; the work here is bridging the dead zone in today's local CLI flow.

# Estimate

~80 LOC across 5 files (excluding the optional Task 7 timer). Total time including review pair and manual testing: ~60 minutes for a developer with this plan in hand.
