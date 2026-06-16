# Plan: cut per-turn input bloat in the Hosted runner

## Problem

The Hosted runner currently sends a **full hydration JSON every Turn**, even when the wake event is a single Comment Reply like "thanks":

- `apps/worker/src/hosted/runner.ts:225-229` builds a user message containing `{thread_id, events, context}` and pushes it into the persistent `history` array (`runner.ts:214`, `runner.ts:230`, `runner.ts:277`) — so each Turn's full payload **stays in the prompt forever**.
- The `context` field is the result of `getTurnHydration()` (`packages/server/src/mailbox.ts:74-99`) which returns verbose contract shapes: full `Comment` rows including `plan_context` (the surrounding paragraph), `thread_id`, `created_at`, `Reply.comment_id`, attachment URLs with expirations; full `DiscussionMessage` rows; `last_event_id` cursor; `thread.id` redundant with the envelope.
- Anthropic's ephemeral prompt cache (`runner.ts:243`) covers the system prompt + tool defs but **not** the per-Turn user message — it's a fresh write every Turn. Slimming it = real input-token saving.

By Turn 5 of a session, the same Plan blocks have been transmitted 5 times. For a "thanks" wake, ~95% of the payload is state the model already has in its message history.

## The change

**Turn 1:** lean snapshot via slimmed `TurnHydration`.
**Turn 2+:** events only — no `context` field. The model has Plan/Comments/Discussion in `history` from Turn 1; the `events` array is the delta.

## Files

### 1. `packages/server/src/mailbox.ts`

Replace `TurnHydration` with a slim shape and rewrite `getTurnHydration()` to map verbose contract types into it. Drop the unused `latestEventId` import.

**Dropped fields:**

| Field | Why |
|---|---|
| `thread.id` | envelope already carries `thread_id` |
| `last_event_id` | worker-internal cursor; agent never reads it |
| `Comment.thread_id`, `Comment.plan_context`, `Comment.created_at` | redundant (parent envelope), verbose (agent has plan blocks), encoded by array order |
| `Reply.comment_id`, `Reply.attachments`, `Reply.created_at` | nested under parent comment; reply-attachment functionality is not a discussion feature; array order |
| `DiscussionMessage.thread_id`, `DiscussionMessage.created_at` | redundant; array order |

**Kept fields:**

| Field | Why |
|---|---|
| `thread.{title, description, status}` | frames the work and gates approved-Thread quiet mode |
| `plan.blocks[].{id, html}` | only addressable Plan state |
| `Comment.{id, plan_quote, anchor_block_id, resolved_by, replies[].{id, author, text}}` | `plan_quote` IS the highlighted anchor text the dev selected |
| `DiscussionMessage.{id, author, text, questions, attachments}` | **attachments restored** — Discussion supports image attachments, agent has vision |

### 2. `apps/worker/src/hosted/runner.ts`

- `runTurn` gains 4th param `isFirstTurn: boolean`.
- `userMessage` becomes `{thread_id, events, context: isFirstTurn ? drain.context : undefined}`.
- `main()` call site: `await runTurn(drain, toolset.tools, turnAnthropic, turnCounter === 1)`.

### 3. `apps/worker/src/hosted/prompt-hosted.ts`

Rewrite "Your input each Turn":

