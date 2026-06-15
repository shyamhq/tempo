# Slice 1d — Long-lived CLI loop (Session/Turn split + presence rewrite)

**Status:** plan ready for `judge` gate before implementation.
**Branch:** `main` (continues from 1c-2b).

## Problem (one paragraph)

`tempo-agent connect <thread-id>` today spawns `claude --print`, waits for it
to finish, then exits. A Dev who comes back 5 minutes later with a new comment
has to re-run the command. The `WORKFLOW` contract returned by `tempo_attach`
**already promises** a CLI-owned nudge loop ("the Tempo CLI owns the loop and
injects a one-line nudge"); the CLI just never caught up. Presence detection
(observation 3095: `last_seen_at` never written during active sessions) is
also broken because it was modeled around a long-running `tempo_poll` that
isn't how Claude actually behaves in `--print` mode. This slice closes both
gaps with the same change.

## Goal

After this slice:

1. `tempo-agent connect <thread-id>` stays alive from startup to Ctrl-C.
2. When new Dev activity lands on the Thread (Comment, Reply, Discussion
   Message, Plan edit, status change), the CLI **spawns a new Claude Turn
   with `--resume <claude-session-id>` and injects a one-line nudge carrying
   the cursor**.
3. While a Turn is running, additional events queue in memory; they fire the
   next Turn the instant the current one exits. No timer-based debounce.
4. Console's "Agent connected" pill is driven by the CLI's live SSE
   connection, not by the broken `last_seen_at` polling path.

## Vocabulary (CONTEXT.md updates land in this slice)

Two CONTEXT.md edits, both small:

- **Session** — rewritten. Today: "tempo_poll long-poll open." After: "the
  lifetime of one `tempo-agent connect` invocation. Presence = the CLI's
  live SSE connection to Worker." Ephemeral; many Sessions per Thread (no
  change to that part).
- **Turn** — new term. *"One spawned `claude` run inside a Session. Many
  Turns per Session. Each Turn is either an initial attach Turn (first
  spawn, no `--resume`) or a nudged Turn (subsequent spawns with `--resume
  <claude-session-id>`)."*

Other terms unaffected.

## Design — Local CLI loop

### Process lifecycle

```
tempo-agent connect <thread-id>
  │
  ├─ read creds, refresh if expired (existing)
  ├─ preflight /api/threads/:id/access (existing)
  ├─ write ephemeral /tmp/tempo-<pid>.json MCP config (existing)
  ├─ subscribe SSE to /api/threads/:id/events (NEW — event-watcher.ts)
  │   └─ capture initial cursor from server (latest_event_id)
  │
  ├─ Turn 1 (NEW — turn.ts):
  │     spawn `claude --print "<thread-id>" ...` (existing args + system prompt)
  │     stream-pump parses stdout (existing); CAPTURE the `system.init.session_id`
  │     wait for child exit
  │     stash claudeSessionId for resume
  │
  └─ loop forever:
        await: { events: batch from event-watcher } | { signal: SIGINT }

        if SIGINT:
            kill child if running; cleanup tmp config; exit

        if events arrived:
            advance cursor past the batch
            spawn Turn N (`claude --resume <claudeSessionId> --print "<nudge>"`)
            during Turn N: any new events arriving on SSE go into a queue
            when Turn N exits: if queue non-empty, fire Turn N+1 immediately
                                else, go back to await
```

### Event filtering (Dev-originated kinds only)

The SSE stream carries every event kind including `agent_text_delta`,
`agent_tool_use` — those come from the very Claude run we just spawned, so
waking on them = infinite loop. Filter to:

- `comment_added`
- `comment_reply_added`
- `comment_resolved`, `comment_unresolved`
- `discussion_message_posted` where `author = 'dev'`
- `plan_edited_by_dev`
- `status_changed`

(Defined in `packages/contracts/src/events.ts` — list authoritative there.)

### Nudge format (CLI → Claude via `--print`)

Self-contained — the cursor is in the nudge, so auto-compaction / Claude
losing track between Turns can't break the loop:

```
[Tempo] 3 new Console event(s) since evt_01HW9PJ...: comment_added, discussion_message_posted, plan_edited_by_dev.
Call tempo_poll with cursor "evt_01HW9PJ..." to fetch payloads, then act.
```

`<kinds>` is the list of distinct event kinds present in the batch with
multiplicity collapsed (e.g. `comment_added × 3, discussion_message_posted`).

### Cursor advance policy

The CLI advances its cursor **after sending the nudge**, not on SSE receipt.
If Claude crashes after the nudge is sent, the cursor is past those events
already — Dev re-comments if no reply lands (acceptable for MVP). If Turn
spawn itself fails (binary missing), the cursor is *not* advanced — next
attempt re-includes the same events.

### Token refresh (long-lived CLI)

