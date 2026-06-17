# Multi-user support — research, initial plan, revised plan

Goal: turn Tempo from a 1-Dev + 1-Agent tool into a workspace where any member can post in a thread, `@`-mention teammates or the agent, and the agent only runs when explicitly mentioned. Notion-style picker.

---

## 1. Codebase findings (fan-out scout reports)

### 1.1 Current single-user discussion / agent-invocation flow

**Posting path.** Console UI → Worker directly:
- `wApi.postDiscussionMessage(threadId, {text, attachments})` →
  `POST /api/threads/{threadId}/discussion/messages` (Worker).
- Composer: `apps/console/components/thread/discussion/message-composer.tsx:59`.
- MCP tool receiver: `apps/worker/src/mcp/tools/post-discussion-message.ts:6–39` — hardcodes `author: 'agent'` on its path.
- Server handler: `packages/server/src/discussion.ts:29–76` (`postMessage`) — accepts `author: Actor`, writes to DB at line 59, appends a `discussion_message_posted` event at line 74.

**Wake logic.**
- `shouldWake()` at `packages/contracts/src/events.ts:168–173` — only fires on `comment_added | reply_added | discussion_message_posted` AND `author === 'dev'`. Comment kind itself is treated as dev-authored (lines 150–154).
- `appendEvent()` calls `routeWake()` if predicate is true (`packages/server/src/event-log.ts:36`).
- `routeWake()` checks `agent_type` and POSTs to Worker `/api/threads/{threadId}/hosted/wake` if not live (lines 46–74).
- Worker wake: `apps/worker/src/routes/hosted/wake.ts:13–34` accepts `caller.kind === 'internal'` (auto-wake) or `'browser'` (manual).
- CLI long-poll: `apps/worker/src/routes/events/sse.ts:14–69` — long-poll bumps `agent_last_seen_at`, SSE stream pushes all events.

**Actor model.**
- `Actor = z.enum(['dev', 'agent'])` at `packages/contracts/src/primitives.ts:28–29`. Only two actors.
- `authorOf()` at `apps/console/server/actor.ts:86–88` collapses every Console user to `'dev'`.
- No user ID on event payloads. No "which dev posted".

**Access control.**
- `assertMembership()` at `apps/worker/src/server/auth-lookup.ts:72–101` resolves thread → workspace → Clerk org membership.
- Per-thread membership: none. Workspace-level only.

**SSE fan-out shape.**
- `sseStream(threadId, cursor)` at `apps/worker/src/routes/events/sse.ts:39` — scoped per thread, not per viewer.
- All subscribers receive identical event frames.
- Client: `apps/console/hooks/use-thread-events.ts:64–137` — single EventSource per thread, no per-message "for me" filtering.

**Workspace + invite functionality.** Fully wired via Clerk Organizations.
- `apps/console/server/workspaces.ts:14–54` maps Clerk org → Tempo workspace 1:1.
- `inviteMember()` lines 97–112 wraps `clerk.organizations.createOrganizationInvitation`.
- `listMembers()` lines 135–175 wraps `getOrganizationMembershipList`.
- Branded invite email via Resend.
- Schema: `workspaces.clerk_org_id` is the bridge. No custom users table.

**Single-user assumptions worth flagging.**
1. Binary `Actor` enum — no user identity in events.
2. Workspace-level thread access — all members see all threads, no per-thread invite/role.
3. `authorOf` returns `'dev'` for every Console user.
4. No "addressed to" field on events.
5. `shouldWake` author filter exists only to block agent-from-agent ping-pong.
6. Thread presence via `agent_last_seen_at`; no user presence.

### 1.2 Multi-user foundation status

**Status: GREEN (foundation in place, needs identity layer).**

| Concern | Status |
|---|---|
| Workspace = Clerk org, multi-tenant | ✅ wired |
| Member invite/list/role | ✅ wired via Clerk API + Resend |
| Per-request user identity | ✅ Clerk session → `AuthContext { user_id, workspace_id, org_id, role }` |
| Per-request access check | ✅ `assertMembership()` on Worker, `threadBelongsToWorkspace()` on Console |
| Admin / member roles | ✅ enforced on workspace ops; threads open to all members |
| User identity in messages | ❌ author collapses to `'dev'` enum |
| Mention / addressed-to concept | ❌ does not exist |
| Per-user unread / read state | ❌ does not exist |

