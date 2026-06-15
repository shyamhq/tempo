# LangGraph / agent graph framework — should Tempo adopt one?

**Asked by Dev:** 2026-06-16 ~3:15am, before sleeping.
**Recommendation:** **No.** Stay with Claude Agent SDK + Postgres `LISTEN`/`NOTIFY`.

---

## What the Dev was asking

"Reading files, executing tools, doing web search seem like these are
different tools that call and maybe happen in some kind of graph. What do
you suggest?"

Translation: should the Hosted Agent's *internal* tool-dispatch be modelled
as an explicit graph (LangGraph, LangChain agents, AutoGen, Burr, etc.)?

## Why not

1. **The seam is already filled.** Inside the VM we run
   `@anthropic-ai/claude-agent-sdk`. The SDK *is* the agentic loop — model
   call → tool_use → tool_result → next model call → done. Its event
   iterator is the "graph traversal". LangGraph slotted in here means
   either:
   - Replace the SDK with LangGraph's Claude provider — lose the SDK's
     tool ergonomics, rebuild MCP wiring, lose the typed event callbacks
     we depend on for activity streaming (Task 2.6b).
   - Wrap the SDK in a LangGraph state machine — the SDK is already that
     state machine. "One adapter is hypothetical" (CLAUDE.md / judge P5).
2. **Tempo's orchestration shape is a queue + a process per item, not a
   graph.** Mailbox row arrives → supervisor provisions a VM → SDK runs a
   loop → MCP calls hit Worker → results come back. No branching across
   multiple models. No human-in-the-loop pauses mid-graph (the Dev's
   feedback arrives as a *new* Mailbox row, not as a callback into a
   suspended graph node). A queue + a per-item process is the right
   primitive.
3. **LangGraph's MVP cost is real.** Adding it means a dependency, a state
   schema, a persistence story for graph checkpoints, and a debugging
   surface (graph traces vs SDK transcripts). All of that is paid before
   we know if we need it.
4. **What we'd actually be reaching for.** When people say "graph", they
   usually mean *typed state machine for the lifecycle* — not the
   *tool-dispatch loop*. Tempo's lifecycle today is:
   `idle → provisioning → running → draining → teardown`. Five states.
   That's `switch` statement territory, or XState in ~200 LOC if it gets
   gnarly. Not LangGraph.

## When the answer flips

Revisit if any of these become true:

- We add a **second model provider** (e.g. GPT-4 for some tasks, Claude
  for others) and want a single orchestration layer that routes between
  them.
- We need **mid-graph human-in-the-loop pauses** where the *same Turn*
  blocks waiting for Dev input, instead of ending the Turn and waking on
  the next Mailbox row. (Today's design says: never block the Turn — end
  it and let the next event wake a new Turn.)
- We need **multi-agent fan-out with deterministic merge logic** that the
  Claude Agent SDK's native `Task` tool can't express. Slice 2's deferred
  parallel-sub-agent work might surface this — but if it does, the right
  answer is probably XState in the supervisor, not LangGraph in the loop.

## What to do instead, in priority order

1. **Trust the SDK.** Its event iterator gives us narration, tool calls,
   tool results, subagent dispatches — everything Tempo's activity feed
   needs.
2. **Keep the supervisor dumb.** A `Map<threadId, SandboxHandle>` and a
   `LISTEN mailbox` subscription. ~100 LOC at most.
3. **If the supervisor logic ever needs guards/retries that a switch
   can't express** → reach for **XState** (or hand-roll a typed
   transition table). NOT LangGraph.

## TL;DR

The thing the Dev was reaching for is real — orchestration deserves first
class thought — but the artifact they're imagining (a graph framework) is
the wrong shape for Tempo's workload. Use the SDK's loop for the agent,
Postgres `LISTEN`/`NOTIFY` for wake-up, and a five-state supervisor for
lifecycle. If any of those three primitives proves insufficient under
real load, the upgrade is targeted (state machine for the supervisor,
not a framework for everything).
