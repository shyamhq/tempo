# Handoff — End of slice 1d, ready for slice 2

Branch: `main`, ahead of `origin/main` by 13 commits committed + the entire
slice-1d work as **uncommitted** in the working tree at handoff time.
The next session picks up by deciding whether to commit slice 1d first
(recommended) and then begins executing slice 2.

This document is the short pickup brief. The substance lives in:

- `plans/slice-1d-cli-lifecycle.md` — the slice-1d plan (judge-APPROVED).
- `plans/slice-2-hosted-runtime.md` — slice-2 task breakdown with all
  grilling decisions baked in; **the document to follow when executing**.
- `CONTEXT.md` — vocabulary; `Session`, `Turn`, `Mailbox`, `VM` were edited
  in this session.
- `CLAUDE.md` — agent guardrails (judge gate, review pipeline).
- `AGENTS.md` — playbook.
- `plans/agent-harness.md` — overall architecture; **note**: §2 "lazy VM"
  framing and §4 "60s debounce" are overridden by the slice-2 plan.

If anything below conflicts with the plan documents, the plans win.

---

## What this session did

### Slice 1d (uncommitted) — Long-lived CLI loop + presence rewrite

Pre-1d: `tempo-agent connect <thread-id>` spawned `claude --print`, ran
one Turn, exited. Dev re-ran the command to get a reply.

Post-1d: CLI stays alive from startup to Ctrl-C. SSE-driven event watcher
queues Dev-originated events; each event triggers a nudged Turn via
`claude --resume <session-id> --print "<nudge>"`. Presence is now an
in-memory Worker registry keyed on the CLI's live SSE connection — the
broken DB-based presence path was deleted.

**Files (uncommitted):**

| File | Action |
|---|---|
| `apps/agent/src/commands/connect.ts` | Rewrite (~150 lines, orchestrator) |
| `apps/agent/src/event-watcher.ts` | New (SSE consumer + queue + author-filter) |
| `apps/agent/src/turn.ts` | New (Turn driver for both attach + resume kinds) |
| `apps/agent/src/stream-pump.ts` | Extended (captures Claude `system.init.session_id`) |
| `apps/worker/src/server/presence.ts` | New (in-memory Map<threadId, Set<connId>>) |
| `apps/worker/src/routes/events/sse.ts` | Patched (CLI presence add/remove on open/close) |
| `apps/worker/src/routes/threads/access.ts` | Patched (returns `latest_event_id` for CLI cursor seed) |
| `packages/server/src/events-stream.ts` | Patched (reads `presence.isFresh`, not DB) |
| `packages/server/src/sessions.ts` | Deleted `getConnectedSessionLastSeenMs` |
| `packages/contracts/src/workflow.ts` | Workflow guide updates (see below) |
| `packages/contracts/src/http.ts` | `ThreadAccessResponse` gained `latest_event_id` |
| `CONTEXT.md` | `Session` rewrite + new `Turn` + new `VM` (E2B) + Mailbox rewrite |

Slice-1d plan was **judge-APPROVED**; implementation passed typecheck +
lint clean across the 4 touched packages (console's 53 pre-existing lint
errors are baseline). Code-simplifier + code-reviewer findings were
addressed before this handoff.

### Bugs found and fixed during live testing of slice 1d

These are all in the uncommitted slice-1d patch set:

1. **`tempo_attach` insert silently dropped on Turn 2+ (`session_not_found`
   loop)** — root cause: partial unique index
   `idx_sessions_one_connected_per_thread` blocked the insert because
   Turn N-1's session row was still `status='connected'` (transport.onclose
   doesn't fire on plain `claude` process exit). `onConflictDoNothing` was
   masking it. **Fix:** `apps/worker/src/mcp/tools/attach.ts` now displaces
   any existing `'connected'` row in the same transaction before insert,
   matching the `createSessionFromToken` pattern.

2. **`session_connected` never emitted** — SessionPill stuck at
   "initiating" indefinitely. **Fix:** attach.ts emits `session_connected`
   on successful insert (and `session_disconnected` for a displaced prior
   row).

