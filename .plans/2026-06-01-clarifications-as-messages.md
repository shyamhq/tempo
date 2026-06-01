# Collapse clarification rounds into Discussion messages

## Problem

Today the Agent has two parallel ways to talk to the Dev:

1. `tempo_post_discussion_message({ text })` — free-form chat.
2. `tempo_ask_clarifications({ questions })` → returns `round_id` → `tempo_get_clarification_answers(round_id)` returns `{ status: 'pending' }` or `{ status: 'answered', answers }` → Agent decides what to do next.

That second path drags real machinery with it: a `clarification_rounds` table, a per-question answers table, three HTTP routes (`POST /api/threads/:id/clarification-rounds`, `GET /api/clarification-rounds/:id`, `POST /api/clarification-rounds/:id/answers`), two event types (`round_opened`, `round_answered`), MCP error codes (`round_already_pending`, `round_pending`, `round_not_found`), a `PendingRound` primitive on `GetThreadResponse` and `AttachOutput`, and a `RoundCard` component in the Console. The Console renders the round as a parallel concept too — a stepper card that is its own entity in the panel, not a message.

The mental model is wrong. **A round is just an Agent message with a different UI.** The Agent posts; the Console renders structured input instead of prose; the Dev submits; the submission is the next message in the timeline. There is no separate lifecycle.

Two follow-on consequences of the wrong model:

- **The composer goes dead while a round is pending.** The Dev wants to push back ("you should also think about Redis instead of Postgres") but can't, because the round is modal. The whole point of a planning Agent is that the Dev can interrupt and redirect — disabling the composer fights that.
- **Withdrawal needs its own protocol.** If the Dev does interrupt, the round either sits stuck "pending" forever or we invent a `tempo_withdraw_round` tool. Both are symptoms of treating the round as a separate entity instead of as a message that gets superseded by the next one.

## Smallest concrete change

The whole shape collapses to: **a Discussion message can carry optional `questions[]`. That's the only new thing.**

### Data (`apps/console/db`)

