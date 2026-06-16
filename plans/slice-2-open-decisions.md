# Slice 2 — open decisions to review

Stuff I made calls on overnight, or deliberately deferred, that you should
weigh in on once you're testing Hosted end-to-end. Ranked by stakes.

---

## High stakes — material to revisit

### 1. Option B fork (Slice 1d carry-over) — still deferred

Every Hosted Turn pays the ~10k token `tempo_attach` re-cost. Slice 2
inherits the cost; nothing I built in 2.1–2.8 solves it.

- Root cause: each `claude --resume` spawn (Local) or `query()` call
  (Hosted) creates a new MCP HTTP transport → new `Mcp-Session-Id` UUID →
  `tempo_poll` returns `session_not_found` → Claude self-heals via
  `tempo_attach` → ~10k tokens of state payload.
- Fix shape: change MCP tools to take `thread_id` (or derive from
  `comment_id`/`block_id`) and call `authorizeThread(caller, threadId)`
  per-call. `sessions` table stops being a routing oracle, becomes pure
  presence/audit. ~80–120 LOC across 9 MCP tools + 7 contract schemas +
  WORKFLOW + turn.ts nudge formatter.
- If Hosted goes live with this in place, your bill scales linearly with
  Turn count — not Session count.

**Decision:** fork now (delays Hosted live by ~1 day), or note and live
with it (file under AGENTS.md "Spotted but not fixed" with a `> $X/mo
spend` trigger).

Cross-ref: `plans/HANDOFF-slice-1d-complete.md` §Known issue still open.

---

### 2. No per-Workspace cost cap

Hosted spend has zero ceiling. A bug in the supervisor that keeps
re-provisioning, an abandoned Session, or a malicious tenant burning
Turns — no kill switch.

- `vm_runs.cost_estimate_usd` column exists but has no writer.
- E2B's per-second billing means a Sandbox forgotten for 10 hours costs
  ~$0.50 on default sizing. Multiplied across Workspaces, this is real.

**Decision:** hard cap per Workspace (deny new provisions when
`SUM(cost_estimate_usd) > limit` in the current billing period)? Soft
alert? Or accept the risk for closed-beta?

Note: writing `cost_estimate_usd` itself is forward work — e2b doesn't
surface per-second usage in their SDK, so this needs the billing API.

---

### 3. Long-Turn-kills-sandbox-mid-flight

`SANDBOX_BUDGET_MS = 10 min` is the e2b wallclock budget from
`Sandbox.create`. The supervisor extends it on NOTIFY-while-alive (a
Dev event arrives → `sandbox.setTimeout(10min)` resets the clock). But
a single Turn that runs >10 min wall time **without** a new Dev event
will get killed by e2b mid-call.

- The runner has no in-Turn `sandbox.setTimeout` heartbeat.
- Complex repo-exploration Turns (large repos, many Grep/Read tools) can
  plausibly hit 10 min.
- Mid-Turn kill = abandoned Plan edit, lost activity events, Dev sees a
  cold restart on their next message.

**Decision options:**
- Heartbeat from the runner during long tool runs (`setInterval` calling
  back via a new MCP tool `tempo_extend_budget`). +20 LOC.