Reactive only. On any HTTP 401 (SSE or fallback paths):
1. Call `credentials.refresh()` (existing).
2. Rewrite the ephemeral `/tmp/tempo-*.json` MCP config with the new Bearer.
3. New Turns pick up the refreshed token automatically. The in-flight Turn
   (if any) keeps the old token — its MCP calls will 401, Claude reports the
   error and exits, queue retains the events, next Turn uses the new token.

### Error handling table

| Case | Behavior |
|---|---|
| SSE drops | Reconnect with `Last-Event-ID`; exponential backoff to 30s cap; Dev warning after 3 fails. |
| Claude binary missing | Same one-line error message as today; exit. |
| Claude non-zero exit | Log to stderr; cursor stays at last-nudge position; drain queue into next Turn. If 3 consecutive Turns fail, exit CLI with a clear message. |
| `claude --resume <id>` fails (session cache evicted) | Detect via exit/stream-json error; log "resume expired, re-attaching"; spawn fresh Turn 1 (no `--resume`). Self-heals — Claude re-attaches per WORKFLOW. |
| Token expires mid-Session | See "Token refresh" above — reactive on 401. |
| Dev hits Ctrl-C | Kill child (existing); cleanup tmp config (existing); exit. |
| Worker restarts | Mid-Turn Claude's MCP calls fail → Claude exits → CLI waits for SSE reconnect → drains queue into next Turn. |

## Design — Worker side

### Presence rewrite

Today: `events-stream.ts` reads `getConnectedSessionLastSeenMs()` from
`sessions.last_seen_at`, which is updated only by MCP transport requests.
That path is fundamentally broken (observation 3095) — between Turns there is
no MCP traffic, so presence flickers off even when the CLI is connected.

After this slice: the CLI's SSE connection IS the presence signal.

**New file: `apps/worker/src/server/presence.ts`** (in-memory, single-Worker
assumption — acceptable for MVP; Slice 2 gossip/Redis swap is a deletion +
replacement when multi-Worker arrives).

```
// pseudocode
const live = new Map<threadId, Set<connId>>();
const subscribers = new Map<threadId, Set<(fresh: boolean) => void>>();

export function addConnection(threadId, connId) { ... emit if first }
export function removeConnection(threadId, connId) { ... emit if last }
export function isFresh(threadId): boolean { ... }
export function subscribe(threadId, cb): () => void { ... }
```

### SSE route change

`apps/worker/src/routes/events/sse.ts` (existing) — on a CLI-kind connection:
- On open: `presence.addConnection(threadId, connId)`.
- On close (req close / write fail): `presence.removeConnection(threadId, connId)`.
- Browser-kind connections do NOT touch presence (only the CLI is "the Agent").

### events-stream.ts cutover

`packages/server/src/events-stream.ts` `sseStream(...)` currently reads
`getConnectedSessionLastSeenMs(threadId)` every PRESENCE_CHECK_MS. Replace
with `presence.isFresh(threadId)` from the Worker-side registry. Delete the
DB read path; if `getConnectedSessionLastSeenMs` is no longer called from
anywhere, delete it too (and the MCP `touchSessionLastSeen` call sites that
existed solely for presence).

The `sessions` DB table stays untouched — it's MCP-transport bookkeeping
that creates one row per attach (per Turn, in the new world). That's
implementation detail; we don't redesign it now.

## Contract amendment — WORKFLOW guide

`packages/contracts/src/workflow.ts` — patch the "Event notifications"
section. Today:

> Call tempo_poll with the cursor of the most recent event you have seen.
> Start from `last_event_id` returned by tempo_attach; advance it using the
> cursor returned by each tempo_poll response. The nudge itself does not
> carry a cursor — use your own.

After:

> Call tempo_poll with the cursor embedded in the nudge — the CLI maintains
> it across Turns so you don't have to remember it between `--resume`
> invocations.

Single sentence swap. Claude's behavior simplifies (one less thing to track).

## File layout (CLI side)

```
apps/agent/src/
├── cli.ts                       (existing — entry, verbose flag)
├── commands/
│   ├── init.ts                  (existing — unchanged)
│   └── connect.ts               (REWRITTEN — orchestrator: preflight + Turn 1 + loop)
├── event-watcher.ts             (NEW — SSE subscription, dedup, queue, kind filter)
├── turn.ts                      (NEW — one function `runTurn({kind, ...})` covering both attach + resume)
├── credentials.ts               (existing — unchanged; reactive refresh callers updated)
├── stream-pump.ts               (existing — extended to capture system.init.session_id)
├── env.ts                       (existing)
└── logger.ts                    (existing)
```

`connect.ts` final shape, ~60 lines:

