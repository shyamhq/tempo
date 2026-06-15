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
The LLM that produces Plans. **The only LLM in the system** (D1). Runs in one of two runtimes, chosen per Thread (never both):

- **Local Agent** — the [[Member]]'s own Claude Code binary on their machine. Two CLI subcommands surround it on the `tempo-agent` binary: `tempo-agent init` runs an OAuth-style browser login against [[Worker]] and saves a **User-scoped token** (`sk_user_*`) to `~/.tempo/credentials.json` (mode 0600, one-time per User per machine, no repo files). One token covers every [[Workspace]] the User belongs to — Workspace context derives from the [[Thread]] per-call via a membership check at Worker's route boundary, not from the token. `tempo-agent connect <thread-id>` is per-session — reads creds, refreshes if expired, runs a preflight Thread-access check (403 with `not_a_member` if the User isn't a Member of the Thread's Workspace), writes an ephemeral `.mcp.json` to `/tmp/`, spawns `claude --output-format stream-json --mcp-config <tmp> --print "/tempo-plan <thread-id>"`, and tees the JSONL stdout to Worker so the activity feed sees tool calls, Agent Narration, thinking, and text deltas (which PreToolUse hooks cannot see). We do not embed an inference loop here — claude owns its key and runs autonomously; the wrapper is a process spawner + stdout fan-out. The inference budget is the Member's. Nothing is written to the repo at any point.
- **Hosted Agent** — the Claude Agent SDK loop running inside a per-session ephemeral VM, driven by [[Worker]]. Owns async work (comments while no Local Agent is connected, scheduled rechecks, post-approve writes).

Both runtimes speak the same `tempo_*` MCP contract against [[Worker]]. A tool written once works in either.
**Avoid:** "AI", "bot", "assistant", "server-side LLM".

### Workspace
The top-level team container. Backed by a Clerk Organization. Owns Threads, the Agent API key, and (going forward) per-Workspace Connector enablement + per-Member Connector grants. Members have a role: `org:admin` or `org:member`. One Workspace owns many Threads; one human can belong to many Workspaces.
**Avoid:** "team", "org", "tenant" (Workspace is the noun).

### Member
A human who belongs to a Workspace. Identified by their Clerk user id. Has a Workspace-scoped role (`admin` or `member`). Admins can manage members, rotate the Agent API key, rename or delete the Workspace; members can do everything Thread-level. Connector grants are Member-scoped: when the Agent calls a connector tool, Worker resolves the grant tied to the Member who initiated the turn (see [[Connector]] + the connector-identity rule).
**Avoid:** "user", "teammate", "collaborator".

### Dev
A Member acting on a Thread. Any Member of the owning Workspace can participate on any of its Threads — create, comment, reply, approve. The Dev role is per-action, not per-Thread: a single Thread can have one or many Devs over its lifetime. Each Comment, Reply, Discussion Message, and Approve action records the acting Member's id. (This supersedes the original D7 "single human party / solo" framing; multi-Member Threads shipped in Phase 3.)
**Avoid:** "user", "human" (Member is the persistent noun; Dev is the role-on-Thread).

### Console
The web UI plus its browser-facing REST + SSE server. Next.js (App Router) on Postgres via Drizzle. Renders the Plan, accepts [[Dev]] edits, surfaces [[Comment]]s and the [[Discussion]] (including [[Agent]] question batches inline), holds the post-Approve [[Handoff card]], and exposes the admin surface for [[Workspace]] members + [[Connector]] enablement. **Does not host the `tempo_*` MCP endpoint** — that's the [[Worker]]. **No LLM lives here.**
**Avoid:** "tool" (collides with MCP "tool calls"), "service", "backend" (the Console is one thing — the line between its UI and its API is internal).

### Worker
The privileged backend app. Separate process from [[Console]]; the two share the same Postgres but play different roles. Hosts: the unified `tempo_*` MCP endpoint that both [[Agent]] runtimes call, the [[Gateway]] responsibility (allowlist + approve-gate + token resolution + execution + provenance + redaction + audit), the [[Mailbox]] queue with debounce/coalescing, the Hosted-Agent SDK loop driver, and VM provisioning + teardown for the Hosted runtime. **The Worker never runs Agent-generated code** — that runs in the [[VM]].
**Avoid:** "server", "backend", "API" (these belong to [[Console]] when used at all).

### Gateway
The responsibility inside [[Worker]] that fronts every `tempo_*` MCP call. For each call: (1) checks the per-Thread [[Allowlist]]; (2) for connector-write tools, enforces the [[Approve-gate]]; (3) resolves the right [[Grant]] from [[Nango]] given the Connector's declared auth mode and the turn-initiator [[Member]]; (4) executes the third-party call itself (does not delegate execution to the VM or Nango's proxy); (5) stamps results with provenance so the [[Agent]] can cite sources in the Plan; (6) redacts secrets before results stream to Console; (7) writes an immutable audit row. Plan-write and conversation tools also flow through Gateway but are subject only to (1) — they're always allowed during drafting and frozen on Approve. The Gateway is *not* a generic tool router and does *not* execute repo I/O (that's the VM's job, direct to GitHub).
**Avoid:** "router", "proxy", "tool service".

