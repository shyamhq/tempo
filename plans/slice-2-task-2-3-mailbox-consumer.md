# Task 2.3 — Mailbox consumer (Slice 2)

## Problem

Task 2.2 writes `mailbox_events` rows and emits `pg_notify('mailbox',
threadId)`. Nothing reads them yet. Two readers are needed:

- **The VM runner** (Task 2.6) calls a "give me my pending batch" surface
  at the top of every Turn and between Turns during the keep-alive
  window. This is `drainPending(threadId)`.
- **The supervisor** (Task 2.7) needs to be told when *any* Thread gets a
  new Mailbox row so it can decide whether to provision a VM. This needs
  a single LISTEN subscription per Worker, demuxed by threadId.

The slice-2 plan calls these `drainPending` and `waitForWake`.

## The change

### 1. `drainPending(threadId)` — one query, RETURNING

```ts
export async function drainPending(threadId: string): Promise<MailboxBatch> {
  const rows = await db
    .update(mailbox_events)
    .set({ consumed_at: sql`now()` })
    .where(and(eq(mailbox_events.thread_id, threadId), isNull(mailbox_events.consumed_at)))
    .returning({ id: mailbox_events.id, event_id: mailbox_events.event_id });

  if (rows.length === 0) return { events: [] };

  const evs = await db
    .select()
    .from(events)
    .where(and(eq(events.thread_id, threadId), inArray(events.id, rows.map((r) => r.event_id))))
    .orderBy(asc(events.id));
  return { events: evs.map((e) => e.payload_json as unknown as Event) };
}
```

Single `UPDATE ... RETURNING` claims the rows atomically. Then one
JOIN-shaped lookup against `events` to materialize the payloads. The
delete-first reflex: the slice-2 plan's two-step SELECT+UPDATE pattern
becomes one UPDATE.

### 2. `subscribeWakeups({ onWake })` — one LISTEN, per Worker boot

```ts
export type WakeListener = { close: () => Promise<void> };

export async function subscribeWakeups(opts: {
  onWake: (threadId: string) => void;
}): Promise<WakeListener> {
  // Dedicated connection from the pool; LISTEN binds to a single connection.
  const client = await pool.connect();
  client.on('notification', (msg) => {
    if (msg.channel === 'mailbox' && msg.payload) opts.onWake(msg.payload);
  });
  client.on('error', (err) => {
    console.error('mailbox LISTEN connection error', { err });
  });
  await client.query('LISTEN mailbox');
  return {
    close: async () => {
      try { await client.query('UNLISTEN mailbox'); } catch {}
      client.release();
    },
  };
}
```

One subscription, one connection from the pool. The supervisor (Task 2.7)
calls this once at Worker boot with its dispatch callback. No per-Thread
subscription; the channel is global, the demux is in the callback.

### 3. No per-Thread `waitForWake` — deletion test

The slice-2 plan listed `waitForWake(threadId, timeoutMs)` as a Promise
that resolves on a NOTIFY for that thread or times out. Applied the
algorithm:

1. **Question the requirement.** Who calls per-Thread `waitForWake` with
   a timeout?
2. **Try to delete.** Only the VM runner ever needs to wait for *its*
   thread. The runner is inside the Sandbox; it talks to Worker via MCP
   (Task 2.6). The MCP tool can do `setTimeout(timeoutMs)` race with a
   per-call Promise — no shared per-Thread subscription needed. The
   supervisor uses `subscribeWakeups` once at boot; the runner uses
   polling + a long-poll on the MCP request.
3. Deleting `waitForWake` removes a `Map<threadId, Promise>` registry, a
   timeout-cleanup story, and a "what happens if two waiters per thread"
   question. None of that complexity reappears.

The 5-second polling fallback the slice-2 plan called out lives in the
runner's idle loop (Task 2.6), not in this module. The fallback was
covering "missed NOTIFY"; if a wake is missed, the runner's next 5s
poll catches it because it calls `drainPending` directly.

### 4. Exports

`packages/server/src/mailbox.ts` is the obvious home — the writer is
already there. Re-exports flow through `packages/server/src/index.ts`
(already touches it).

## Deliberate simplifications (algorithm + ponytail applied)

- **Deleted `waitForWake`.** Per-Thread `waitForWake` was speculation
  about a registry pattern that no caller actually needs. See §3.
- **No reconnect-on-LISTEN-failure loop.** Postgres connections are
  durable; if the LISTEN client dies, Worker has bigger problems
  (the pool will be sad too) and a fresh process is the answer. *Skipped:
  reconnect; add when pg_stat_replication shows actual disconnects.*
- **No per-Thread cursor on drain.** The `consumed_at` UPDATE+RETURNING
  is the cursor. No second source of truth.
- **One `UPDATE ... RETURNING` instead of SELECT-then-UPDATE.** Atomic;
  no race window where two readers double-process.

## Alternatives considered

1. **Use `SELECT ... FOR UPDATE SKIP LOCKED` + UPDATE.** Standard
   queue-on-Postgres pattern. Overkill: there is exactly one reader per
   `threadId` (the VM bound to that Thread). `UPDATE ... RETURNING`
   with the partial index does the job and the contention case doesn't
   exist.
2. **River / pgmq / pg-boss.** New dependency, separate worker, schema
   migration. We have ten lines of code and exactly one channel. No.
3. **Reuse `event-log`'s polling via `tempo_poll`.** Mixes two concerns:
   the event log is per-Thread Dev↔Agent chat; Mailbox is "wake up,
   come process events." Keep them separate.

## Uncertainties

- **Connection consumption.** One pool connection is permanently held by
  the LISTEN client. The pool's default size on a single-Worker MVP is
  fine; document this in code so a future "why are we running out of
  connections?" investigation finds it fast.

## Layer assignment

- `packages/server/src/mailbox.ts` — extend (add `drainPending` +
  `subscribeWakeups`).
- `packages/server/src/index.ts` — already re-exports `./mailbox`; no
  change needed.

No app code wires this yet. Task 2.6 calls `drainPending` from the MCP
tool; Task 2.7 calls `subscribeWakeups` at Worker boot.

## Deletion test

- `drainPending` — sole reader; if removed, the runner can't make
  progress. **Earns its keep.**
- `subscribeWakeups` — sole wake mechanism; if removed, the supervisor
  has no signal. **Earns its keep.**
- (Removed) `waitForWake` — registry + timeout + cleanup all die. **Net
  deletion.**

## Execution

```bash
bun run typecheck
bun run lint
# Manual smoke (after Worker reload):
#   - INSERT into mailbox_events; pg_notify; subscribeWakeups callback fires.
#   - drainPending returns the batch + marks consumed_at.
#   - Second drainPending returns empty.
```

## Acceptance

- typecheck + lint clean.
- code-simplifier + code-reviewer pass.
- Smoke steps above pass.
