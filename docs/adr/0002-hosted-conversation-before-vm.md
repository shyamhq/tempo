# ADR 0002 — Hosted conversation runs in the Worker until a repo is attached

**Status:** Proposed, 2026-06-20
**Decision driver:** Repo-gated VM provisioning + per-Thread GitHub repos (plan: `docs/plans/hosted-conversation-before-vm.md`).

## Decision

A Hosted Thread provisions an E2B VM **only when it has linked repos**
(`threads.repos` non-empty). With no repo, the planning conversation runs
**in-process in the Worker** — a per-wake, stateless `streamText` turn that
rebuilds its history from the persisted Discussion. The VM path is unchanged and
reached only when repos exist. Attaching a repo emits a `repo_linked` wake event;
the next wake routes to a fresh VM that hydrates the same Discussion (no process
handoff). The provisioning trigger is programmatic (the `repos` predicate), never
an LLM decision.

## Context

The VM exists to clone a repo and run repo I/O; with no repo it isolates nothing
— the agent only calls in-Worker `tempo_*` tools and web search. Always
provisioning burned cost + cold-start on pure-conversation Threads and produced
the blank "Provisioning…" hang.

## Why this shape

- **Keep-alive earns its keep only when in-context state is expensive to rebuild
  (repo exploration).** The no-repo conversation's state is fully captured by the
  persisted Discussion, so it runs per-wake — and that makes the transition to a
  VM free: both runtimes hydrate from the same artifact, nothing to hand off.
- **The Worker already drives the Hosted loop**, so running a repo-less turn
  in-process is a function call, not new infrastructure.

## Considered alternatives

- **Always provision, skip clone when no repo** — keeps cold-start/cost/stuck-
  spinner for zero isolation benefit.
- **Kept-alive in-process loop** — imports the runner's keep-alive machinery to
  amortize a cost (provisioning) the in-process path doesn't pay.
- **LLM decides when to provision** — a clean boolean (`repos` non-empty) exists;
  an LLM gate adds cost and both failure modes (provision when not needed / fail
  to provision when needed).

## Consequences

- The Worker process now runs LLM turns for repo-less Threads. Concurrency is
  capped and serialized per-thread.
- **Multi-container:** coordination lives in Redis (per-thread turn lock,
  presence) and Postgres (`vm_runs` + a partial unique index `WHERE ended_at IS
  NULL`, the event log as re-drain source) — never in a single container's RAM.
  The single-process boot orphan-sweep in `startSupervisor` is **removed**; VM
  reap authority becomes E2B's wallclock, refreshable by any container via
  reconnect-by-`sandbox_id`.
- Presence for a no-repo Hosted Thread is a read-path override
  (`hosted && repos empty → present`), since the in-process agent holds no SSE
  connection.

## Supersedes

The `CONTEXT.md` **VM** term's "Always provisioned at Hosted Session start" — now
"provisioned only when the Thread has linked repos."