**To ship `@`-mentions: just add the identity layer** — there's no auth or membership work to redo.

### 1.3 Notion / Slack / Linear / Figma research

**Mention picker UX.** Universal pattern is an inline popover anchored to caret on `@`. Tiptap `Mention` extension uses `onStart` / `onUpdate` / `onExit` lifecycle hooks + Floating UI for positioning. Keyboard nav: arrows + Enter + Esc. Accessibility: `role="listbox"` / `role="option"`. Rendered mention is an atomic inline node — pill chip with single-Backspace delete. Figma adds history-based ranking (prior commenters first). Source: <https://tiptap.dev/docs/editor/extensions/nodes/mention>.

**Mention data model — three patterns.**
- **A. Inline rich-text node** (Notion, Figma, Linear). Mention is a typed node in document JSON: `{ type: "mention", attrs: { id, label } }`. Tradeoff: extracting "all threads mentioning X" requires content scan or shadow index.
- **B. Shadow `mentions` join table**. `message_mentions(message_id, user_id)` written transactionally. O(1) fan-out queries. Tradeoff: two writes; can drift on edit.
- **C. Plain-text regex**. Fragile on spaces and renames. Not recommended.
- Consensus best practice: **A as source of truth, B as derived read-model when needed.**

**Notification routing.** Slack engineering posts (<https://slack.engineering/how-slack-rebuilt-notifications/>, <https://slack.engineering/tracing-notifications/>) — decouple intent (does this generate awareness?) from delivery (push it?). Pipeline: `trigger → job queue → push service → APNs/FCM → client`. In-app unread = server-side `last_read_at` per `(user, channel)`. Mentions get distinct event type that bypasses mute.

**AI as participant.** Slack: bot has `bot_user_id` (looks like `U…`) + `is_bot: true`; subscribes to `app_mention` event — fires only when message contains `<@BOT_USER_ID>`. Notion Custom Agents (Feb 2026): autonomous entity with own picker handle; triggers on mention or page event. Linear Asks (May 2026): same pattern. **Convergence: agent is a named entity in the picker, mention extraction triggers a discrete run, agent is silent unless mentioned.**

**Read state.** Dominant: `thread_read_state(user_id, thread_id, last_read_at)`. Unread = `COUNT(*) FROM messages WHERE created_at > last_read_at`. Google Chat exposes `ThreadReadState.last_read_time`. Per-message receipts (Slack DMs, iMessage) cost an order of magnitude more storage and aren't worth it for comment threads.

**Real-time fan-out.** Slack uses WebSockets; comment systems lean on SSE (server→client only). Artera's SSE architecture uses Redis Streams + `Last-Event-ID` for replay. **Tempo already uses SSE — no change needed.**

**Race conditions and ordering.** Server-assigned `created_at` + monotonic ID (ULID) as tiebreaker. Client renders optimistically with "pending" state, swaps on server confirmation. No CRDT for comments (they're atomic units, not co-edits).

### 1.4 AI-agent-as-participant industry sweep

| Product | Trigger | Agent identity | Context | Concurrency | Cost discipline |
|---|---|---|---|---|---|
| Cursor Automations | Webhook / event (PR, Slack, Linear) | Output-only, no avatar | Per-sandbox per event | Parallel sandboxes | Sandbox per task |
| Linear Agent / Asks | `Cmd+J`, `@Linear`, Triage auto | Named entity, own activity trail | Full workspace graph | Multi-tab chat | Plan-bundled; metered at GA |
| GitHub Copilot Coding Agent | Issue assignment / `@github` mention | Distinct committer identity | Issue + PR + repo instructions | 1 VM per task | Premium request per model call |
| Devin | `@Devin` Slack / Linear / Jira assign | Named bot, email-matched user | Per-session, defined upfront | Independent parallel sessions | `!ask` shortcut for cheap reads |
| Slack AI | Passive (summaries) + active (search) | Bot user with `is_bot: true` | Channel/thread history | N/A documented | Bundled in plan |
| Notion Custom Agents | Scheduled / event / `@mention` | Named entity in comments | Scoped permissions per agent | Independent runs | Per-run credits |
| Replit Multiplayer | Explicit prompt in shared chat | Treated as team member | Switches per task | Kanban-board view | Plan-gated models |

**Universal patterns.**
1. `@`-mention as the default trigger. None default to "agent watches everything."
2. Agent modeled as a named entity, not output-on-a-human's-message.
3. Task isolation per invocation — fresh context, no shared running state.
4. Explicit context scoping as the cost gate.
5. Human review preserved at output/merge.

**Tradeoff verdict.** For Tempo's planning context (high human↔human negotiation, expensive agent turns), `@`-mention-gated wins on every axis: cost legibility, relevance, parallelism, and trust.

### 1.5 Architecture impact scan

| Surface | Change | Cost |
|---|---|---|
| Event log shape | Add `author_user_id` to `DiscussionMessage`; migrate existing rows | Small |
| SSE delivery | None — already per-thread broadcast | None |
| Console event consumption | Add `userId → name` mapping in `MessageRow` | Small |
| Wake predicate | Replace `author === 'dev'` with "agent is mentioned" | Small |
| Agent history read | None — `listMessagesForThread()` already returns full thread | None |
| Message IDs | None — server-assigned ULIDs already used | None |
| Composer | Replace textarea with rich editor + mention plugin | **Largest piece** |

**Refactor surface size: MEDIUM.** The composer is the only meaningful UI change; everything else is contract + predicate work.

---

## 2. Initial plan (pre-review)

Posted as the first response. Captured here for diffing against the revised plan.

```
1. Event author shape:
   Actor = 'dev' | 'agent'
   → author: { kind: 'user', userId: clerkId } | { kind: 'agent' }
   Discriminated union, two states.

2. Schema:
   discussion_messages.author_user_id text NULL.

3. Composer:
   Replace textarea with Tiptap + @tiptap/extension-mention.
   Picker shows workspace members from Clerk listMembers + a synthetic "Agent" row.

4. Mentions shadow table:
   discussion_message_mentions(message_id, target_kind, target_user_id).
   Written transactionally in postMessage. Used by shouldWake for O(1) join.

5. shouldWake rewrite:
   Was: event.author === 'dev'
   Now: mentions table contains target_kind = 'agent' for the message.

6. UI name mapping:
   Fetch listMembers from Clerk via a backend endpoint, cache client-side
   (TanStack query), map userId → display name in MessageRow.

Skipped for v1:
- Notifications service / inbox
- Per-message read receipts
- Typing indicators
- Live presence dots
- Role-based mention restrictions
```

---

## 3. Revised plan (after `the-algorithm` + `ponytail`)

User feedback: "Series A startup complete, not broken." Drop the speculative bits, keep the rough edges off.

### 3.1 What I deleted from the initial plan and why

| Removed | Reason |
|---|---|
| Shadow `discussion_message_mentions` table | Mentions already live in the Tiptap message body JSON. `shouldWake` and the emailer walk that JSON. A shadow table is a second source of truth without a current consumer. Add it when "show me threads where I'm mentioned" view ships. |
| Discriminated-union `author: {kind, userId} \| {kind: 'agent'}` | Indirection. `author_user_id: string \| null` (null = agent) is the same information in one column with simpler comparisons. |
| Hand-rolled `/api/workspace/members` endpoint | CLAUDE.md rule: use Clerk's `useOrganization()` / `useOrganizationList()` hooks directly. No backend pass-through for data already client-side. |
| Custom name-cache + TanStack query for member names | Same — Clerk hook is the source of truth. |
| "Agent as a Clerk user row" | The agent is per-thread, fixed. Picker has one synthetic top row "Agent". Don't model it as a user. |
| Per-message read receipts | Per-`(user, thread)` `last_read_at` is enough for comment threads. |

### 3.2 What I added (Series-A complete, not flashy)

| Added | Why |
|---|---|
| Email-on-mention via Resend | Tempo is a planning tool — people aren't logged in all day. Email is the only thing that reliably reaches a mentioned teammate. Resend is already in the repo for invite emails. |
| `user_thread_state.unread_mention_count` | An in-thread badge so users coming back see which threads have unread mentions for them. |
| Drop `Actor` enum entirely | Replacing with `author_user_id: string \| null` is the standard shape and the fix-the-invariant move from CLAUDE.md. Worth the touch surface. |

### 3.3 Final plan

**Schema (one migration).**

```sql
ALTER TABLE discussion_messages
  DROP COLUMN author,                       -- was 'dev' | 'agent'
  ADD COLUMN author_user_id TEXT NULL;      -- NULL = agent, else clerk user id

CREATE TABLE user_thread_state (
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_read_at TIMESTAMPTZ,
  unread_mention_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, thread_id)
);
```

Backfill: every existing `discussion_messages` row with `author='agent'` → NULL; with `author='dev'` → the workspace's first admin's Clerk user id (best effort; messages predate multi-user, all readers know).

Apply the same shape to `replies.author` and any other table that currently stores `Actor`.

**Contracts.**

```ts
// packages/contracts/src/primitives.ts
// remove: Actor = z.enum(['dev', 'agent'])
// remove: every isAgent/isDev branch on the enum

DiscussionMessage = z.object({
  id: MessageId,
  thread_id: ThreadId,
  author_user_id: z.string().nullable(),    // null = agent
  body: TiptapDocSchema,                    // mention nodes already standard JSON
  created_at: z.string().datetime(),
  // ...
})

// Helper used everywhere comparisons happened:
const isAgent = (m: DiscussionMessage) => m.author_user_id === null
```

**Composer (UI).**

```ts
// apps/console/components/thread/discussion/message-composer.tsx
// swap <textarea> for the existing Tiptap setup (Plan editor reuse)
import Mention from '@tiptap/extension-mention'
import { useOrganization } from '@clerk/nextjs'

const { memberships } = useOrganization({ memberships: true })

const items = [
  { kind: 'agent' as const, label: 'Agent', id: 'agent' },
  ...memberships.data.map(m => ({
    kind: 'user' as const,
    label: m.publicUserData.firstName + ' ' + m.publicUserData.lastName,
    id: m.publicUserData.userId,
  })),
]

// Tiptap Mention extension's suggestion render: filter `items` by query, popover.
```

**Post path.**

```ts
// packages/server/src/discussion.ts
async function postMessage(thread_id, author_user_id, body) {
  const id = newMessageId()
  await db.insert(discussion_messages).values({ id, thread_id, author_user_id, body, ... })

  const mentions = walkMentions(body)              // ~5 lines: walk Tiptap JSON for type='mention' nodes

  for (const m of mentions.filter(m => m.kind === 'user' && m.id !== author_user_id)) {
    await bumpUnread(m.id, thread_id)              // INSERT ... ON CONFLICT UPDATE +1
    await queueMentionEmail(m.id, thread_id, author_user_id)   // Resend, reuse invite mailer
  }

  await appendEvent({ kind: 'discussion_message_posted', thread_id, message: { id, ... } })
}

function walkMentions(doc: TiptapDoc): Mention[] {
  const out: Mention[] = []
  const visit = (n: any) => {
    if (n.type === 'mention') out.push({ kind: n.attrs.kind, id: n.attrs.id })
    n.content?.forEach(visit)
  }
  visit(doc)
  return out
}
```

**Wake predicate.**

```ts
// packages/contracts/src/events.ts
export function shouldWake(ev: ThreadEvent): boolean {
  if (ev.kind !== 'discussion_message_posted') return false
  return walkMentions(ev.message.body).some(m => m.kind === 'agent')
}
// agent's own posts won't contain @agent → no ping-pong without an author check
```

**Email.**

```ts
// apps/console/server/mailer.ts (or wherever invite mail lives — colocate)
async function queueMentionEmail(toUserId, threadId, fromUserId) {
  const to = await clerk.users.getUser(toUserId)
  const from = await clerk.users.getUser(fromUserId)
  const thread = await getThread(threadId)
  await resend.emails.send({
    to: to.primaryEmailAddress,
    subject: `${from.firstName} mentioned you in ${thread.title}`,
    react: MentionEmail({ from, thread }),       // one template, mirrors InviteEmail
  })
}
```

**Read state.**

```ts
// Opening a thread:
POST /api/threads/:id/read
  → UPDATE user_thread_state
    SET last_read_at = now(), unread_mention_count = 0
    WHERE user_id = ... AND thread_id = ...

// Sidebar thread row reads unread_mention_count → dot + number.
```

**UI rendering.**

```tsx
// MessageRow
const { memberships } = useOrganization({ memberships: true })
const me = useUser().user?.id

const author = m.author_user_id === null
  ? { name: 'Agent', isAgent: true }
  : m.author_user_id === me
    ? { name: 'You', isAgent: false }
    : { name: lookupName(memberships, m.author_user_id), isAgent: false }
```

### 3.4 What we skip — and the trigger to add it

| Skipped | Add when |
|---|---|
| In-app notification center / inbox view | A user asks "show me everywhere I'm mentioned." Then the shadow `mentions` table earns its keep. |
| Push notifications | A user reports "email's too slow / I miss things." |
| Per-message read receipts | Never (not the right tool for comment threads). |
| Typing indicators | A user asks for them — likely never for a planning tool. |
| Live presence dots for humans | We just deleted presence; don't resurrect. |
| Mention picker history-ranking | A team complains alphabetical is annoying. |
| Permission-gated mentions | Compliance ask, not before. |
| `@channel` / mention-everyone | A team asks for it. |

### 3.5 Why this is Series-A complete, not "broken stuff"

- Authorship correct everywhere — drops the `'dev'` collapse that would render "You" for Bob's comment.
- Mentioned humans actually get told (email) and see it next visit (badge). No silent drops.
- Agent runs once per explicit ask. No ping-pong, no surprise bills.
- One source of truth for mentions (the body JSON), one for members (Clerk), one for unread (`user_thread_state`). No drift.
- SSE, ordering, access control unchanged — they already worked for N viewers.
- Email mirrors the existing invite mailer — same code shape, no new infra.

### 3.6 Files touched (estimate)

| File | Change |
|---|---|
| `packages/db/src/schema.ts` + new migration | drop `author`, add `author_user_id`, add `user_thread_state` |
| `packages/contracts/src/primitives.ts` | drop `Actor`, add `author_user_id` to `DiscussionMessage` |
| `packages/contracts/src/events.ts` | rewrite `shouldWake` |
| `packages/server/src/discussion.ts` | add `walkMentions`, `bumpUnread`, `queueMentionEmail` |
| `packages/server/src/event-log.ts` | no change |
| `apps/worker/src/mcp/tools/post-discussion-message.ts` | pass `author_user_id: null` (agent path) |
| `apps/console/components/thread/discussion/message-composer.tsx` | textarea → Tiptap + Mention |
| `apps/console/components/thread/discussion/message-row.tsx` | author display via Clerk hook |
| `apps/console/components/thread/thread-view.tsx` | drop `m.author === 'agent'` checks → `isAgent(m)` |
| `apps/console/hooks/use-thread-events.ts` | drop `author === 'dev'` checks |
| `apps/console/server/actor.ts` | drop `authorOf()` — no longer needed |
| `apps/console/server/mailer.ts` (or wherever invite mail lives) | add `MentionEmail` template + `queueMentionEmail` |
| `apps/console/app/api/threads/[id]/read/route.ts` (new) | mark thread read |
| `apps/console/components/dashboard/*` (sidebar / thread row) | render `unread_mention_count` |

### 3.7 Gates per CLAUDE.md

This change crosses contracts + schema + new product surface + new MCP semantics → **judge applies** before implementation. Next step:

1. Trim this doc into a focused plan document (problem, smallest concrete change, alternatives considered, uncertainties, layer assignment).
2. Invoke the `judge` agent.
3. On `APPROVED`, ship in two PRs — schema + contracts first, UI + composer second — so the contracts diff is reviewable on its own.

---

## 4. Open questions for the Dev

1. **Backfill of historical `author='dev'` rows.** Map to the workspace's first admin, or leave `NULL` and render as "(legacy)"? Leaning admin — fewer mystery rows.
2. **Multi-Clerk-org user** (a user in two workspaces). The mention picker only shows the current org's members via `useOrganization()`. Correct? (Yes — threads are workspace-scoped.)
3. **Email throttling.** If user A mentions user B five times in a minute editing/reposting, do they want five emails? Lazy default: yes, no debounce. Add when complained about.
4. **Mention the agent twice in one message.** Wakes once (predicate is `.some`). Confirmed correct.
5. **Local agent (CLI) vs hosted.** The wake change applies to both via `shouldWake` / `routeWake`. CLI long-poll already reads any new event on next poll. No CLI-side code change needed.
