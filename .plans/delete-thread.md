# Plan: delete a Thread

## Problem

There is no way to remove a Thread once created. During smoke-testing the user wants to clear out half-finished Threads instead of nuking `apps/console/data/tempo.db`. Without a delete affordance, every smoke iteration leaves orphan rows in the dashboard list.

## Smallest concrete change

1. **`deleteThread(threadId)` in `apps/console/server/threads.ts`** — one transaction that deletes from every table that references `threads.id` (or transitively does). Schema confirms no `ON DELETE CASCADE` is set, so do it by hand in this order: `replies` (via comments), `comments`, `clarification_rounds`, `events`, `sessions`, `plans`, `threads`. Throws `thread_not_found` if the row is gone.

2. **`DELETE /api/threads/:id`** in `apps/console/app/api/threads/[id]/route.ts` (extend the existing file, sibling to the existing `GET`). Auth: `X-Tempo-Dev: 1` (the same convention the dashboard list/create flow already uses — the existing `GET /api/threads` route is dev-only too). Returns **200 `{ ok: true }`** on success, 404 if missing.

3. **`DeleteThreadResponse = z.object({ ok: z.literal(true) })`** added to `packages/contracts/src/http.ts`, matching `ApproveThreadResponse` / `ReopenThreadResponse` / `ResolveCommentResponse` exactly. Every other write endpoint in this file has a named contract; the delete endpoint gets one for the same reason.

4. **`api.deleteThread(id)`** in `apps/console/lib/api-client.ts` (one method beside `approveThread`), using the shared `request()` helper with `DeleteThreadResponse` as the schema argument — no new helper, no 204 special-case.

5. **Delete affordance on the dashboard card.** One small button at the bottom-right of each `Card` in `apps/console/app/page.tsx`. Confirms via the browser `confirm()` (matches the destructive-action-feel; we don't ship a modal dialog component for this in MVP). On success, refetch the list (since the page is a Server Component with `dynamic = 'force-dynamic'`, a `router.refresh()` from a small client wrapper does it without rewriting the whole page).

   The card is currently wrapped in a `<Link>`. To put a button inside without nested-interactive issues, the trash button gets `e.stopPropagation()` + `e.preventDefault()` so the surrounding `<Link>` doesn't navigate when it's clicked.

## Layer assignment

| New code | Layer | Why |
|---|---|---|
| `deleteThread` | `apps/console/server/threads.ts` | Threads module already owns thread lifecycle (`createThread`, `approveThread`, `reopenThread`). Delete is one more lifecycle verb in the same module. |
| `DELETE` handler | `apps/console/app/api/threads/[id]/route.ts` | Extend the existing per-thread route file — same resource. Thin: auth check → call server → respond. |
| `api.deleteThread` | `apps/console/lib/api-client.ts` | Same module that hosts every other typed client method. |
| Dashboard delete button | `apps/console/app/page.tsx` (or a tiny sibling client component if the inline JSX exceeds ~30 lines) | Smallest change is inline; if it grows past the threshold, split into `components/dashboard/delete-thread-button.tsx`. |

## Deletion test

If we delete `deleteThread` in 6 months: the dashboard is back to "no way to clean up Threads"; the only path is `rm apps/console/data/tempo.db`. Complexity reappears as a recurring "I need a fresh DB" task during testing. So the addition earns its keep.

If we'd instead added a generic "archive thread" notion (soft-delete with a flag), that would fail the deletion test — no caller wants archive-vs-hard-delete distinction today, and an `archived_at` column is unjustified for a single second-future-state we don't have a use for.

## Alternatives considered

1. **Add `ON DELETE CASCADE` to the foreign-key constraints** instead of an explicit transaction. Rejected: requires a migration, changes drizzle schema, and SQLite's `PRAGMA foreign_keys=ON` is per-connection. The explicit-transaction approach matches the existing `createThread` pattern and stays inside the Threads module's responsibility.

2. **Soft-delete with `archived_at`** so deleted Threads stay queryable. Rejected: no caller wants this, fails the deletion test, and adds a column that the rest of the code would have to filter on forever.

3. **Surface delete only in the Thread detail header (not on the dashboard).** Rejected: the user explicitly asked for it "before I run test", which means they want to clean up the existing list quickly. Putting it inside the Thread itself forces them to open the Thread first.

## Uncertainties

- **U1.** Whether `events` should fire a `thread_deleted` event before the row vanishes (for any SSE subscriber currently watching the Thread). Choice: don't. The SSE stream is per-thread; if the Thread is being deleted, the subscriber's `useEffect` will tear down on navigation away from the page, and the next poll will return 404 (which the existing SSE error path already handles by reconnecting and then giving up). Adding a `thread_deleted` event kind would mean a contract change for a single short-lived signal.

- **U2.** Whether to require `status === 'unapproved'` to delete. Choice: no. The user wants to clear stuck/test Threads regardless of state. The browser `confirm()` is the only friction.

- **U3 (resolved).** Response shape. `apps/console/lib/api-client.ts`'s shared `request()` calls `res.json()` unconditionally — a 204 would throw `SyntaxError` on the empty body. Three options: (a) return 200 `{ ok: true }`, (b) add a 204-aware helper, (c) bypass `request()` and call `fetch` directly. Choosing **(a)** because every other mutation endpoint in `lib/api-client.ts` (`approveThread`, `reopenThread`, `resolveComment`, `unresolveComment`, `decideProposal`, `answerRound`, `writePlan`, …) returns `{ ok: true }`. No helper change, no special case, no inconsistency.

## Destructive action acknowledgment

The user explicitly asked for "a way so i can delet ethe existing thread" — that is the same-turn Dev approval the destructive-action gate requires. The action itself is initiated by the Dev clicking a button + confirming, not by an agent running a destructive command in the build environment. No deploys, no force-pushes, no migrations involved.

## What's intentionally NOT in scope

- A multi-select / bulk-delete UI.
- An undo / trash / archive feature.
- Telling the connected Agent the Thread is gone (the next MCP call from a deleted Thread's bearer token will 401/404; the CLI already wraps those into Dev-friendly errors and exits).
- Cleaning up any in-flight `tempo-agent connect` process the Dev may have running against a deleted Thread — they will see an error on their terminal next time they make a tool call, which is acceptable.
