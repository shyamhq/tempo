# Remove the Archive concept; restrict Resolve to the Dev

## Problem

When the Agent edits the Plan to act on a Comment's request (e.g. "remove §4"), `reconcileCommentAnchors` can no longer fuzzy-match the Comment's `plan_quote` against the new markdown, so it auto-flips `archived_at` and the Comment disappears into the Archive panel. From the Dev's seat, the Comment was succeeding — they wanted to mark it Resolved themselves. Two confounding signals:

1. Auto-archive collapses "Agent acted on it", "Agent reworded near it", and "section was independently rewritten" into one indistinguishable state.
2. The Agent currently has authority to Resolve a Comment via `tempo_resolve_comment` MCP tool + the unrestricted `resolveComment(commentId, by: Actor)` server action. The Dev expects to be the sole arbiter of "this Comment is done."

## Smallest concrete change

1. **Delete `reconcileCommentAnchors`** in `apps/console/server/comments.ts` and its call site in `writePlan` (`apps/console/server/plan.ts`). Delete the supporting helpers (`matches`, `normalizeForMatch`, `findApprox`, `levenshtein`) — they have no other caller.
2. **Drop `archived_at` from the DB**: schema removal + drizzle-generated migration. (Dev environment; existing rows: any archived Comments come back into the live rail. Acceptable in dev.)
3. **Drop `archived_at` from the contract** (`packages/contracts/src/primitives.ts` Comment shape). Drop `archived_comments: z.array(Comment)` from `GetThreadResponse`. Drop the `comment_archived` event from `packages/contracts/src/events.ts` + the discriminated union.
4. **Server**: `listThreadComments` returns one flat array of Comments. The route handler at `app/api/threads/[id]/route.ts` no longer separates `comments` / `archived_comments`. Delete the `comment_archived` event handler in `hooks/use-thread-events.ts`.
5. **Rail**: remove the "Archive (N)" panel and `showArchive` state from `comments-rail.tsx`. Remove `archivedComments` prop. Remove the `archived` prop on `CommentCard` and the corresponding render branch in `comment-cards.tsx`.
6. **Unanchored-comment indicator (deferred — Dev agency, not auto-bookkeeping)**: not added in this change. The Comment simply appears in the rail without an editor highlight when its mark isn't present. The Dev decides whether to Reply or Resolve. (Open uncertainty: do we want a visual cue, or trust the absence of highlight? I'll start without — adding a cue is a one-line follow-up if it turns out we need it.)
7. **Restrict Resolve to the Dev**:
   - `comments.resolved_by` enum: `['dev', 'agent']` → `['dev']`. Drizzle migration to update the enum is a no-op at SQL level (SQLite stores text); contract enum is the real check.
   - `Comment.resolved_by` in `packages/contracts/src/primitives.ts`: `Actor.nullable()` → `z.literal('dev').nullable()`.
   - `resolveComment(commentId, by: Actor)` → `resolveComment(commentId)`; hard-coded `'dev'` write. Drop the `by` arg.
   - `unresolveComment` likewise.
   - `comment_resolved` event: `actor: Actor` → drop the `actor` field (always Dev) — or keep `actor: z.literal('dev')` for forward-compat; pick the simpler removal.
   - `app/api/comments/[id]/resolve/route.ts`: 403 if the auth actor is the Agent.
   - **MCP**: remove `tempo_resolve_comment` tool from `apps/agent/src/mcp-server.ts`.
   - **Agent HTTP client**: remove `resolveComment` from `apps/agent/src/http-client.ts`.
   - **Agent initial prompt** (`apps/console/server/initial-prompt.ts`): if the tool is listed, remove it.
8. **CONTEXT.md**:
   - Remove the `### Archive` entry.
   - Update the `### Comment` entry: "Can be resolved by either Dev or Agent (D16)" → "Resolved exclusively by the Dev. The Agent never resolves Comments."
   - Add a new D-decision (e.g., **D30**) recording: "Archive removed. Anchor-loss does not auto-archive a Comment. Resolve is the only terminal Comment state, and only the Dev can issue it. Supersedes D16 (Agent could resolve)."
9. **AGENTS.md**: log in the Decisions section.

