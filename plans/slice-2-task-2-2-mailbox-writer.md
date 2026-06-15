# Task 2.2 — Mailbox writer + routing decision (Slice 2) — v2

(Revised after judge CHANGES REQUESTED on v1: Console-side `appendEvent`
sites need coverage; failure semantics contradiction; wrong import path.)

## Problem

Schema is in place (Task 2.1). Worker needs to write `mailbox_events` rows
whenever a Dev-originated wake event lands and the Thread has no fresh
Local Session.

The slice-2 plan calls for `enqueueIfHostedRoute(threadId, eventRow)` wired
into "every Dev event ingestion site". A literal reading means editing
every Worker route + Console route that calls `appendEvent` (10+ call
sites). The chokepoint is `appendEvent` itself.

## Two-process reality

`appendEvent` is called from **two processes**:
- **Worker** (`apps/worker`) — most call sites: comments, replies,
  discussion, plan edits, attach, sessions.
- **Console** (`apps/console`) — `approve` and `reopen` routes both emit
  `status_changed` (a wake-kind event), and `threads.renameThread` emits
  `thread_renamed` (not a wake-kind, but it still goes through
  `appendEvent`).

`@tempo/server` is a workspace package, so each Node process gets its own
module instance — a hook registered in Worker boot is invisible to
Console's `appendEvent` calls. If we only register in Worker, Dev
approve/reopen against a Hosted-enabled Thread with no Local CLI **silently
fails to wake the Hosted Agent** — a real regression.