- Accept and call it a "split the ask" UX nudge ("if your prompt takes
  >10 min the Agent will need a follow-up to continue").
- Push initial budget higher (1 hour for Pro users, hits Hobby ceiling).

---

### 4. `HOSTED_AUTH_SECRET` rotation policy

Long-lived HS256 secret signs every Hosted JWT. A leak stays exploitable
for the JWT's 2h TTL after rotation.

- I documented "rotate by deploying a new env var" but no cadence and no
  operational story.
- If Hosted is multi-tenant from day one, this matters more. Single-Dev
  beta — less so.

**Decision:** rotation cadence (monthly? quarterly?), and whether to add
a per-Worker-boot ephemeral secret if/when Worker scales horizontally.

---

### 5. `HOSTED_BOOTSTRAP_PROMPT` is a compressed copy of `ATTACH_SYSTEM_PROMPT`

Simplifier flagged: the Hosted version dropped good/bad reply examples,
the Approved-Threads 403 detail, and the structured-vs-prose reply
guidance.

- The Hosted Agent will be measurably more verbose than the Local CLI
  Agent until you either lift the shared body or restore the cuts.
- Files: `apps/worker/src/hosted/prompt-hosted.ts` (compressed) vs
  `apps/agent/src/turn.ts` `ATTACH_SYSTEM_PROMPT` (full).

**Decision:** lift the body to `@tempo/agent-prompts` (new package),
restore the cuts inline, or accept the quality drift for MVP.

---

## Medium stakes — work-after-bedtime

### 6. Manual E2B template build

Every change to `apps/worker/src/hosted/runner.ts` requires:

```bash
bun run --filter @tempo/worker build:hosted-runner
cd apps/worker/e2b && e2b template build
```

- No CI step.
- Easy to forget and ship a stale Sandbox image — silently runs the
  previous runner against the new MCP contract.

**Decision:** wire to CI (push triggers template rebuild on
`apps/worker/src/hosted/**` changes), bundle into `bun run build`
locally, or stay manual.

---

### 7. `sdkMessageToAgentEvent` is a first-pass mapper

Only emits `agent_tool_use`, `agent_narration`, `agent_turn_ended`.
Multi-block assistant messages drop everything after the first match.
`agent_todos_updated` from the SDK isn't surfaced.

- Console activity feed will look thinner for Hosted than for Local
  until iterated.
- File: `apps/worker/src/hosted/runner.ts:67-87`.

**Decision:** iterate now (1–2 hours of mapping work), defer until you
see the feed and judge, or accept the difference.

---

### 8. Worker restart leaves orphan `vm_runs` rows

If Worker crashes (or `kill -9`s) while a Sandbox is live, the runner
self-reaps after `MAX_IDLE_MS` but `vm_runs.ended_at` stays NULL forever.
No cleanup cron exists.

- Cost rollups will overcount.
- `vm_runs WHERE ended_at IS NULL` query becomes unreliable as a
  "live sandboxes" signal.

**Decision:** boot-time sweep that closes orphans older than
`SANDBOX_BUDGET_MS × 2`, periodic cron, or accept and document.

---

### 9. `WORKER_PUBLIC_URL` localhost-only failure mode

Dev mode with no ngrok → Sandbox can't reach Worker → silent failure
deep in the runner's MCP calls. The env guard only fires in
`NODE_ENV=production`.

- First Dev to test Hosted locally will hit this and not know why.
- Worth a "is this URL reachable from outside?" preflight check at boot,
  or a clearly worded README section.

**Decision:** preflight check (e.g. self-HTTP `/health` from a
side-channel), README section, or accept.

---

## Low stakes — style, easy to skip

### 10. `@tempo/server` uses `console.error`/`console.warn` for error paths

Instead of Pino. Marked with `ponytail:` tags at each call site. Will
make log aggregation harder when Hosted goes to real users.

**Decision:** promote to Pino now (add `pino` as a `@tempo/server` dep
+ `setLogger(...)` hook), or stay until log aggregation is real.

---

### 11. `rejectAgent` middleware now also rejects Hosted but keeps the name

Documented inline. Misleading name; one mount site. Rename when a third
non-User Bearer kind appears.

**Decision:** rename now (one line), defer.

---

### 12. PATCH `/api/workspace` refuses compound `{name, hosted_enabled}` requests

I made this call to dodge a partial-commit desync (Clerk owns `name`,
our DB owns `hosted_enabled`; mixing them in one request can leave one
written and the other not). The discriminated union makes the bad shape
unrepresentable at the contract layer.

- If you ever want a "save all settings" button that fires one PATCH,
  the contract has to widen back out with a saga (or accept the desync
  risk).

**Decision:** accept (current state) or note that future "save all"
buttons need a different endpoint.

---

## Not a decision — just a checklist for first Hosted boot

1. Set env vars in `apps/worker/.env`:
   - `E2B_API_KEY` (https://e2b.dev/dashboard)
   - `HOSTED_AUTH_SECRET` (`openssl rand -hex 24`)
   - `ANTHROPIC_API_KEY` (sk-ant-…)
   - `WORKER_PUBLIC_URL` — **ngrok URL in dev** (E2B can't reach loopback).
2. Build + publish the template:
   ```bash
   bun run --filter @tempo/worker build:hosted-runner
   cd apps/worker/e2b && e2b template build
   ```
3. In the Console workspace settings → General → enable Hosted Agent.
4. Open a Thread (no Local CLI running), post a Discussion message,
   watch `vm_runs` populate and the activity feed light up.

---

## Single thing to revisit first

**#1 (Option B fork).** Token cost lands every Turn, not edge cases. If
Hosted's value prop is "always-on agent," every always-on Turn is a tax
on your gross margin. Cost cap (#2) is the safety net for everything
else but doesn't fix the unit economics.
