# CONTEXT.md — Tempo vocabulary

> **The vocabulary in this document is binding.** Use these words; do not invent synonyms. When you talk about Tempo's behaviour or its architecture, reach for these terms first. If a concept doesn't fit any of them, either (a) it really doesn't belong, or (b) we need a new term and this file needs an update — raise it.
>
> This document has two halves:
> 1. **Product vocabulary** — the user-facing concepts that describe what Tempo *is and does*. Sourced from D2 in the plan file.
> 2. **Architecture vocabulary** — the engineering concepts that describe how Tempo's code is *organised*. Sourced from the Pocock improve-codebase-architecture skill.

---

## 1. Product vocabulary (D2)

These are the words we use about the product — in code identifiers, in API names, in UI copy, in commit messages, in conversation.

### Agent
The local Claude Code instance running on the Dev's machine, driven over MCP. **The only LLM in the system** (D1). Spawned in-process inside the CLI via the Claude Agent SDK (T5).
**Avoid:** "AI", "bot", "assistant", "server-side LLM".

### Dev
The single human party in a Thread. Creates the Thread, runs the Agent, comments on the Plan, approves it. Solo (D7) in MVP — there is no second Dev on a Thread.
**Avoid:** "user", "human".

### Console
The web UI. **Thin client + coordination server**: renders Plan, accepts Comments, surfaces Clarification Rounds, holds the post-Approve handoff card. **No LLM lives here.** The Console's "server" half is a Next.js REST API + SSE endpoint + Drizzle/SQLite store — coordination and persistence only, no intelligence.
**Avoid:** "tool" (collides with MCP "tool calls"), "service", "backend" (the Console is one thing — the line between its UI and its API is internal).

### Thread
A single planning conversation about one bug or feature. Owns a Plan, a Comment stream, and zero-or-more Clarification Rounds. Persistent across many Sessions. Has two statuses: `unapproved` (live) or `approved` (frozen, handoff card visible). Reopenable after approval.

### Session
The live attachment of one Agent to one Thread. Ephemeral; a Thread outlives many Sessions. At most one Session in `connected` state per Thread (D8). Older Sessions get marked `disconnected` when a new one connects. Tokens are reusable across Sessions (T10).

### Plan
The single mutable markdown document the Agent produces and revises. The **deliverable**. One row per Thread; no versioning (D4). Free-edited by both Dev and Agent (D6); last-write-wins; the Agent must `tempo_pull_plan` before each edit.

### Comment
A Dev-authored note anchored to a quoted text range in the current Plan. Anchored via a Tiptap `CommentMark` carrying `commentId` (D5, T7). Has a flat list of Replies. Resolved exclusively by the Dev (D30; supersedes D16) — the Agent never marks a Comment resolved. The Dev can un-resolve. Append-only — no edit, no delete (D20). When the Plan changes and a Comment's anchor text no longer exists, the Comment stays in the live rail without an editor highlight; the Dev decides whether to Reply or Resolve.

### Reply
A flat-listed follow-up on a Comment. Either Dev or Agent can post. Agent Replies carry one of three payloads (D18): `text`, `edit_done`, or `edit_proposed`. Proposed edits surface inline Approve/Reject buttons; only Approve mutates the Plan (D18). Reject may carry an optional reason text (D23).

### Clarification Round
A structured batch of questions the Agent posts to the Dev (D10). Three question types (D14): `single_choice`, `multi_choice`, `open_text`. Choice questions may allow a `Other (specify)` write-in. All questions in a Round are required. At most one Round in `pending` state per Thread (D12); a pending Round blocks Plan and Comments via a modal (D13). Answered atomically.

### Handoff card
The post-Approve UI element: a card containing a Copy Plan button + a metadata header (Thread title + Thread URL) prepended to the copied markdown (D22). The Dev pastes the result into a fresh Claude Code session to begin execution. Tempo does not re-enter the picture after handoff (D3).

---

## 2. Architecture vocabulary (Pocock skills #1 + LANGUAGE.md)

Sourced from:
- <https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md>
- <https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/LANGUAGE.md>

> **From SKILL.md: "Consistent language is the point — don't drift into 'component,' 'service,' 'API,' or 'boundary.'"**
>
> Definitions below are quoted verbatim from LANGUAGE.md where the skill defines them. Tempo-specific examples follow each.

### Module
> "Anything with an interface and an implementation. Deliberately scale-agnostic — applies equally to a function, class, package, or tier-spanning slice."