### Connector
A third-party service that the [[Agent]] reads from or writes to through the [[Gateway]]. Examples: GitHub, Linear, Notion, Sentry, Slack. Each Connector module declares its **auth granularity**:
- **Workspace-scoped** — one [[Grant]] per [[Workspace]]; admin connects once and all [[Member]]s benefit (e.g. GitHub App installation, Notion internal integration).
- **Member-scoped** — one Grant per Member per Workspace; each Member onboards individually and the Gateway resolves by turn-initiator (e.g. Linear, GitHub user OAuth).
- **Hybrid** — both grants coexist; the specific tool implementation picks which based on intent (e.g. GitHub: installation token for repo clone, user token for "Alice opened this PR"; Slack: bot token for workspace posts, user token for personal DMs).

Connectors must be **enabled** at the [[Thread]] level (the [[Allowlist]]); connector-**write** tools are denied during drafting (the [[Approve-gate]]). Each Connector is implemented behind one of three backends (first-party MCP via DCR, an aggregator, or hand-rolled REST) — the backend is an implementation detail invisible to the Agent.
**Avoid:** "integration" (overloaded), "service", "provider".

### Grant
A single stored OAuth installation, refresh token, or API key authorising calls to one [[Connector]]. Lives in [[Nango]], keyed by a `connectionId` whose structure encodes the auth mode: `workspace_id` for Workspace-scoped grants, `workspace_id:user_id` for Member-scoped grants. Hybrid Connectors hold two grants per Workspace × Member. Grants never enter the [[Console]], the [[VM]], or any log line; they are resolved and used inside [[Gateway]] only.
**Avoid:** "token" (overloaded with workspace API key), "credential".

### Nango
The self-hosted OAuth + token vault we run inside our VPC. Handles the OAuth dance, stores [[Grant]]s, refreshes them. **Auth only** — Nango never executes a third-party API call on our behalf. The [[Gateway]] pulls a Grant from Nango, then makes the call itself (audit + redaction + data path stay in code we own; post-Composio-breach posture).
**Avoid:** "broker", "vault" alone (Nango is the noun).

### Mailbox
The per-Thread outbox [[Worker]] writes to whenever a Dev event arrives on a Thread that has no fresh Local [[Session]] and whose [[Workspace]] has Hosted enabled. One row per pending event (Comment, Reply, Discussion Message, Recheck) with an idempotency key on `(thread_id, event_id)`. Implemented as a Postgres table with `pg_notify` for live wake-up + 5s polling fallback. **No pre-debounce** — fires the [[Hosted Agent]] as soon as the first row lands; the running [[VM]]'s in-Turn poll loop naturally batches stragglers, and the post-Turn keep-alive (~10 min idle) coalesces follow-up events without paying a cold-start. Scheduled rechecks (e.g. "agent revisits this in 2 hours") are Mailbox rows with a future `scheduled_at`.
**Avoid:** "queue" alone (the Mailbox is the Hosted wake-up surface, not a generic queue), "inbox" (collides with notifications).

### Thread
A single planning conversation about one bug or feature. Owned by a [[Workspace]]; visible and editable by any [[Member]] of that Workspace. Records a creator (the Member who opened it) but does not gate participation on it. Owns a Plan, a Comment stream, and a Discussion. Persistent across many Sessions. Has two statuses: `unapproved` (live) or `approved` (frozen, handoff card visible). Reopenable after approval.

### Session
The lifetime of one `tempo-agent connect` invocation — the live attachment of one **Local [[Agent]]** to one [[Thread]]. Ephemeral; a Thread outlives many Sessions. The [[Hosted Agent]] does not create Sessions — it consumes [[Mailbox]] events inside its [[VM]] and goes away when the VM tears down. Status: `fresh` (the CLI is holding a live SSE connection to [[Worker]]) or `stale` (no SSE connection). Worker tracks fresh Sessions in an in-memory registry keyed by `thread_id`; it uses that to route incoming Dev events — any fresh Session for the Thread → Local handles via event-log + SSE wake-up; otherwise → enqueue in Mailbox so the Hosted Agent picks up (if the [[Workspace]] has Hosted enabled). One Session contains many [[Turn]]s (one per Claude run). At most one fresh Session per Thread (D8 still holds for Local). API keys are reusable across Sessions (T10).