- Document the slim shape (no `thread.id`, no `last_event_id`, slim Comment/Discussion).
- "`context` is sent **only on Turn 1**. On subsequent Turns it's absent — the Plan / Comments / Discussion you saw on Turn 1 are still in your message history; `events` carries the delta of what the Dev just did."
- Scope the first-draft-mode rule to Turn 1: "On your first Turn, if `context.plan.blocks` is empty or absent, you're in first-draft mode."
- **Add a stale-Plan refresh rule** (mitigates Uncertainty #1 — sparse `plan_edited_by_dev` payload):

  > **Stale-Plan refresh.** The `plan_edited_by_dev` event carries only `updated_at` — no block diff. If `events` contains it AND `context` is absent (Turn 2+), call `tempo_pull_plan` to refresh your view of the Plan **before** reasoning about Plan state. This is in addition to the existing rule that you call `tempo_pull_plan` before every edit batch. On Turn 1 (`context` present) skip the refresh — `context.plan.blocks` is already current.

  One MCP roundtrip on Plan-edit wakes; every other wake type keeps the slim-shape savings.

- Update the existing "first-draft vs iteration" wording at the current `prompt-hosted.ts:94` ("Call `tempo_pull_plan` before every edit batch.") so the new rule reads as an addition, not a contradiction.
- Remove the obsolete `last_event_id` reference at current `prompt-hosted.ts:39` and re-check the "Do not call tempo_attach" sentence at current `prompt-hosted.ts:43` still scans under the new shape.

## Concrete examples

**Turn 1** (dev clicks Run Hosted Agent on a thread with 3 plan blocks, 1 open comment with 1 dev reply, 1 discussion message; wake event = the comment that triggered the run):

```json
{
  "thread_id": "thr_abc",
  "events": [
    { "kind": "comment_added", "comment": { /* full contract Comment */ } }
  ],
  "context": {
    "thread": { "title": "Add login flow", "description": "...", "status": "draft" },
    "plan": { "blocks": [ {"id":"blk_1$","html":"..."}, {"id":"blk_2$","html":"..."}, {"id":"blk_3$","html":"..."} ] },
    "comments": [
      {
        "id": "cm_1",
        "plan_quote": "POST /auth/login",
        "anchor_block_id": "blk_3$",
        "resolved_by": null,
        "replies": [ {"id":"rpl_1","author":"dev","text":"should this use bcrypt or argon2?"} ]
      }
    ],
    "discussion": {
      "messages": [
        {
          "id":"msg_1","author":"dev",
          "text":"starting on this — open questions in comments",
          "questions":null,"attachments":[]
        }
      ]
    }
  }
}
```

**Turn 2+** (dev replies "thanks"; runner already alive):

```json
{
  "thread_id": "thr_abc",
  "events": [
    {
      "kind": "comment_replied",
      "comment_id": "cm_1",
      "reply": { "id":"rpl_2","comment_id":"cm_1","author":"dev","payload":{"text":"thanks"},"attachments":[],"created_at":"2026-06-16T16:30:00Z" }
    }
  ]
}
```

`context` is absent. ~300 bytes vs Turn 1's ~2KB in this minimal scenario; 20-50× savings on a real thread.

**Note on event payloads:** events still carry their full contract shape (e.g., the `comment_replied` event wraps a full Reply with `comment_id`, `attachments`, `created_at`). Slimming events is a separate, larger change that would touch SSE consumers — out of scope.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| **Delete `context` entirely; have the agent read "all events since thread creation" on Turn 1 as a replay log.** | For an active thread, event replay is fatter than a snapshot (every `comment_added` wraps the full Comment with all its replies; every `plan_block_added` wraps the full HTML). Snapshot wins on length. |
| **Send a delta `context` every Turn** (worker computes "what changed since last drain"). | Forces stateful drain (must remember per-thread last-sent state). Wipes out the stateless `getEventsSinceLastTurn` floor query already shipped. The model's own `history` is already a perfect delta record — free. |
| **Gate `context` at the drain handler via a `?first=1` query param.** | Spreads the "first turn" policy across two services. Runner already tracks `turnCounter`; drain is stateless per request. Localize the gate in the runner. |
| **Mutate `history[0]` to strip `context` after consumption to reduce retransmit size.** | Saves bytes on retransmit only. Anthropic bills input tokens once when sent; doesn't help the "thanks" turn at all (that Turn isn't re-sending Turn 1's payload — Turn 1 is already in history). |

## Layer assignment

No new modules or files. All edits touch existing layers correctly:

| Edit | Layer | Justification |
|---|---|---|
| `packages/server/src/mailbox.ts` | server module / DB reader | `getTurnHydration` is already a reader; this trims its return shape. No business rule change, no side effect. |
| `apps/worker/src/hosted/runner.ts` | worker / runtime loop | `isFirstTurn` is runtime control flow — `turnCounter` already lives here. |
| `apps/worker/src/hosted/prompt-hosted.ts` | worker / runtime prompt | The runner owns its own system prompt. |

## Deletion test

- **Slim TurnHydration shape:** if deleted (revert to bloated), the bytes-per-Turn cost returns. Each dropped field earns its absence via visible token savings (the JSON-stringify size collapses).
- **`isFirstTurn` gate:** if deleted, the multi-Turn retransmit cost returns. Each "thanks" Turn would re-ship the snapshot.
- **Prompt rewrite:** if deleted, the agent's documented contract diverges from the wire reality; either it makes deleted-tempo_attach calls (fails) or invents fields that aren't there.

None of the three are pass-through. All three earn their place.

## Uncertainties

- **Event payload coverage.** Traced every wake-eligible variant in `packages/contracts/src/events.ts`:
  - `comment_added` (line 18) — full `Comment`. ✓
  - `reply_added` (line 23) — `comment_id` + full `Reply`. ✓
  - `discussion_message_posted` (line 108) — full `DiscussionMessage`. ✓
  - `status_changed` (line 39) — `from` + `to` ThreadStatus. ✓
  - `comment_resolved` / `comment_unresolved` / `comment_deleted` (lines 45–58) — `comment_id` only. Fine: each mutates a single field (`resolved_by` flip, or drop) on a Comment the agent already has from Turn 1's `context.comments[]`.
  - `thread_renamed` (line 113) — new `title`. ✓ Single-field mutation.
  - `agent_cancel_requested` (line 120) — control flow, not state.
  - **`plan_edited_by_dev`** (line 29) — only `updated_at`, **no block delta**. This IS the gap the judge flagged; mitigated by the stale-Plan refresh rule added to the prompt above (call `tempo_pull_plan` when this event arrives on Turn 2+).

- **Discussion attachments shape on the wire.** Restoring `AttachmentRef[]` keeps presigned R2 URLs with `expires_at` in the JSON. URLs typically expire in ~1h; a long-running Turn could see them go stale mid-Turn. This already exists in the current system — not made worse — and the agent's vision tool calls happen synchronously within the Turn. Flagging in case it bites.

- **`resolved_by` on the slim Turn 1 shape.** Verified at `packages/server/src/comments.ts:61` — `listCommentsForThread` returns **all** comments (no resolved filter). So `resolved_by: 'dev' | null` is a live field on Turn 1, not dead. Keeping it.

- **Session restart semantics.** `history` is module-scope `const history: ModelMessage[] = []` (`runner.ts:214`). It's gone with the process. New sandbox = fresh `turnCounter` starting at 0 = first wake fires Turn 1 with full hydration. Confirmed correct.

## Judge / destructive-action gate

Per CLAUDE.md the judge runs on contract changes in `packages/contracts/**`, DB migrations, destructive actions, new product surfaces, new dependency surfaces, or material pivots. This plan is **none of those** — it slims an internal worker↔runner wire shape defined in `@tempo/server`, gates one parameter in the runtime loop, and updates the system prompt. CLAUDE.md guidance for boundary cases: "default to skip and proceed."

**The Dev explicitly asked for judge approval on this plan**, so we are running it anyway. No destructive action requires acknowledgment.

## Verify

- `bun run typecheck` — catches the drain route consuming the slim shape and the runner call site arity.
- Boot a fresh hosted session, observe `[usage] in=` lines in the worker log — Turn 1 should show the snapshot tokens; Turn 2+ on a "thanks" wake should show a fraction of Turn 1's input tokens.

## Review pipeline

After implementation: parallel-dispatch `code-simplifier:code-simplifier` and `everything-claude-code:code-reviewer` (both on Sonnet, single message, two `Agent` tool calls). Address findings inline; file anything noticed-but-out-of-scope under `AGENTS.md` → "Spotted but not fixed." No commit without Dev approval.