The fix: both processes register the hook at boot. The Worker hook can
read `isFresh` (its in-process presence Map); Console's cannot. Console
over-enqueues slightly (it can't tell if a Local CLI is connected); the
supervisor (Task 2.7) does the final `isFresh` disambiguation before
actually provisioning a VM.

## The change

### 1. `setAfterAppendHook` slot in `event-log.ts`

```ts
// packages/server/src/event-log.ts
type AfterAppendHook = (threadId: string, event: Event) => Promise<void>;
let afterAppend: AfterAppendHook | null = null;
export function setAfterAppendHook(h: AfterAppendHook | null): void {
  afterAppend = h;
}
// inside appendEvent, after the INSERT:
if (afterAppend) {
  try { await afterAppend(threadId, event); }
  catch (err) { logger.error({ err, threadId, kind: event.kind }, 'after-append hook failed'); }
}
```

Swallow + log. The polling fallback in Task 2.3 (5s) is the safety net
for a missed NOTIFY. Failing the caller's `appendEvent` because Mailbox
couldn't write a row is the wrong blast radius — the event already
landed, the user shouldn't see a 500.

### 2. Shared Mailbox writer in `@tempo/server`

New file: `packages/server/src/mailbox.ts`.

```ts
import type { Event } from '@tempo/contracts';
import { shouldWake } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { mailbox_events, threads, workspaces } from '@tempo/db/schema';
import { eq, sql } from 'drizzle-orm';
import { newMailboxEventId } from './ids';

// Writes a mailbox row for a Hosted-enabled Thread; emits pg_notify.
// Idempotent — repeated calls for the same (thread_id, event_id) no-op.
// Does NOT check presence — that's the caller's job (Worker checks
// isFresh inline; Console always over-enqueues and lets the supervisor
// disambiguate before provisioning).
export async function enqueueMailboxIfHosted(
  threadId: string,
  event: Event,
): Promise<void> {
  if (!shouldWake(event)) return;
  const ws = await db
    .select({ enabled: workspaces.hosted_enabled })
    .from(workspaces)
    .innerJoin(threads, eq(threads.workspace_id, workspaces.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!ws[0]?.enabled) return;

  await db
    .insert(mailbox_events)
    .values({ id: newMailboxEventId(), thread_id: threadId, event_id: event.id })
    .onConflictDoNothing();
  await db.execute(sql`SELECT pg_notify('mailbox', ${threadId})`);
}
```

Re-exported from `packages/server/src/index.ts` so both Console and
Worker boot can import it.

### 3. Worker-side presence guard

New file: `apps/worker/src/server/mailbox-hook.ts`.

```ts
import type { Event } from '@tempo/contracts';
import { enqueueMailboxIfHosted } from '@tempo/server';
import { isFresh } from './presence';

export async function workerAfterAppend(threadId: string, event: Event): Promise<void> {
  if (isFresh(threadId)) return;     // Local CLI handles it; no Mailbox row
  await enqueueMailboxIfHosted(threadId, event);
}
```

`apps/worker/src/index.ts` at boot:

```ts
import { setAfterAppendHook } from '@tempo/server';
import { workerAfterAppend } from './server/mailbox-hook';
setAfterAppendHook(workerAfterAppend);
```

### 4. Console-side hook registration

`apps/console` has no presence Map (in-process Worker concept), so it
calls the shared writer directly. Forward-link: Task 2.7's supervisor
re-checks `isFresh` before actually provisioning a VM, so any
Console-emitted Mailbox row against a Locally-attached Thread is a
cheap idempotent waste, not a wrong wake-up.

Where: the most natural boot site is `apps/console/instrumentation.ts`
(Next.js's standard register-once hook). If it doesn't exist yet,
create it.

```ts
// apps/console/instrumentation.ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { setAfterAppendHook, enqueueMailboxIfHosted } = await import('@tempo/server');
  setAfterAppendHook(enqueueMailboxIfHosted);
}
```

(Dynamic import so Edge runtime bundles don't pull in the DB client.)

### 5. Move `shouldWake` to shared contracts

Currently in `apps/agent/src/event-watcher.ts`. Pure predicate over
`Event`; two consumers now (CLI watcher + Mailbox writer).

Move to `packages/contracts/src/events.ts`:

```ts
export const WAKE_KINDS: ReadonlySet<EventKind> = new Set([...]);
export function shouldWake(event: Event): boolean { ... }
```

Already re-exported via `packages/contracts/src/index.ts` (`export *
from './events';`). The CLI's `event-watcher.ts` replaces its local
copy with the shared import — zero behavior change.

## Filter ordering at the call sites

- **Worker** (`workerAfterAppend`): `isFresh` first (in-memory, instant),
  then `shouldWake` (inside `enqueueMailboxIfHosted`, pure), then
  workspace lookup (one query).
- **Console** (`enqueueMailboxIfHosted` direct): `shouldWake` first, then
  workspace lookup. Most Console-emitted events (`thread_renamed`) are
  filtered by `shouldWake` with no DB hit.

## Deliberate simplifications (deletion test applied)

- **Single mutable hook slot, no `EventEmitter`.** One pointer; one
  consumer per process. Adding pub/sub is the "one adapter is
  hypothetical" trap. *Skipped: pub-sub; add when there are two
  independent post-append consumers per process.*
- **No retry queue.** `pg_notify` either delivers or it doesn't; the
  consumer's 5s polling fallback (Task 2.3) is the safety net.
  *Skipped: retry; the fallback IS the safety net.*
- **No `hosted_enabled` cache.** Per-event DB lookup. *Skipped: add when
  pg_stat_statements shows it.*
- **Console can't read Worker's presence; it over-enqueues.** Resolved
  in Task 2.7's supervisor with a second `isFresh` check. Splitting that
  responsibility is the right place for it — the supervisor is the
  decision point about whether to spend money on a VM.

## Alternatives considered

1. **Wire `enqueueMailboxIfHosted` into each Worker + Console route
   manually.** ~10 call sites. Future events become a manual checklist.
   Rejected.
2. **Move Console's `approve`/`reopen` routes into Worker.** Cleaner
   long-term — they'd flow through Worker's hook automatically. Real
   refactor (Clerk admin SDK use, browser session-cookie auth path) that
   doesn't belong in Task 2.2. File under "Spotted but not fixed" for a
   later slice.
3. **Have Console call a Worker HTTP endpoint to enqueue.** Extra
   network hop and a new internal route surface. The hook pattern
   above gets the same correctness without either.
4. **Put `shouldWake` in `@tempo/server` instead of `@tempo/contracts`.**
   The Agent CLI (`apps/agent`) doesn't depend on `@tempo/server` today;
   `@tempo/contracts` is the shared boundary. Pick contracts.

## Uncertainties

- **Console boot ordering.** `instrumentation.ts` runs once per Next.js
  server instance. In dev hot-reload scenarios it may re-run; setting
  the hook twice is harmless (it's an assignment, not an append).
- **Console workspace lookup pre-checks the DB.** Approve/reopen are
  rare events; the workspace lookup cost (one indexed query) is fine.

## Layer assignment

- `packages/contracts/src/events.ts` — add `WAKE_KINDS` + `shouldWake`.
- `packages/server/src/event-log.ts` — add `setAfterAppendHook` slot +
  swallow-log try/catch.
- `packages/server/src/mailbox.ts` — new shared writer.
- `packages/server/src/index.ts` — re-export the new symbols.
- `apps/worker/src/server/mailbox-hook.ts` — Worker-only presence-guard
  wrapper.
- `apps/worker/src/index.ts` — boot-time `setAfterAppendHook(workerAfterAppend)`.
- `apps/console/instrumentation.ts` — boot-time
  `setAfterAppendHook(enqueueMailboxIfHosted)`. Create file if absent.
- `apps/agent/src/event-watcher.ts` — replace local predicate with import.

## Deletion test (per added module/file)

- `mailbox.ts` (shared writer) — if removed, no Mailbox row ever lands.
  **Earns its keep.**
- `setAfterAppendHook` slot — if removed, every route gets manual wiring.
  **Earns its keep.**
- `mailbox-hook.ts` (Worker wrapper) — if removed, Worker either
  over-enqueues during Local CLI sessions (cheap but wrong) or uses the
  shared writer directly. The wrapper is ~5 lines for a real concern;
  inlining it into boot is fine too. *Marginal — could fold into
  `index.ts` if it stays this small.*
- Moved `shouldWake` — net deletion (one duplicated set + predicate
  becomes one shared one).

## Execution

```bash
bun run typecheck
bun run lint
# Manual smoke:
#   1. Set workspaces.hosted_enabled=true on a test Workspace (SQL).
#   2. With NO Local CLI connected, post a Comment via Worker.
#   3. Confirm a mailbox_events row appears.
#   4. Connect Local CLI; post another Comment.
#   5. Confirm NO new mailbox_events row appears.
#   6. With Local CLI connected, click Approve on the Thread (Console).
#   7. Confirm a mailbox_events row APPEARS (Console over-enqueues; supervisor
#      will be the place that no-ops on isFresh, per Task 2.7).
```

## Acceptance

- typecheck + lint clean.
- Smoke steps 1–7 above match expectations.
- code-simplifier + code-reviewer pass on the diff.

## Forward-links

- **Task 2.7 (supervisor) MUST re-check `isFresh` before provisioning a
  VM.** Otherwise Console-emitted over-enqueues will spin up unnecessary
  Hosted VMs during Local CLI sessions. This is recorded here so the
  Task 2.7 plan doesn't forget.
- **Eventually: move `approve`/`reopen` to Worker.** Then Console's hook
  registration goes away — only `thread_renamed` from
  `threads.renameThread` remains on Console-side, and it's filtered by
  `shouldWake`. File under AGENTS.md "Spotted but not fixed".