### Turn
One spawned Claude run inside a [[Session]] (Local) or inside a [[VM]] (Hosted). Many Turns per Session / VM lifetime. **Local**: the initial Turn spawns `claude --print "<thread-id>"`; subsequent Turns are *nudged* — the CLI spawns `claude --resume <claude-session-id> --print "<nudge>"` whenever new Dev events arrive on the SSE stream. The nudge carries the event cursor so Claude doesn't have to remember it across `--resume`. **Hosted**: the SDK loop's `tempo_poll`-style wake → process events → SDK signals done cycle is one Turn; the VM keeps polling the [[Mailbox]] for the next one until the keep-alive window expires. Events that arrive mid-Turn queue (CLI in-memory for Local, Mailbox rows for Hosted) and drain immediately into the next Turn — no pre-debounce.
**Avoid:** "run", "invocation" alone (Turn is the unit; both Local and Hosted speak in Turns).

### Plan
The single mutable markdown document the Agent produces and revises. The **deliverable**. One row per Thread; no versioning (D4). Free-edited by both Dev and Agent (D6); last-write-wins; the Agent must `tempo_pull_plan` before each edit.

### Comment
A Dev-authored note anchored to a quoted text range in the current Plan. Anchored via a Tiptap `CommentMark` carrying `commentId` (D5, T7). Has a flat list of Replies. Resolved exclusively by the Dev (D30; supersedes D16) — the Agent never marks a Comment resolved. The Dev can un-resolve. Append-only — no edit, no delete (D20). When the Plan changes and a Comment's anchor text no longer exists, the Comment stays in the live rail without an editor highlight; the Dev decides whether to Reply or Resolve.

### Reply
A flat-listed follow-up on a Comment. Either Dev or Agent can post. Replies are plain markdown text — no structured payload. If the Agent wants the Dev to sign off on a Plan change before making it, it writes the suggestion in prose and waits for a text reply; once the Dev confirms, the Agent edits the Plan with `tempo_write_plan` and posts a Reply describing what changed. The conversation is the protocol.

### Discussion
A singleton (one per Thread) free-form channel between Dev and Agent for unanchored, approach-level talk — questions about the approach, the codebase, the Agent's reasoning. Distinct from Comments (which are anchored to a Plan text range). Append-only stream of Messages. Frozen when the Thread is `approved` and unfrozen on Reopen — same lifecycle as Plan + Comments. Stays in the Thread; not part of the handoff payload (D3). Lives in a toggleable left-side panel in the Console.

### Message
One entry in a Discussion. Authored by Dev or Agent. Carries free-form `text`, an inline batch of structured `questions` (Agent-only — the Console renders these as a stepper card; the Dev's reply lands as the next text Message), or both. Rounds are not a separate entity — an Agent question batch is one Message that happens to carry `questions`. Append-only (D20). Rendered with the same markdown pipeline as Reply text (`MarkdownText`). Three question types: `single_choice`, `multi_choice`, `open_text`; choice questions may allow a `Other (specify)` write-in.

### Attachment
An image bound to a Discussion Message or a Reply, addressable by id, stored in an S3-compatible bucket under the key `<thread_id>/<id>`. Surfaces in the wire contract as an `AttachmentRef` (id + mime + byte length + signed read URL + expiry). Lives at: `packages/server/src/attachments.ts` (server-domain), `packages/server/src/r2.ts` (storage adapter), `apps/console/components/thread/attachments/` (UI).
**Avoid:** "file", "upload", "asset", "media", "blob".

### Agent Narration
The Agent's inline prose within a single turn, emitted between tool calls (e.g. *"Plan looks right; let me verify the auth wiring."*). Distinct from a **Message** (Dev↔Agent dialog channel) and from a **Reply** (anchored follow-up on a Comment). Surfaced only by the `stream-json` driver (T?? D??); the PTY driver doesn't produce it because PreToolUse hooks can't see assistant text. Ephemeral by UX — shown in the floating Activity widget for the active turn — but persisted in the event log alongside `agent_tool_use`.

### VM
The isolation boundary the [[Hosted Agent]] runs in. One **E2B Sandbox** (Firecracker microVM under the hood) per Hosted Session per [[Thread]]. Egress allowlisted via E2B's `allowOut` to exactly three destinations: the Anthropic API, GitHub, and [[Worker]]. Per-second billed (~$0.05/hr per 1 vCPU); ~10 minute idle keep-alive then teardown (E2B's `timeoutMs` is the backstop if our supervisor misses it). Scratch disk + short-lived API key + GitHub App installation token (minutes TTL) all die on teardown. Cold start ~80ms same-region. Always provisioned at Hosted Session start — repo clone (`git clone --depth 1 --filter=blob:none`) inside the Sandbox is *conditional* on whether the [[Thread]] is repo-linked. Continuation across teardown happens via the artifact (Plan + Comments + Discussion) — a fresh Sandbox calls `tempo_attach` and rebuilds context from the persisted state, never from a process snapshot.
**Avoid:** "container", "runner", "Fly Machine" (VM is the term in this codebase; the implementation today is an E2B Sandbox, but the noun is stable across provider swaps).

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