In Tempo:
- Each MCP tool handler (`tempo_attach`, `tempo_poll`, etc.) is a module.
- Each Console API route handler is a module.
- The Tiptap `CommentMark` extension is a module.
- The CLI's HTTP client is a module.
- `packages/contracts` is a module (sub-modules: `mcp`, `http`, `events`).

### Interface
> "Everything a caller must know to use the module correctly. Includes the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics."

For Tempo, **Zod schemas are the canonical form of the interface's type-signature half** — both for MCP tools (input/output) and HTTP endpoints (request/response). The non-typed half of the interface — invariants, ordering, error modes — lives in code comments above the schema only when non-obvious. The interface is the test surface even when we have no tests (T12).

### Implementation
The code inside a module, distinct from its interface. Callers must not know or depend on it.

### Depth
> "A module is deep when a large amount of behaviour sits behind a small interface. A module is shallow when the interface is nearly as complex as the implementation."

Each MCP tool in Tempo is designed to be deep: one Zod schema in, one Zod schema out, with HTTP translation, error wrapping, and validation hidden inside. The Agent sees only `tempo_post_reply({ comment_id, payload })` — it does not know about `POST /api/threads/:tid/comments/:cid/replies`, retry logic, JSON parsing, or Pino log lines.

> "Depth is an interface property, not implementation detail."

### Seam
> "A place where you can alter behaviour without editing in that place. The location at which a module's interface lives."

> "Introduce seams only when variation actually exists." A seam becomes real **only when two or more adapters satisfy it** — one adapter is hypothetical.

Tempo's real seams today:
- `packages/contracts` defines schemas; both the Agent CLI (`apps/agent`) and the Console (`apps/console`) are adapters that consume them.
- The event-log interface (append + cursor-read) has two adapters: long-poll (Agent) and SSE (browser). Real seam.

Seams we **do not** create yet:
- An abstraction over Drizzle for "future Postgres swap" (T3 accepts rewriting when we get there).
- An abstraction over the Claude Agent SDK for "future Codex / Cursor support."

### Adapter
> "A concrete thing that satisfies an interface at a seam. Describes role (what slot it fills), not substance (what's inside)."

The long-poll Route Handler is an adapter for the event-log seam. The browser's `EventSource` consumer is the other adapter at the same seam.

### Leverage
> "What callers get from depth. More capability per unit of interface they have to learn."

`packages/contracts` is the highest-leverage module in Tempo: a few hundred lines that lock the entire wire protocol for both the Agent and the Console.

### Locality
> "What maintainers get from depth. Change, bugs, knowledge, and verification concentrate at one place rather than spreading across callers."

For Tempo: each MCP tool's handler, its Zod schema reference, and its server-side counterpart should be findable from one another within a couple of file hops. Cross-cutting "utilities" directories are smell unless leverage is overwhelming.

### The deletion test
> "If complexity vanishes, the module wasn't hiding anything. If complexity reappears across N callers, the module was earning its keep."

Apply this **before** adding any module / function / file. See AGENTS.md rule 10.

---

## 3. How we apply depth here

A few standing instructions for anyone writing code in this repo:

1. **Before adding any helper, file, or layer, apply the deletion test.** "If I deleted this, would complexity *concentrate* (good — keep it) or *scatter* across the callers (bad — delete it)?" Quote from the Pocock skill: *"the deletion test is the primary diagnostic — if deleting a module concentrates complexity in one place rather than scattering it, that module earned its keep."*
2. **Each MCP tool handler is a deep module.** Its interface is its Zod schema in `packages/contracts/src/mcp.ts`. Its implementation is HTTP translation + error wrapping. Do not leak HTTP details into the Agent side.
3. **The Console's API routes are deep modules.** Their interface is the HTTP shape in `packages/contracts/src/http.ts`. Their implementation is Drizzle queries + event-log append + (sometimes) long-poll suspension. Do not leak Drizzle types into the Agent side.
4. **One adapter ≠ a seam.** Do not introduce factory functions, dependency injection, or interface-implementation pairs for hypothetical second adapters. Wait for the real second adapter.
5. **Locality beats cleverness.** Co-locate. Keep the Tiptap `CommentMark` next to the Comment-related UI it serves, not in a generic `extensions/` directory.

---

## 4. When a term is missing

If you are writing code and the right word for a concept doesn't appear in this file, **stop and raise it**. Either the concept is wrong-shaped (try to make it fit a term we already have) or this file needs an addition (propose one). Do not silently introduce a new noun into the codebase.