3. **CLI's WAKE_KINDS was kind-only** — Agent's own `reply_added` and
   `discussion_message_posted` events triggered new Turns (ping-pong loop).
   **Fix:** `event-watcher.ts` `shouldWake()` predicate now author-filters
   those two kinds to `author === 'dev'`.

4. **`tempo_attach` re-called every Turn** — Claude was reflexively
   re-attaching on every nudged Turn despite the WORKFLOW guide. Each
   re-attach burned ~10k tokens. **Mitigations applied:**
   - Added **WORKFLOW step 0** ("Do NOT call tempo_attach on a nudge") in
     `packages/contracts/src/workflow.ts`.
   - Added **server-side rejection** in `attach.ts`: when an `existing`
     row is found for the same MCP session UUID, return
     `{ error: 'already_attached_use_poll', cursor: <latest> }` instead of
     the full ~10k-token payload.
   - **Important caveat — see "Known issue still open" below.** The
     rejection only fires for a *second* attach within the *same* MCP
     transport. Each `claude --resume` spawn creates a *new* MCP transport
     (new UUID), and the first attach on a new transport is the
     legitimate sticky-session bootstrap and still pays full cost. So
     the structural per-Turn cost is unchanged; only Claude's
     intra-Turn double-attach weirdness is now cheap.

5. **Boot dead-zone invisibility in Console** — between Dev clicking
   Connect and Turn 1's first `tempo_attach`, the activity widget showed
   nothing. **Fix:** widget now mounts during `session_status === 'initiating'`
   ("Agent starting · Initiating…") and `'failed'` ("Agent failed to start"
   with reason). Header pill behavior unchanged (it already covered these).

### System prompt restoration (uncommitted)

While investigating Claude's poor skill-loading and verbose-reply
behavior, we discovered slice 1c-2a (`d75e37e`) had dropped ~180 lines of
system prompt from `apps/agent/src/prompts/system-prompt.ts` (which it
deleted). The minimum scaffolding (`ATTACH_SYSTEM_PROMPT` + `WORKFLOW`)
came over; the rich behavior guidance did not.

**Restored verbatim into `apps/agent/src/turn.ts`'s `ATTACH_SYSTEM_PROMPT`**
(now ~150 lines): Identity, Repo exploration discipline, Question-batch
authoring with examples, Reply tone with good/bad examples, First-draft
vs iteration mode, Plan structure (7-section default), Block-type rubric,
Plan-edit mechanics, Tempo-vocabulary discipline, Approved Threads,
"When you cannot decide" escape, and a Skills catalog with hard triggers.

The Skills section I'd briefly added to `WORKFLOW` mid-session was removed
(system prompt now owns it; no duplication).

System prompt is loaded once on Turn 1 (`kind='attach'`); preserved
across `--resume` in Claude's conversation memory for every subsequent
Turn. ~3k tokens, paid once per Session.

---

## Known issue still open (NOT fixed) — decide in slice 2

**Per-Turn `tempo_attach` token cost (~10k per Turn 2+).** Each
`claude --resume` spawn creates a new MCP HTTP transport, which gets a
new `Mcp-Session-Id` UUID, which has no sessions-table row yet. So:

1. Claude calls `tempo_poll(cursor)` first (per the nudge).
2. `poll.ts`'s `getThreadIdForMcpSession(new-UUID)` returns null →
   returns `session_not_found` with the literal error
   *"call tempo_attach before this tool"*.
3. Claude self-heals via `tempo_attach`, gets full ~10k-token payload.

This is structural to the **sticky-session-per-MCP-transport** design.
Removing it requires *Option B*: change every MCP tool to take
`thread_id` explicitly (or derive it from `comment_id` / `block_id`)
and call `authorizeThread(caller, threadId)` per-call. The `sessions`
table stops being a routing oracle and becomes pure presence/audit.

**Scope of Option B:** ~80–120 lines across 9 MCP tools, 7 contract
schemas, the WORKFLOW guide, and `turn.ts`'s nudge formatter.

