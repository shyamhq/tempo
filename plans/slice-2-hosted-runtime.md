# Slice 2 — Hosted runtime (Mailbox + Hosted Agent SDK loop + VM) (rough stub)

**Status:** rough stub for cross-slice coherence. Full plan + `judge`
gate land when slice 2 starts.

## Scope (one paragraph)

Add the Hosted runtime in Worker. Two big pieces: (1) the **Mailbox** —
a Postgres outbox table + queue consumer (Graphile Worker or pg-boss)
with ~60-second debounce and per-Thread coalescing of pending events
(comment / message / recheck) into batched turns. (2) the **Hosted
Agent SDK loop driver** — Worker spawns the Claude Agent SDK inside an
ephemeral VM (Fly Sprites if proven; simpler interim otherwise) per
turn. VM has egress allowlist (Anthropic + GitHub + Worker only).
Worker injects a short-lived scoped Anthropic API key + single-repo
git token. Loop runs, calls Worker's MCP endpoint for `tempo_*` tools,
rebuilds context per-turn from the artifact via `tempo_attach` (no
checkpoint saver). Workspace-level Hosted-enabled toggle gates whether
the Mailbox drains; Local-only Workspaces queue events with an "Agent
offline" badge until a Local Session reconnects. The runtime-routing
decision (§4 of `agent-harness.md`) flips per event.

## Directories `apps/worker/src/` gains

```
apps/worker/src/
├── (existing from 1b + 1c)
├── mailbox/
│   ├── queue.ts                  outbox table CRUD; debounce + coalescing rules
│   ├── consumer.ts               queue library consumer; drains per Thread
│   ├── scheduler.ts              future-dated rechecks (`scheduled_at`)
│   └── routing.ts                pure decision: is there an active Session?
│                                 Workspace Hosted enabled? wake / queue / drop?
├── hosted/
│   ├── runner.ts                 per-turn entrypoint: provision VM, drive SDK
│   │                             loop, tear down. Calls into mailbox/queue
│   │                             on completion.
│   ├── sdk-loop.ts               Claude Agent SDK driver. system prompt +
│   │                             tool registration + canUseTool hook +
│   │                             event forwarder to events-stream.
│   ├── subagents/                lazy: explorer (Haiku), critic (Haiku).
│   │                             Added when single-agent context bloats.
│   └── prompts/                  system prompt for planning behavior,
│                                 nudge formatting (lifted from agent CLI).
├── vm/
│   ├── provision.ts              Fly Sprites REST `exec` to start; clone repo
│   │                             with --depth 1 + filter; inject scoped tokens.
│   ├── egress.ts                 allowlist enforcement (verify only —
│   │                             actual enforcement is Fly's network policy).
│   ├── teardown.ts               kill key + git token + VM. No snapshot.
│   └── lifecycle.ts              per-turn vs per-thread-session policy hooks.
└── db-queries/
    └── mailbox.ts                outbox table queries (lifted into the
                                  packages/db/schema.ts).
```

## Database additions (`packages/db/src/schema.ts`)

- `mailbox_events` — `(id, thread_id, event_id, kind, payload_json,
  scheduled_at, drained_at, created_at)`. Idempotency on
  `(thread_id, event_id)`. New migration.
- `workspaces.hosted_enabled` — boolean, defaults false. Migration.
- `vm_runs` — `(id, thread_id, started_at, ended_at, exit_reason,
  cost_estimate_usd)`. For audit + cost visibility.

## Contract additions

- New event kinds in `@tempo/contracts/events` for hosted-runtime
  visibility: `hosted_turn_started`, `hosted_turn_ended`,
  `agent_tool_use` (already exists; reused), `mailbox_coalesced`.
- New HTTP route (Workspace admin in Console): toggle `hosted_enabled`.

## Forward-compat constraints on slices 1b + 1c

- `apps/worker/src/mailbox/`, `apps/worker/src/hosted/`,
  `apps/worker/src/vm/` are new siblings under `src/`. 1b and 1c must
  not collide on those names. Their `src/` layout has clean room for
  these.
- Worker's MCP endpoint registered in 1b serves both runtimes by 2.
  The Hosted SDK loop calls Worker's *same* MCP endpoint as the Local
  Agent (or shorter-circuits through in-process imports — TBD in slice
  2 plan). The 1b auth middleware should let the Hosted loop's calls
  authenticate (probably via a `localhost`-only internal bypass + the
  workspace's API key).
- The `tempo_attach` reading shape from 1b is reused verbatim — both
  runtimes rebuild context from the same artifact.

## Judge gate

Required (new product surface — VM provisioning, queue infra, Hosted
SDK loop, billing-affecting toggle). Full plan when slice 2 starts.