## Alternatives considered

**Option A (chosen) — Drop Archive entirely; only the Dev resolves.**
- Pro: Dev's mental model wins. No surprise disappearance. ~80 lines + a whole subsystem deleted (Levenshtein matcher, archive panel, archive event, archived_at column, contract field, MCP resolve tool).
- Pro: collapses the Comment lifecycle to one terminal verb owned by one actor.
- Con: Threads with many stale Comments could grow noisy. Dev's stated workflow (Resolve as you go) makes this a non-issue.

**Option B — Keep Archive but make it Dev-initiated.**
- Auto-archive removed; Dev gets an "Archive" button on each Comment card.
- Pro: preserves the "set-aside, not resolved" semantic for Comments the Dev considers stale-but-not-done.
- Con: introduces a third terminal verb (Resolve / Archive / Live) with no clear behavioral distinction in the UI. The Dev has no need we've heard for a separate "set aside" state.
- Rejected — adds a concept the Dev didn't ask for and the system doesn't act on differently.

**Option C — Soft archive: auto-Resolve on anchor loss, attributed to the Agent, with a system reply.**
- Pro: keeps the "anchor gone = act of completion" intuition.
- Con: directly conflicts with the new constraint that the Agent must never resolve. Rejected.

## Layer placement (rule 19)

| New / changed function | Layer |
|---|---|
| `resolveComment` / `unresolveComment` (signature change) | `apps/console/server/comments.ts` (business rules). Unchanged layer. |
| `listThreadComments` (single flat list) | `apps/console/server/comments.ts`. Unchanged. |
| Removed: `reconcileCommentAnchors`, `matches`, `normalizeForMatch`, `findApprox`, `levenshtein` | Deleted from `apps/console/server/comments.ts`. |
| Route handlers (`/api/comments/[id]/resolve`, `/api/comments/[id]/unresolve`) | `apps/console/app/api/**` stay thin: parse → 403 if Agent → call server module. |
| Migration | `apps/console/db/migrations/0002_*.sql` (Drizzle-generated). |

No new files. No new modules. The change is mostly subtraction.

## Deletion test (CONTEXT.md §2)

For every new function or module: if we deleted it in 6 months, where does the complexity reappear? **N/A — this plan adds no new functions or modules.** Everything net-new in the diff is signature *narrowing* of existing functions. The deletion-test concern applies to *additions*; this is a subtraction.

For the subtractions: if we ever decide a Dev wants Archive back (Option B), reintroducing it would require: `archived_at` column + migration + contract field + rail panel + per-Comment action endpoint. That's the cost-of-undo. Acceptable given no Dev has asked for it.

## Uncertainties

- **Unanchored-Comment visual cue (item 6)**: shipping without one. If real-world use shows it's confusing — "is this Comment broken or just unanchored?" — add a small muted "anchor not found" pill on the rail card. One-line follow-up, not blocking.
- **`comment_resolved` event `actor` field**: keeping it as `z.literal('dev')` vs removing it. Leaning toward removing — fewer fields, the literal is implied. Not load-bearing for any consumer I can find. Will confirm by grep before deletion.
- **Dev DB has existing archived Comments?**: any rows with `archived_at IS NOT NULL` will come back into the live rail after migration. In dev this is fine; if it isn't, the Dev can delete them through the (future) delete UI or `sqlite3` directly.
- **`comments.resolved_by` enum migration**: the SQLite enum is a CHECK constraint via Drizzle. Verify the generated migration narrows the constraint without dropping data. Will inspect the SQL before applying.

## Destructive actions

- Migration drops the `archived_at` column. This loses Archive metadata for the dev DB. **Dev acknowledgment**: the Dev's message of 2026-05-29 23:47 explicitly proposes "may be we should get rid of this archive thing" — that's the authorization to remove `archived_at` and any Archive-only data.
- No `git push`, no published-package change, no shared-state mutation.

## Out of scope

- The "Plan updated by Agent" toast already shipped — separate UX hint, not part of this change.
- Any rework of how the Tiptap mark survives a `setContent` swap. The existing "re-stamp marks after content swap" logic in `usePlanEditor` is what makes unanchored Comments visible in the rail without a highlight; it stays.