```
read creds → refresh-if-near-expiry → preflight access → write MCP config
start event-watcher (returns async iterator of EventBatch)
const { claudeSessionId } = await runTurn({ kind: 'attach', threadId, mcpConfigPath, ... })
for await (const batch of watcher) {
  const { exitCode } = await runTurn({ kind: 'resume', claudeSessionId, nudge: formatNudge(batch), mcpConfigPath, ... })
  if (exitCode !== 0) recordFailure() ; if (failureCount >= 3) break
}
cleanup; exit
```

## File layout (Worker side)

```
apps/worker/src/
├── server/
│   ├── presence.ts              (NEW — in-memory registry, ~40 lines)
│   ├── auth-lookup.ts           (existing)
│   ├── cli-auth.ts              (existing)
│   └── ...
├── routes/events/sse.ts         (PATCH — wire to presence on open/close)
└── (everything else unchanged)

packages/server/src/
└── events-stream.ts             (PATCH — isFresh source swap)

packages/contracts/src/
└── workflow.ts                  (PATCH — nudge carries cursor sentence)
```

## Net deletions

- `getConnectedSessionLastSeenMs` and any DB-presence read path callers
  (the function exists in `packages/server/src/sessions.ts`). Likely net-zero
  or net-negative LOC.
- The startup-only token-refresh assumption — replaced with reactive refresh
  (no new code, just a 401-handler check around SSE + Turn spawn).

## Alternatives considered

1. **Long-poll loop instead of SSE.** Rejected — Worker already serves SSE
   for Console with `rejectAgent` allowing `cli` callers; reusing it is
   strictly less code than adding a new long-poll endpoint.
2. **CLI heartbeat endpoint** for presence (POST every 10s, updates
   `last_seen_at`). Rejected — adds a route + a timer + DB pressure for a
   signal that the SSE connection already provides for free.
3. **Pre-debounce timer (3s window before firing first Turn).** Rejected
   during grilling — the queue-during-Turn mechanism already coalesces
   bursts; a pre-timer adds latency in the common (single-comment) case
   without saving anything in the burst case. See alternative in
   `plans/HANDOFF-1c-2b-complete.md` discussion.
