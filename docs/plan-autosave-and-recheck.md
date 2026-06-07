# Plan — Auto-save the Plan editor + Dev-initiated Agent recheck

## Problem

Tempo's Plan editor today uses manual-save discipline: edits flip `isDirty`, the
PlanSaveBar appears at the bottom-right, the Dev hits Save or ⌘S, and the new
blocks land on the server. Every successful Dev write also appends a
`plan_edited_by_dev` event to the event log, which the Agent's poll consumes
as a nudge to call `tempo_pull_plan`.

Two problems with that shape:

1. **The Dev's mental model has drifted.** They expect the editor to behave
   like Notion / Confluence — type, look up, see "Saved." Manual save plus a
   save bar is a constant low-grade tax, and the recent comment-creation bug
   ("commented something, refreshed, it's gone") was the same root cause: a
   non-obvious commit gesture they didn't know they had to make. The workaround
   we shipped (auto-persist on `comments.createThread`) treats the symptom; the
   cure is to auto-save everything.
2. **Every Dev write nudges the Agent.** With auto-save, that becomes a nudge
   per debounce tick — way too noisy. The Dev rarely wants the Agent to
   re-read the Plan on every keystroke; they want to nudge it explicitly when
   they're ready ("I made a few edits — go look").

## The smallest concrete change

One coordinated change that flips the save discipline and splits the Agent
nudge off into a Dev-initiated action.

### What changes

1. **Auto-save replaces manual save.** A new `usePlanAutoSave` hook holds the
   save state machine (idle / saving / saved / error). On every editor edit
   it schedules a debounced write (700ms). While a write is in flight, further
   edits queue a follow-up write that fires after the current one returns.
   `beforeunload` flushes any pending save synchronously via `navigator.sendBeacon`
   so a tab close mid-debounce doesn't lose work.

2. **Save status indicator in the header.** A `PlanSaveStatus` component sits
   in the `ThreadView` header, right of the title and left of the pills.
   Three visible states:
   - `Saving…` — actively writing.
   - `Saved` — just persisted (fades to invisible after ~2s).
   - `Save failed — retrying` — last attempt failed; backoff retry pending.
     Stays visible until the retry succeeds.
   Idle / never-edited state shows nothing.

   Backoff: 2s → 5s → 10s, then 10s thereafter. `navigator.onLine` transitions
   from offline → online trigger an immediate retry, short-circuiting the
   current backoff.

3. **Dev → Agent nudge is now explicit.** `writePlan` stops appending
   `plan_edited_by_dev` when the actor is Dev. (Agent writes still emit
   `plan_edited_by_agent` so the Console's "Plan updated by Agent" toast keeps
   working.) A new server function `requestPlanRecheck(threadId)` appends the
   `plan_edited_by_dev` event with no body change; a new
   `POST /api/threads/[id]/plan/recheck` route invokes it; a new
   `RecheckPlanButton` in the `ThreadView` header (left of Approve / Reopen)
   POSTs to that route on click.