- Drop `clarification_rounds` table.
- Drop the per-question answers table (the table that today holds the Dev's `Answer[]` keyed by `round_id`).
- Drop any FK on `discussion_messages` pointing at `clarification_rounds` (if one exists).
- Add `questions: JSON | null` column to `discussion_messages`. Embedded shape matches the Zod `Question` schema with server-assigned ids.
- Make the existing `text` column nullable on `discussion_messages` (today the message read-shape requires `text`; after this change a message can have only `questions` and no `text`).

One Drizzle migration. Local DB gets wiped (`rm apps/console/data/tempo.db && bun run --filter @tempo/console db:migrate`). No production data to back-fill.

### Contracts (`packages/contracts`)

Primitives removed from `primitives.ts`:

- `RoundId`, `RoundStatus`, `Answer`, `PendingRound`.

`QuestionInput` and `Question` stay (they describe the structured ask) — they're reused inline on `DiscussionMessage`.

`DiscussionMessage` shape changes in `primitives.ts`:

```ts
export const DiscussionMessage = z.object({
  id: MessageId,
  thread_id: ThreadId,
  author: Actor,
  text: z.string().min(1).max(8_000).nullable(),
  questions: z.array(Question).nullable(),
  created_at: IsoTimestamp,
});
```

Invariants enforced server-side (not at the schema level): exactly one of these must be true for any persisted message — `text != null`, `questions != null`, or both. Empty messages are rejected. Agent-only authors may set `questions`.

`PostDiscussionMessageInput` in `http.ts` changes from `{ text }` to:

```ts
export const PostDiscussionMessageInput = z.object({
  text: z.string().min(1).max(8_000).optional(),
  questions: z.array(QuestionInput).min(1).max(10).optional(),
}).refine(
  m => m.text !== undefined || m.questions !== undefined,
  'message must carry text, questions, or both',
);
```

`PostDiscussionMessageOutput` unchanged: `{ message_id }`.

MCP shapes removed from `mcp.ts`:

- `AskClarificationsInput`, `AskClarificationsOutput`.
- `GetClarificationAnswersInput`, `GetClarificationAnswersOutput`.
- `McpTool` enum entries: `'tempo_ask_clarifications'`, `'tempo_get_clarification_answers'`.
- `McpErrorCode` entries: `'round_already_pending'`, `'round_pending'`, `'round_not_found'`.

`AttachOutput` in `mcp.ts` — drop the `pending_round: PendingRound.nullable()` field.

HTTP shapes removed from `http.ts`:

- `OpenRoundResponse` (used by the deleted route).
- Anything referencing the deleted `/api/threads/[id]/clarification-rounds` and `/api/clarification-rounds/[id]` routes.

`GetThreadResponse` in `http.ts` — drop the `pending_round: PendingRound.nullable()` field.

Events in `events.ts`:

- Remove `RoundOpenedEvent` and `RoundAnsweredEvent`.
- Remove `'round_opened'` and `'round_answered'` from the `EventKind` enum and the `Event` discriminated union.
- `DiscussionMessagePostedEvent` already carries `message: DiscussionMessage`. Because `DiscussionMessage` now includes optional `questions[]`, the event automatically carries them. No new event type to wire up.

### Console routes (`apps/console/app/api`)

- Delete `app/api/threads/[id]/clarification-rounds/route.ts`.
- Delete `app/api/clarification-rounds/[id]/route.ts`.
- Delete `app/api/clarification-rounds/[id]/answers/route.ts`.
- `app/api/threads/[id]/discussion/messages/route.ts` — parse body via the new `PostDiscussionMessageInput` (the route handler today imports `CreateDiscussionMessageRequest` from `@tempo/contracts/http`; either rename that symbol to `PostDiscussionMessageInput` in place or update its definition to the new shape — pick one during implementation, just don't leave the handler validating with the old `{ text }`-only shape). Call the server module, return `{ message_id }`. No business-rule validation in the handler — it stays thin.
- `app/api/threads/[id]/state/route.ts` (or wherever `GetThreadResponse` is assembled) — drop the line that fetches and includes `pending_round`.
- `app/api/sessions/[id]/state/route.ts` — drop the line that fetches and includes `pending_round` on `AttachOutput`.

### Console server modules (`apps/console/server`)

- Delete the rounds module (whichever file owns round creation and answer recording — likely `server/rounds.ts` based on the AGENTS.md phase plan, but the actual filename should be confirmed during implementation).
- The module that owns Discussion message insertion (likely `server/discussion.ts`, again to confirm) is extended to:
  - Accept `questions?: QuestionInput[]`.
  - Enforce the business rule: if `author === 'agent'`, `questions` may be set; if `author === 'dev'`, `questions` must be null. Rejected as an error from the server module, not from the route handler.
  - Server-assign each question an `id` on insert.
  - Persist `questions` as JSON. Emit `discussion_message_posted` with the full message (including `questions`).
  - Delete the pre-existing block in `postMessage` that queries `clarification_rounds` to gate Dev messages — that table is gone, and the gate is replaced by client-side live-card derivation.
- `server/initial-prompt.ts` — update the Agent prompt: describe `tempo_post_discussion_message` as the single tool for both prose and structured clarifications; drop references to `tempo_ask_clarifications` and `tempo_get_clarification_answers`.
- Anything in `server/state.ts` (or equivalent) that assembles `pending_round` for the thread/session response: delete that read path.

### Agent (`apps/agent`)

- `src/http-client.ts` — delete `openRound` and `getRoundAnswers` methods (lines 52–68 today). Extend `postDiscussionMessage` to accept `{ text?, questions? }` and post the combined body. The method's HTTP path is unchanged.
- `src/mcp-server.ts` — delete the `tempo_ask_clarifications` and `tempo_get_clarification_answers` tool registrations (lines 44–63 today). Update the `tempo_post_discussion_message` registration to accept the optional `questions` parameter and describe both prose and clarification uses.
- The Agent's MCP tool surface shrinks from 8 tools to 6.

There is no Agent "loop" change. The Agent's reasoning today calls `openRound`, then polls `getRoundAnswers` until it sees `{ status: 'answered' }`, then reacts. After this change, the Agent's reasoning calls `postDiscussionMessage({ questions })`, then polls events until it sees the next Dev `discussion_message_posted` event, then reads the Dev message's text and reacts. Both before and after, the Agent decides when to call each tool — the change is in which tools exist, not in any code that loops on Agent's behalf.

### Console UI (`apps/console/components/thread/discussion`)

- The Discussion panel renders the message list with three per-message states, derived purely from the message log:
  - **Live stepper** — message has `questions != null` AND is the latest message in the thread.
  - **Minimized question card** — message has `questions != null` AND a later message exists. Compact chip inline at its chronological position, listing the question prompts, no controls.
  - **Bubble** — message has only `text` (Dev free-form, Dev answer-as-text from the stepper, or Agent prose-only).
- Live-card derivation: `lastMessage(thread).questions ? lastMessage(thread) : null`. No DB column, no event, no state. The moment any Dev message lands, the previously-live card re-renders as minimized — same component, mode flag flips.
- The composer is always live (Q3 decision in the brainstorming flow — "composer stays live, Dev can push back at any moment with a free-form message; the act of posting any Dev message minimizes the live card").
- The stepper card's submit path formats the Dev's selections (multi/single options, "Add your own" entries, optional text, skipped markers) into markdown `text` and calls `tempo_post_discussion_message({ text })`. Format:

  ```
  **<question prompt>**
  → <comma-separated options or text or _Skipped_>

  **<next question prompt>**
  → ...
  ```

  No structured `answers[]` field — the Agent reads the message as prose and reacts.
- Delete `components/thread/discussion/round-card.tsx` (or repurpose its rendering into the message-renderer if the visual treatment carries over). The current `DiscussionPanel`'s `pendingRound: PendingRound | null` prop goes away — the panel derives the live card from the message list itself.
- Delete `components/thread/discussion/round-questions.tsx` if it has no consumers outside `round-card.tsx` (grep before deleting).
- `components/thread/thread-view.tsx` lines 90, 93, 121, 128, 162, 223 — all `view.pending_round` references go away. The `discussionOpen` gating, the `Cmd+/` keybinding guard, the `pendingRound` prop pass to `DiscussionPanel`, and the `roundPending` prop pass to whichever child uses it (likely the connect button or banner) all collapse. The Discussion panel can be opened whether or not a question card is live; the live-card state is internal to the panel.
- Zustand discussion slice — delete any state holding round entities; the message list is the source of truth.

### What stays untouched

- `tempo_pull_plan`, `tempo_write_plan`, `tempo_post_reply`, `tempo_poll` — unchanged shape.
- Comment / Reply path on the Plan — completely separate from Discussion.
- Plan editor, Comments rail, Connect button, Thread header.
- Stepper card visual component itself — repurposed to render whichever question-message is currently live.
- Discussion store's message-list state, SSE/long-poll wiring.

## Concrete payload examples

**Agent asks** (`tempo_post_discussion_message`):

```json
{
  "text": "Quick clarifying round before I dig in:",
  "questions": [
    {
      "type": "multi_choice",
      "prompt": "Which Console surface(s) should I focus on?",
      "options": [
        "Dashboard / Thread list",
        "Plan editor",
        "Discussion panel",
        "Global visual language"
      ],
      "allow_other": true
    },
    {
      "type": "single_choice",
      "prompt": "How ambitious should this pass be?",
      "options": [
        "Polish pass",
        "Targeted redesign",
        "Full reimagining"
      ],
      "allow_other": false
    },
    {
      "type": "open_text",
      "prompt": "Anything I should preserve or avoid?"
    }
  ]
}
```

Server assigns ids to each question (`q_...` ulids or similar — exact prefix decided during implementation), persists, returns `{ message_id }`, emits `discussion_message_posted`.

**Dev submits the stepper** (also `tempo_post_discussion_message`):

```json
{
  "text": "**Which Console surface(s) should I focus on?**\n→ Dashboard / Thread list, Plan editor\n\n**How ambitious should this pass be?**\n→ Targeted redesign\n\n**Anything I should preserve or avoid?**\n→ keep the mint accent; don't touch the Plan editor"
}
```

**Dev pushes back instead** (also `tempo_post_discussion_message`):

```json
{ "text": "Hold on — you should also think about Redis instead of Postgres for the rate-limit state." }
```

The Agent reads each as a normal text message and reacts. No JSON parsing, no `answers[]` field, no `round_id` tracking.

## Alternatives considered

1. **Keep the `Round` table; render rounds inline.** Status quo with a UI change: rounds still exist as a DB entity, but every round is rendered inline within its parent Agent message. Minimal contract churn. Tradeoff: keeps two parallel concepts (messages and rounds) that have to stay in sync. The data model says "round is a thing"; the UX says "it's just inline questions." That gap will be felt every time someone touches Discussion code. Rejected: solves the UX problem without paying the conceptual debt.

2. **Collapse the data model but keep `tempo_ask_clarifications` as a tool name.** Drop the `clarification_rounds` table; `questions` becomes a field on `DiscussionMessage`; but the Agent's tool surface keeps `tempo_ask_clarifications` as a verb-clear alias that internally creates a DiscussionMessage with questions. Tradeoff: preserves a clear verb in the Agent's tool list. Cost: two tools that hit the same code path. The Agent's instinct should be "post a message" — the questions are content, not a different action. Rejected: the verb adds noise where the unified shape adds clarity.

3. **Encode questions in markdown text (no structured field).** The Agent posts a `text`-only message with a fenced ` ```tempo-questions ` block; the Console parses it for stepper rendering. Tradeoff: maximal collapse — one field on the message (`text`). Cost: the Agent has to invent question ids (or the server parses the markdown and re-assigns them); validation of `QuestionInput.type` / `options[]` shape moves from Zod to a custom markdown parser; the Agent can produce malformed blocks and the Console has to handle that gracefully. Rejected: the marginal "purity" of one field isn't worth the parsing surface area.

4. **Selected: full collapse with structured `questions[]` field.** Drop rounds entirely; questions become a JSON column on `DiscussionMessage`; one tool covers both prose and questions; no structured `answers[]` — submit formats to markdown text. Smallest data model, smallest contract surface. Cost: one Drizzle migration that drops two tables, adds one column, and nulls one column; local DB wipe; widespread but surgical deletions in contracts, routes, server modules, and the Discussion UI.

## Uncertainties

- **Stepper submit format for long answers.** The proposed format is `**<prompt>**\n→ <answer>`. Reads cleanly as a bubble; parses as prose for the Agent. The Agent has the full conversation in context, so it knows what its own questions were — it doesn't need the Dev's submission to be machine-parseable. Multi-line text answers (multi-paragraph `open_text` responses) should still render correctly because markdown preserves paragraph breaks under the `→` line, but the exact rendering deserves a quick check during implementation.
- **"Submit partial answers + free-form text in one message" case.** The mockup's stepper has per-question skip; this design says the stepper's submit produces a text-only message. If the Dev wants to add free-form context alongside a partial answer, the simplest answer is: submit the partials (formatted), then post a second free-form message. No mixed-mode submit. Worth flagging because the mockup implies a single submit covers everything.
- **`Question.id` usefulness after `answers[]` is dropped.** Ids are still server-assigned and persisted, but no other entity references them. They're useful as React render keys and as a future anchor for "comment on this specific question." Could be dropped entirely if we never anchor to them; leaving them in is cheap insurance because the existing `Question` shape already includes them.
- **Actual filenames for `server/rounds.ts` and `server/discussion.ts`.** The AGENTS.md phase plan implies these names, but the implementation should grep the `apps/console/server/` directory rather than trust the spec's guesses. The behaviors described above are unambiguous; the filenames are not load-bearing.
- **Single commit vs short series.** The contract change, DB migration, three route deletions, server module changes, Agent client changes, and Console UI changes all have to land together because none of them can ship independently — `tempo_ask_clarifications` either exists or it doesn't, and `pending_round` either ships on the response shape or it doesn't. Pre-MVP, no rollout pressure: one commit is the default unless reviewer feedback during implementation argues for splitting.

## Layer assignment

- **DB schema + migration**: `apps/console/db/**`.
- **Insert path for messages with `questions`, including the Agent-only invariant for `questions != null`**: `apps/console/server/discussion.ts` (or current module name). Server-assigns question ids here. **This is where the "only Agent author may set questions" business rule lives — not in the route handler.**
- **Route handler `app/api/threads/[id]/discussion/messages/route.ts`**: thin. Parses body via `PostDiscussionMessageInput` (Zod-level validation only — non-empty body, well-formed `QuestionInput`), calls the server module, returns `{ message_id }`. The author check is in the server module per layer rules.
- **`GetThreadResponse` / `AttachOutput` assembly**: in `apps/console/server/state.ts` (or wherever assembled). The `pending_round` read path is deleted here; no equivalent read path replaces it because the live-card state is derived client-side.
- **Live-card derivation**: pure function or hook in `apps/console/components/thread/discussion/**`. No DB column, no event, no server-side concept.
- **Composer behavior**: client-side state in the existing composer component. No server change.
- **Agent client**: `apps/agent/src/http-client.ts` — thin wrapper around the HTTP route.
- **Agent MCP tool surface**: `apps/agent/src/mcp-server.ts` — registers the trimmed tool set.
- **Agent prompt**: `apps/console/server/initial-prompt.ts`.

No business logic in route handlers. No DB queries in components. Layer rules from CLAUDE.md §"Layer placement" hold.

## Deletion test

Things being deleted:

- **`clarification_rounds` table + per-question answers table.** If deleted in 6 months, where does the complexity reappear? Nowhere. The work these did — "Agent asks a structured question; Dev answers it; Agent reads the answer" — is fully covered by a single Discussion message that happens to carry `questions[]`. There is no pass-through here.
- **`RoundId`, `RoundStatus`, `Answer`, `PendingRound` primitives.** Each described an entity that no longer exists. Deletion removes parallel naming, not parallel capability.
- **`tempo_ask_clarifications` and `tempo_get_clarification_answers` MCP tools.** Replaced by an extended `tempo_post_discussion_message`. The Agent's capability to ask structured questions is preserved; only the verb collapses.
- **`OpenRoundResponse` HTTP shape and the three `clarification-rounds` HTTP routes.** Their work is folded into `POST /api/threads/[id]/discussion/messages`. No capability lost.
- **`RoundOpenedEvent`, `RoundAnsweredEvent`, `round_opened`, `round_answered` event kinds.** The information they conveyed — "an Agent asked questions" and "a Dev answered" — is conveyed by `discussion_message_posted` with `questions` populated (the ask) and a later `discussion_message_posted` from the Dev (the answer-as-text).
- **`round_already_pending`, `round_pending`, `round_not_found` MCP error codes.** Errors that only made sense for the Round lifecycle. No Round, no errors.
- **`pending_round` field on `GetThreadResponse` and `AttachOutput`.** Used today to gate the Console UI ("a round is pending — open the panel"). After the change, the same gating ("a question card is the latest message") is derived client-side from the message list. Server-computed UI hint becomes a client-side derivation — cleaner and more accurate (it stays in sync with the message list automatically).
- **`server/rounds.ts` (or equivalent).** Logic folded into `server/discussion.ts`. No business logic deleted, just reattached to its rightful owner.
- **`openRound` and `getRoundAnswers` methods on the Agent's HTTP client.** Replaced by an extended `postDiscussionMessage` and the existing `poll`. Net: two methods gone, one extended.
- **`DiscussionPanel`'s `pendingRound` prop, `view.pending_round` references in `thread-view.tsx`, the `RoundCard` component.** UI machinery that existed only because the server told the client "a round is pending." Now the client computes that itself from data it already has.

Things being added:

- **`questions: JSON | null` column on `discussion_messages`.** Carries the new capability. If deleted, the Agent can no longer ask structured questions through Discussion — that's a real capability, not a pass-through.
- **`questions?: QuestionInput[]` on `PostDiscussionMessageInput`; `questions: Question[] | null` on `DiscussionMessage`; nullable `text` on `DiscussionMessage`.** Brings the new capability into the contract. Not a pass-through.
- **Live-card derivation function (Console).** One-liner pure function over the message list. If deleted, the Console can't tell which question card is "live" vs "minimized," and the stepper anchoring breaks. Real responsibility.
- **Server-side "Agent-only for `questions`" check in `server/discussion.ts`.** Single business rule, single home. If deleted, a malicious or buggy client could persist a Dev message with structured questions — real concern.

## Destructive actions

- **Drop two DB tables + null a column + delete the local `apps/console/data/tempo.db` after migration.** Local-only; no production data exists. No Dev acknowledgment required for the schema change itself (pre-MVP, the DB is dev-only). The local wipe is documented in the commit message so anyone else picking up the branch knows to re-migrate.
- **Delete three HTTP route files, one server module, one UI component file.** Reversible via git. No external state touched.
- **No `git push`, no `fly deploy`, no package publish, no force-push, no branch deletion, no `rm -rf` outside `apps/console/data/`.** No external messages.

If any external destructive action becomes necessary mid-implementation, it gets a fresh Dev acknowledgment per CLAUDE.md §"Destructive-action gate."

## Vocabulary check

Words used from CONTEXT.md: Agent, Dev, Console, Thread, Plan, Comment, Reply, Discussion (message). Architecture: module, interface, layer, deletion test.

Removed words: **Round**, **Clarification Round** as nouns — these dissolve. The verb "clarify" or the informal phrase "clarification round" remains useful in conversation ("the Agent ran a clarification round") but no longer maps to a code entity. Because CONTEXT.md currently names `Clarification Round` as a product noun, that section gets a one-line update in the same commit: "Rounds are not a separate entity; they are Agent Discussion messages carrying `questions[]`."

No drift into "component / service / API / boundary" for architecture. React UI "component" is fine.