4. **Persist `claudeSessionId` to disk so CLI restarts can resume.**
   Rejected — CLI restart = fresh Session by design (matches "Session = CLI
   lifetime" from the vocabulary change). Acceptable cost; one fewer file
   to manage; no privacy footprint on disk.
5. **Multi-Worker presence today (Redis / gossip).** Rejected — Worker is
   single-process today; in-memory presence is the deletion-friendly
   choice; when Slice 2 forces multi-Worker, swap is local.

## Uncertainties

- **Claude Code `--resume <id>` behavior with `--print`** — needs an
  end-to-end smoke test on Day 1 of implementation. Documentation says it
  works; if it doesn't, the fallback (fresh attach each Turn) still works
  but the conversation loses continuity. **Mitigation:** smoke test before
  writing the SSE-watcher loop. If `--resume` is broken, file as Spotted
  but not fixed and ship fresh-attach-per-Turn as v1.
- **Where exactly the `system.init.session_id` appears in stream-json
  output** — first message of every Claude run, but exact key name should be
  verified against the SDK output. Quick check during turn.ts implementation.
- **SSE `presence:{fresh}` event emission strategy** — should the
  registry emit per-connection-event (every add/remove) or per-edge (only
  when first-add or last-remove transitions fresh state)? Recommendation:
  per-edge. The Console pill only cares about the boolean.

## Layer placement (per CLAUDE.md rule 19)

- `event-watcher.ts` (CLI): pure client of Worker's SSE; no DB. Belongs at
  `apps/agent/src/event-watcher.ts`.
- `turn.ts` (CLI): subprocess driver; no DB, no HTTP. Belongs at
  `apps/agent/src/turn.ts`.
- `presence.ts` (Worker): in-memory; no DB. Lives at
  `apps/worker/src/server/` (NOT `packages/server/`) because it's inherently
  Worker-process-scoped — importing it from Console would silently get a
  different empty Map.
- `events-stream.ts` patch: stays in `packages/server/` — interface
  unchanged, implementation swaps source.

## Deletion test (per CLAUDE.md rule 19 / CONTEXT.md §2)

For each new module:

- **`event-watcher.ts`** — delete it, and the CLI loses its wake-up signal.
  No alternative location for that complexity. Earns its keep.
- **`turn.ts`** — delete it, and the two spawn paths (attach + resume)
  duplicate inside `connect.ts`. Earns its keep (deletion concentrates
  complexity in one file rather than scattering).
- **`presence.ts`** — delete it, and presence either lives inline in
  `sse.ts` (acceptable, but couples the route to the registry) or returns
  to the broken DB-polling model. Earns its keep marginally; if it stays a
  ~40-line file forever, inlining is on the table for a future cleanup.

No factories, no interfaces, no `IPresence` / `PresenceImpl` — one
implementation, one place.

## Acceptance check (manual)

1. `bun run --filter @tempo/worker dev`, `bun run --filter @tempo/console dev`.
2. Sign in to Console; open an existing Thread.
3. In a separate terminal: `tempo-agent connect <thread-id> --verbose`.
   - Expect: Turn 1 spawns, `tempo_attach` succeeds, activity feed populates,
     **CLI does not exit**.
4. In Console, add a Comment on a Plan block.
   - Expect: within ~1 second, CLI logs "Turn N spawning with nudge: ...",
     Claude replies, Reply appears in Console.
5. Rapid-fire 3 Comments within 2 seconds.
   - Expect: Turn fires immediately on Comment 1; Comments 2+3 queue;
     Turn 2 fires the instant Turn 1 exits; one merged nudge covers both.
6. Add a Discussion Message.
   - Expect: same nudge mechanism, `discussion_message_posted` event filtered
     in, Turn fires.
7. Close the Console tab. Re-open. Add a Comment.
   - Expect: CLI is still alive (Ctrl-C never pressed); Turn fires.
8. Approve the Thread.
   - Expect: CLI stays alive; no Turn fires (filter includes
     `status_changed` but Claude has nothing to do — verify Agent reads
     the WORKFLOW guidance correctly).
9. Reopen the Thread, add a Comment.
   - Expect: Turn fires; Agent resumes normal work.
10. SIGINT (Ctrl-C).
    - Expect: child killed if mid-Turn; tmp MCP config deleted; clean exit.
11. Cross-Workspace: sign in as another Clerk user, try the same thread URL.
    - Expect: 403 (already proven in 1c-2b — re-verify presence registry
      doesn't leak across Workspaces; the registry is keyed by threadId
      only — Worker route handler still owes the cross-workspace check
      via existing `ensureThreadAccess` middleware).
12. Browser presence indicator: with CLI connected, Console shows "Agent
    connected." Ctrl-C the CLI — within ~2s, indicator switches to "not
    connected."

## Judge gate

Required.

Reasons (per CLAUDE.md "When to use the judge agent"):
- Contract change to `packages/contracts/src/workflow.ts` (the WORKFLOW
  guide is the wire shape the Agent reads).
- New product surface: a long-lived orchestration loop in the CLI; an
  in-memory presence registry in Worker.

Not destructive; no DB migration; no new dependency.

## Out of scope (deferred)

- **Parallel sub-agent fan-out per channel.** Today: serial per-channel
  (one Turn drains the batch sequentially). This matches the existing
  `WORKFLOW` per-channel rule. Future enhancement: when a Turn handles
  events on multiple independent channels (e.g., 3 Comments on 3 different
  Plan blocks + 1 Discussion thread), spawn sub-agents via Claude Agent
  SDK's native `Task` tool to handle each channel in parallel; coordinator
  agent merges results. Trigger to revisit: a Dev complaint that "the
  agent took forever to reply because it was busy with someone else's
  comment," or active Threads consistently seeing 5+ concurrent comments.
  Risks to weigh at that point: concurrent `tempo_update_plan` /
  `tempo_update_block` calls from sibling sub-agents racing on the same
  artifact (mitigation candidates: route Plan-mutating channels to serial
  only, or add an artifact-level lock). Non-breaking change when added —
  Hosted-internal, no contract impact.
- **Hosted runtime / VM / Mailbox.** Slice 2 (see
  `plans/slice-2-hosted-runtime.md`).
- **Multi-Worker presence.** Triggered by Slice 2 if it forces horizontal
  scale; until then, in-memory single-process is correct.

## Files touched (summary)

| File | Action |
|---|---|
| `apps/agent/src/commands/connect.ts` | Rewrite (~60 lines, orchestrator only) |
| `apps/agent/src/event-watcher.ts` | New (SSE + queue + filter) |
| `apps/agent/src/turn.ts` | New (subprocess driver, both Turn kinds) |
| `apps/agent/src/stream-pump.ts` | Extend (capture `session_id` from init message) |
| `apps/worker/src/server/presence.ts` | New (~40 lines, in-memory Map + subscribers) |
| `apps/worker/src/routes/events/sse.ts` | Patch (call presence add/remove on open/close for `cli` callers) |
| `packages/server/src/events-stream.ts` | Patch (read from `presence.isFresh` instead of DB) |
| `packages/server/src/sessions.ts` | Delete `getConnectedSessionLastSeenMs` if no remaining callers |
| `packages/contracts/src/workflow.ts` | One-sentence patch (nudge carries cursor) |
| `CONTEXT.md` | Session definition rewrite + new Turn term |
| `AGENTS.md` "Spotted but not fixed" | Carry parallel-fan-out enhancement note |