4. **The Recheck button is disabled when no session is connected** with a
   tooltip "Connect an agent session first." (Disabling is correct UX: with
   no session attached, the event will sit unread until next attach — the
   button promises an action the system can't deliver right now.)

5. **The Save bar, Discard button, ⌘S handling, and the `PlanEditorContext`
   anchor-change callback are deleted.** Auto-save covers the comment case
   (the doc edit fires `onChange` → schedule debounced save). The discard
   flow does not exist in auto-save UX; once typed, it is saved. ⌘S falls
   through to the browser default.

### Where the new code lives (layer placement)

| File | Layer | Responsibility |
|---|---|---|
| `apps/console/components/thread/editor/use-plan-auto-save.ts` | UI (hook, colocated with editor) | The save state machine. Debounce + in-flight tracking + backoff retry + `beforeunload` flush. Returns `{ status, lastSavedAt, notifyEdit, flushNow }`. No HTTP — caller passes a `persist: (blocks) => Promise<void>` and a `getBlocks: () => PlanBlock[]`. |
| `apps/console/components/thread/recheck-plan-button.tsx` | UI | Ghost-variant button, disabled state + tooltip wired from `sessionStatus`, click posts to the recheck API. Holds its own click handler + loading state (small mutation), matching `ConnectButton` precedent. |
| (inlined in `thread-view.tsx`) | UI | `PlanSaveStatus` — pure presentation function rendering the three states from `status` + `lastSavedAt`. Lives next to the existing private functions in the file. See decision below. |
| `apps/console/app/api/threads/[id]/plan/recheck/route.ts` | route handler | Thin: parse → auth → call `requestPlanRecheck` → respond. Dev (session-cookie) or Agent-on-own-thread auth. |
| `apps/console/lib/api-client.ts` | client lib | Adds `recheckPlan(threadId)` method. |
| `packages/contracts/src/http.ts` | contracts | Adds `RecheckPlanResponse = z.object({ ok: literal(true), updated_at: IsoTimestamp })`. No request shape (empty body). |

### Hook location decision

`use-plan-auto-save.ts` lives at `apps/console/components/thread/editor/use-plan-auto-save.ts`, NOT under `apps/console/hooks/`.

Rationale: the hook's interface (`persist`, `getBlocks`, `notifyEdit`, `flushNow`) is laser-scoped to the Plan editor's persistence loop and is only ever called from `thread-view.tsx`. The cross-cutting hooks already in `apps/console/hooks/` (`use-thread-events`, `use-attachment-uploader`, `use-sidebar-state`) are either reused across views or expose generic event-stream / file-upload primitives. `use-plan-auto-save` is neither — its only caller is the Plan editor surface, and its `getBlocks` callback is coupled to the BlockNote editor handle. Co-locating it with `plan-editor.tsx`, `use-plan-save.ts` (which it replaces), and the other editor pieces matches CONTEXT.md's locality principle.

### Presentational components decision

- **`PlanSaveStatus`** — **inlined** as a private function inside `thread-view.tsx`, matching the existing `RepoChip` and `EmptyPlanState` precedents in that same file. ~25 lines of pure rendering driven by `status` + `lastSavedAt` props; no internal state, no mutation, no external import surface required. A separate file would only add one name and one import for zero leverage.
- **`RecheckPlanButton`** — **separate file** at `apps/console/components/thread/recheck-plan-button.tsx`, matching the `ConnectButton` precedent at `apps/console/components/thread/connect-button.tsx`. The button holds its own click handler, "sending…" loading state, and the `api.recheckPlan` call. The disabled-state-with-tooltip logic ties it to `sessionStatus`. Same shape and scope as `ConnectButton`; pulling it into a file keeps `thread-view.tsx` from accumulating mutation-handler clutter.

### What gets deleted (deletion test)

- `apps/console/components/thread/editor/plan-save-bar.tsx` — manual-save artifact. Complexity does not reappear; auto-save covers it.
- `apps/console/components/thread/editor/use-plan-save.ts` — replaced by `use-plan-auto-save.ts`. The state machine is fundamentally different (no `isDirty` / `discardKey`), so this is a rewrite, not a rename.
- The `PlanEditorContext` + `usePlanEditorAnchorChange` plumbing inside `plan-editor.tsx`, and the matching call in `plan-comment-composer.tsx`. With auto-save, the comment-creation edit fires `onChange` and the debounce schedules a save like any other edit. No special case needed.

For each new file added — if we deleted it in six months, where does the complexity reappear?

- `use-plan-auto-save.ts` — the state machine has to live somewhere; the editor cannot inline it without losing its single responsibility (rendering BlockNote). Five well-defined concerns (debounce / in-flight / queue / backoff / flush) make this a legitimate module.
- `recheck-plan-button.tsx` — direct precedent in `connect-button.tsx` with the same shape; the click + mutation + loading state is enough surface area to name.
- `recheck/route.ts` — single endpoint, but route handlers are one-file per Next.js convention.

### Current on-disk state (verified before this revision)

- `apps/console/server/plan.ts`: `requestPlanRecheck(threadId)` **already exists** (lines 50–54). `writePlan` **already** conditionally appends `plan_edited_by_agent` only for the agent actor (lines 41–44). Both shipped during the previous turn's symptomatic fix. **Step 1 below skips them.**
- `apps/console/app/api/threads/[id]/plan/recheck/route.ts`: **does not exist.** Step 1 creates it.
- `recheckPlan` method in `apps/console/lib/api-client.ts`: **does not exist.** Step 1 creates it.
- `RecheckPlanResponse` in `packages/contracts/src/http.ts`: **does not exist.** Step 1 creates it.

### Implementation order

Each step is independently buildable.

1. **Recheck wiring.** Add `RecheckPlanResponse = z.object({ ok: z.literal(true), updated_at: IsoTimestamp })` to `packages/contracts/src/http.ts`. Add `recheckPlan(threadId)` to `apps/console/lib/api-client.ts`. Add the route handler at `apps/console/app/api/threads/[id]/plan/recheck/route.ts` (Dev auth — session-cookie header — and Agent-on-own-thread allowed for symmetry). The server function `requestPlanRecheck` and the `writePlan` event-emission change are already live; do not re-edit them.
2. Build `apps/console/components/thread/editor/use-plan-auto-save.ts` (see "Hook location" decision below) with the state machine. No UI wired yet.
3. Build the recheck button at `apps/console/components/thread/recheck-plan-button.tsx` (see "Presentational components" decision below). `PlanSaveStatus` is inlined into `thread-view.tsx`, no new file.
4. Update `thread-view.tsx`: replace `usePlanSave` with `usePlanAutoSave`. Drop `PlanSaveBar` mount. Drop `discardKey` (the editor no longer remounts on discard — there is no discard). Inline a `PlanSaveStatus` private function and mount it in the header. Mount `RecheckPlanButton` in the header.
5. Delete `plan-save-bar.tsx`, `use-plan-save.ts`, the `PlanEditorContext` / `usePlanEditorAnchorChange` pieces of `plan-editor.tsx`, the `usePlanEditorAnchorChange` import + `await onAnchorChange?.()` call in `plan-comment-composer.tsx`. Remove the "PlanEditor key={discardKey} remount drops in-progress comment composer" entry from `AGENTS.md` Spotted-but-not-fixed (this change closes it).
6. Run `code-simplifier` and `code-reviewer` per AGENTS.md §21–22.

## Alternatives considered

### A. Keep manual save; just remove the Dev-side event append.

Manual save bar stays. The `plan_edited_by_dev` event is gone from `writePlan`
and the Recheck button replaces the auto-nudge.

Tradeoffs:
- Smallest diff. No state-machine, no debounce, no status indicator.
- Doesn't address the real source of the comment-disappears bug — the Dev's
  mental model. The recent symptomatic fix (auto-persist on
  `comments.createThread`) would have to stay, complete with its
  `PlanEditorContext` plumbing.
- Save bar continues to clutter the UI.

**Rejected** because the Dev explicitly asked for Notion / Confluence-style
auto-save, and the workaround we shipped last session is exactly the kind of
half-measure that points at a missing capability.

### B. Auto-save *and* keep the Dev-side event append.

Every debounced auto-save fires `plan_edited_by_dev`. The Agent's poll sees a
flood of nudges; the Recheck button isn't needed.

Tradeoffs:
- Zero new UI for "nudge the Agent."
- Catastrophic Agent UX: a re-read on every 700ms of typing. Token spend
  multiplied, the Agent's turn gets repeatedly preempted, and the event log
  fills with `plan_edited_by_dev` entries that mean nothing individually.

**Rejected** as user-hostile to the Agent surface.

### C. Auto-save on a longer debounce (e.g. 3s) and emit `plan_edited_by_dev` per save.

Same shape as B but slower. The hope: fewer events, no Recheck button needed.

Tradeoffs:
- Still emits an event per "burst" of edits. The Dev's intent isn't "nudge
  per burst," it's "nudge when I'm ready to hand off." The 3s threshold is
  the wrong abstraction.
- Longer debounce also makes the save status feel laggy.

**Rejected**: the event-emission decision is orthogonal to the save-cadence
decision; mixing them ties two unrelated knobs together.

## Decisions resolved before judge re-review

### Final unload flush uses `fetch(…, { keepalive: true })`, not `sendBeacon`

`navigator.sendBeacon` sets `Content-Type: text/plain;charset=UTF-8` for a string body (or `application/octet-stream` for a Blob unless the Blob is explicitly constructed with `{ type: 'application/json' }`). The existing `parseBody` helper in `apps/console/server/http.ts` calls `req.json()` unconditionally, and the existing `WritePlanRequest` route validates against a Zod schema. A beacon would either reject at `parseBody` or require server-side Content-Type / Blob-decoding logic that the regular auto-save call does not need.

`fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks }), keepalive: true })` sidesteps the problem entirely: same Content-Type as every other auto-save call, normal JSON request body, no route changes, no `parseBody` change, no Blob wrapping. The `keepalive` flag gives the same unload-survival guarantee in all browsers that support BlockNote (Chrome 66+, Safari 13+, Firefox 75+, Edge 79+), and unlike `sendBeacon` the request returns a normal `Promise<Response>` we can ignore on unload.

Trade-off: `keepalive` has a 64 KB body cap per origin. A typical Plan body fits well within this; if a future Plan grows past 64 KB the unload flush silently fails (the auto-save will have caught the same content during the previous debounce tick if the Dev paused for >700ms — the unload path is a last-resort safety net, not the primary save path). Acceptable.

## Uncertainties
- **In-flight save vs. agent overwrite race.** If the Agent writes the Plan
  while a Dev auto-save is in flight, the Agent's `plan_edited_by_agent`
  event fires; the Console refetches; the editor remounts (because
  `initialBlocks` changed via the `view.plan.body.blocks` memo). Mid-typing
  remounts would be disastrous. The current code uses `discardKey` to control
  remount; removing it means we need a different guard. **Mitigation:** stop
  recreating the editor on every `initialBlocks` change. Mount once with the
  initial value and rely on the auto-save + Agent toast for reconciliation;
  the Dev can explicitly refresh if they want the Agent's edits. Last-write-
  wins stays; we don't try to merge. **This is a real behavioural change and
  the judge should weigh in.**
- **Recheck button when no session.** Disabled with tooltip is the
  recommended UX, but the event still has value queued (any *future* session
  attach will see it). The judge may prefer "always enabled, optimistic" —
  the cost is the Dev clicking a button that does nothing perceptible.
  **Default chosen: disabled with tooltip.**
- **Debounce duration.** Notion uses ~500-1000ms; Confluence ~1-2s. 700ms is
  the proposed default. Easy to tune.
- **Save-status fade timing.** "Saved" stays visible ~2s before fading.
  Linear-style products vary. Easy to tune.

## Destructive actions

No `git push`, no deploy, no migration, no external messages. The auth wall
on the recheck route gates Agent-only behaviour; Dev calls require the
session-cookie header path. No `body_blocks` or other data is touched
destructively.

The implementation deletes:
- `apps/console/components/thread/editor/plan-save-bar.tsx`
- `apps/console/components/thread/editor/use-plan-save.ts`
- The `PlanEditorContext` / `usePlanEditorAnchorChange` plumbing in
  `plan-editor.tsx`
- The `usePlanEditorAnchorChange` + post-create persist call in
  `plan-comment-composer.tsx`

The Dev explicitly directed this — quoting verbatim:

> Cool We do not need to process the entire plan through agent aftter
> editing then. So lets instead add a button somewhere which can recheck
> the entire plan. the button should be muted

> You know what lets auto save everything. show a saving.... on top
> somewhere. Have good UI UX similar to notion / confluence.

## Vocabulary check

- The button uses the verb "Recheck" + the noun "plan" — stays inside the
  Plan / Comment / Reply / Agent / Dev vocabulary. Not "review," not "process."
- The status indicator uses "Saving…" / "Saved" / "Save failed — retrying."
  No "syncing," no "drafting," no "uploading."
- The hook is `usePlanAutoSave` — names the Plan it operates on, not "editor."
- The new server function is `requestPlanRecheck` — `request` is the verb
  the contract uses elsewhere (`CreateCommentRequest`), and the noun is the
  artifact (Plan recheck).
- No "service," no "manager," no "controller" creeping in.