**Decision deferred:** the user said *"forget about this"* mid-session
to focus on Slice 2. The cost is real but acceptable for MVP. Worth
filing as the first item to address **inside Slice 2** if/when Hosted
Agent's per-Turn cost matters.

---

## Slice 2 — what's locked, what's next

**Read first:** `plans/slice-2-hosted-runtime.md`. It has the full
task breakdown (8 tasks, ~1 day each), the architecture-decisions
table, what's deferred, and the file layout.

### Architecture decisions locked from grilling (already in the slice-2 doc)

1. **Always-VM, conditional repo clone.** Single mental model. Per-Thread
   VM. No "lazy VM" / split-brain. (Overrides `agent-harness.md` §2's
   "lazy VM" wording.)
2. **Sandbox provider: E2B** — picked over Fly Machines for 35× faster
   cold start (80ms vs 2.8s p50), purpose-built TypeScript SDK, native
   egress allowlist (added Nov 2025). See the slice-2 doc's
   architecture-decisions table for the full rationale.
3. **Mailbox = Postgres `LISTEN`/`NOTIFY` + 5s polling fallback.** No
   Redis. Single store.
4. **No pre-debounce.** Fire Hosted on first event; in-Turn polling
   batches mid-Turn events; ~10 min idle keep-alive coalesces stragglers
   without paying cold-start. (Overrides `agent-harness.md` §4's "60s
   debounce.")
5. **Hosted identity:** `sk_hosted_*` Bearer + 4th `Caller.kind = 'hosted'`.
6. **Routing decision at enqueue time.** Worker reads `presence.isFresh`
   from slice 1d's in-memory registry. Fresh → event-log only; not fresh
   AND `workspaces.hosted_enabled` → also enqueue Mailbox row.
7. **Continuation across teardown via `tempo_attach` rehydrate from
   artifact.** Plan + Comments + Discussion ARE the conversation state.
   No process snapshots.
8. **Activity stream from Sandbox via existing `/api/agent-events`
   route.** Wire shape identical to Local's; Console activity feed is
   blind to which runtime produced events.
9. **Serial per-channel (MVP), parallel sub-agent fan-out deferred.**
   Trigger to revisit: Dev complaint about latency, or active Threads
   with 5+ concurrent comments. Non-breaking when added.

### Task list (from `slice-2-hosted-runtime.md`)

| # | Task | Judge gate? |
|---|---|---|
| 2.1 | DB schema + migrations (`mailbox_events`, `workspaces.hosted_enabled`, `vm_runs`) | Required |
| 2.2 | Mailbox writer + routing decision (`enqueueIfHostedRoute`) | Required |
| 2.3 | Mailbox consumer (`drainPending`, `waitForWake` with LISTEN + polling fallback) | Required |
| 2.4 | Hosted identity (`sk_hosted_*` + 4th Caller.kind, `issueHostedToken`) | Required |
| 2.5 | E2B Sandbox provisioner (`apps/worker/src/vm/provision.ts` + `teardown.ts`) | Required |
| 2.6 | Hosted runner (`apps/worker/src/hosted/runner.ts`, e2b.toml template) | Required |
| 2.6b | Activity stream from inside the Sandbox (folds into 2.6 unless split) | optional |
| 2.7 | Hosted lifecycle supervisor (LISTEN mailbox → provision sandbox) | Required |
| 2.8 | Console toggle (workspace admin UI for `hosted_enabled`) | not required |

Each task's full plan should be written as a separate doc + judge-gated
before implementation. The slice-2 doc itself does NOT need judge approval
(it's a breakdown, not an implementation plan).

---

## Prerequisites + new dependencies

- `bun add e2b` in `apps/worker` (Task 2.5).
- Add `E2B_API_KEY` env var to Worker (used to provision sandboxes;
  never reaches the sandbox itself).
- Add `WORKER_PUBLIC_URL` env var if not already present — the Sandbox
  needs Worker's public URL for MCP calls.
- `WORKSPACE_PUBLIC_URL` / `WORKER_HOST` for the E2B `allowOut` list.
- `@anthropic-ai/claude-agent-sdk` dependency on Worker (used inside
  the bundled runner script).
- New env var `ANTHROPIC_API_KEY` (Worker only, injected into Sandbox
  per-Session as `TEMPO_HOSTED_ANTHROPIC_KEY` — short-lived; rotation
  policy TBD in Task 2.5 plan).
- New env var for GitHub App installation token resolution
  (Task 2.5 plan should define the exact name + flow).

---

## How to pick up

1. **Decide on slice 1d commit.** Recommended: stage the slice-1d
   uncommitted changes (review `git status` + `git diff` first), commit
   with a single message covering the lifecycle work + the bugs found.
   The system-prompt restoration is part of this slice (it shipped as
   the same logical change set during testing).

2. **Decide on the Option-B "decouple from sessions table" fork.** If
   yes: write a small plan, judge-gate, then implement before slice 2
   touches Hosted (Slice 2 inherits the same per-Turn cost otherwise).
   If no: file it under `AGENTS.md` "Spotted but not fixed" with the
   trigger condition (e.g. "when Hosted token spend > $X/mo").

3. **Start Slice 2 with Task 2.1 (DB schema).** Write the task plan,
   invoke judge, get APPROVED, implement.

4. **Per CLAUDE.md rules 21–22**: every meaningful unit of work runs
   through `code-simplifier:code-simplifier` and
   `everything-claude-code:code-reviewer` (Sonnet) before commit.

5. **Per CLAUDE.md commit cadence**: don't commit without explicit Dev
   approval. The Dev runs `git commit` themselves.

---

## Spotted but not fixed (carried forward into slice 2 / beyond)

- **`transport.onclose` doesn't fire on plain `claude` process exit.**
  Worker's in-memory MCP `sessions` Map keeps stale transport entries
  forever. Slow memory leak. The attach.ts fix from this session
  side-steps the DB-level symptom but the in-memory map still grows.
  Fix candidates: idle-timeout reaper in `transport.ts`, or push from
  CLI on graceful exit via `DELETE /mcp`. File under Slice 2 lifecycle
  work.

- **`sk_hosted_*` token rotation policy** is TBD. Task 2.4's plan should
  decide: per-Session-fresh, or refresh-on-expiry, or other?

- **E2B template versioning.** As `apps/worker/src/hosted/runner.ts`
  changes, the `tempo-hosted-runner` E2B template needs rebuilding +
  the template id pinning. Set up a release/build cadence — likely
  bundle the build into `apps/worker`'s deploy pipeline. Task 2.6 plan
  should specify.

- **Per-Workspace cost cap.** No budget ceiling for Hosted; abandoned
  Sessions cost ~$0.008–0.05 per 10 min × N. Instrument
  `vm_runs.cost_estimate_usd` so a future cap is easy. Note in
  Task 2.5 plan.

- **`tempo_attach`/MCP session coupling**: see "Known issue still open"
  above — Option B fork.

---

## Repo navigation cheat sheet

| Question | Read |
|---|---|
| What's slice 1d? | `plans/slice-1d-cli-lifecycle.md` |
| What's slice 2 (the next thing to build)? | `plans/slice-2-hosted-runtime.md` |
| Vocabulary | `CONTEXT.md` (Session/Turn/Mailbox/VM recently edited) |
| Per-agent guardrails | `CLAUDE.md` |
| Build playbook | `AGENTS.md` |
| Overall architecture | `plans/agent-harness.md` (note: lazy-VM and 60s-debounce framings are overridden — see slice-2 plan) |
| Current Worker auth | `apps/worker/src/auth.ts` |
| Current CLI flow | `apps/agent/src/commands/connect.ts`, `event-watcher.ts`, `turn.ts` |
| Contracts | `packages/contracts/src/{http,events,mcp,workflow,primitives}.ts` |
| DB | `packages/db/src/schema.ts`, `packages/db/drizzle/` |

When in doubt about scope: deletion test (`CONTEXT.md` §2) + "standard
code, never band-aids" rule (`CLAUDE.md`).
