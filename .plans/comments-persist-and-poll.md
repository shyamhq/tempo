# Plan — Comments persist on reload + Agent wakes on new Comments

## Problem statement

Two bugs reported by the Dev, both in the Comment loop:

**A. Comments don't survive a page reload / re-mount.**
When the Dev creates a Comment, the highlight + rail card appear immediately. But navigating away from the Thread and back, or refreshing, loses the highlight (the rail card still renders because the server has the row). Root cause: `PlanEditor` parses the Plan markdown into the Tiptap doc on mount, but markdown serialization (with `html: false`) strips the `<span data-comment-id>` marks on save, so on reload the doc has no marks. There is no code that re-applies `CommentMark` based on the loaded Comments — that step was never written.

**B. Comments never reach the Agent.**
Phase 2.x migrated the Agent from the Anthropic Agent SDK loop (programmatic `query()` stream) to spawning interactive `claude` with `stdio: 'inherit'`. After the Agent finishes a turn (e.g. "Plan v1 is up on the Thread."), it sits idle at the REPL prompt. Nothing wakes it when a `comment_added` event lands on the Console. The MCP `tempo_poll` tool exists, but Claude has to choose to call it, and an interactive session that thinks it's done generating won't loop back on its own. So Comments accumulate server-side and the Agent never sees them.

---

## Smallest concrete change

### Fix A — re-apply `CommentMark` after the editor mounts and whenever the Comments list changes

1. Add a `comments: Comment[]` prop to `PlanEditor` (the active list — exclude only `archived_at !== null`. Resolved-but-not-archived Comments keep their highlight per CONTEXT.md's Comment definition and the server's `listCommentsForThread` partition).
2. Add one `useEffect` in `editor.tsx` keyed on `[editor, comments]` that:
   - Skips while the composer is open (don't fight a pending mark mid-creation) and while `lastCreatedCommentId` is set (the promote effect handles the just-created one).
   - Builds the set of `commentId`s currently marked in the doc by walking the document once with `editor.state.doc.descendants` and collecting the `comment` mark's `commentId` attr.
   - For each Comment not already marked, locates the anchor in the doc and applies `setCommentMark(c.id)` over `{from, to}` via `editor.chain().setTextSelection(...).setCommentMark(...).run()`.
   - To prevent the re-apply from triggering a debounced `onSave` (which would write marks-stripped markdown back to the server and immediately invalidate the cache), use a **module-level `reapplyingMarks` boolean** (set true before `.run()`, reset right after; checked at the top of `onUpdate`). This is the committed approach per judge — does not depend on Tiptap's `chain().run({ emitUpdate: false })` whose existence in v3 we have not verified.
   - For each marked `commentId` no longer in the active list (server archived it), unset the mark over its current range.
3. Anchor-finding (`findAnchor(doc, quote, context)` — pure function, same file):
   - Reuse the algorithm spec of `apps/console/server/comments.ts` matches/findApprox so client and server agree on what "anchored" means.
   - Search the text of the document (via `doc.textBetween(0, doc.content.size, '\n')`) for the `plan_quote`. If exactly one match → use it. If multiple matches, pick the one whose 120-char window (60 before + 60 after, like the server's `plan_context`) is closest to the stored `plan_context` by character overlap.
   - Translate the text offset back to a ProseMirror `from`/`to` by walking the doc and counting characters as `textBetween` does (newlines between blocks count as 1).
   - If no acceptable match → no-op (the server should archive this comment on the next plan write; the rail card still renders, just without a highlight).
4. Thread `comments` through `thread-view.tsx`: filter `view.comments` to the active set (exclude resolved + archived) and pass to `PlanEditor`.

**File layout:**
- `apps/console/components/thread/editor/anchor-find.ts` (new) — pure function `findAnchor(doc, quote, context): {from, to} | null`. ~60 lines.
- `apps/console/components/thread/editor/editor.tsx` (modified) — adds prop, adds the one effect, calls `findAnchor`.
- `apps/console/components/thread/thread-view.tsx` (modified) — derives active Comments and passes them to `PlanEditor`.

### Fix B — Stop hook for fast reaction + `ScheduleWakeup` heartbeat for indefinite arming

The two mechanisms cover each other's gaps:

| Mechanism | Catches Comments when… | Misses when… |
|---|---|---|
| **Stop hook** (long-polls + blocks with `additionalContext`) | Claude is mid-turn or mid-stop attempt — reaction in ~5–10 s end-to-end | Claude has truly idled past the hook's long-poll window (~25 s after last turn) |
| **`ScheduleWakeup`** (Claude schedules its own re-wake) | Anytime — even after long idle, because the wake is timer-based | Model forgets to call `ScheduleWakeup` on a tick (model drift) |

Running both gives fast reaction during active turns *and* an indefinite 30 s heartbeat so the session stays "armed" past the stop-hook window.

#### B.1 — Stop hook (new code path)

1. **`apps/agent/src/cli.ts`** — add `stop-hook` subcommand alongside the existing `mcp-stdio` and `hook-relay`.
2. **`apps/agent/src/stop-hook.ts` (new)** — single-purpose child:
   - Reads hook JSON payload from stdin (same shape as `hook-relay`); ignored except for type-check.
   - Reads `TEMPO_CONSOLE_URL`, `TEMPO_CONNECT_TOKEN`, `TEMPO_THREAD_ID`, `TEMPO_CURSOR_FILE` from env.
   - Loads the cursor from `TEMPO_CURSOR_FILE`; empty/missing file ⇒ initialize cursor to `evt_00000000000000` (the zero sentinel — `newEventId(0)`'s output, recognised by `EventId`'s regex `/^evt_[0-9]{14,}$/`, lexicographically less than every real event ID so `readEventsAfter` returns events since thread creation).
   - Calls `client.poll(threadId, cursor, waitSeconds=25)` — one long-poll cycle per hook fire.
   - On timeout (no events) → writes nothing, exits 0, Claude stops normally (the `ScheduleWakeup` heartbeat catches future events).
   - On events → writes updated cursor to the file, then emits JSON to stdout:
     ```json
     {
       "decision": "block",
       "reason": "New Console events arrived. Call tempo_poll to read and act on them.",
       "hookSpecificOutput": {
         "hookEventName": "Stop",
         "additionalContext": "Pending events since last cursor: <count> events of kinds [<list>]. Call tempo_poll first to fetch full payloads, then act on each."
       }
     }
     ```
3. **`apps/agent/src/spawn-claude.ts`** — extend `hookSettingsJson()` with a `Stop` hook entry pointing at `<cli> stop-hook`. `timeout: 30` (s) so the hook can complete its 25 s long-poll without being killed. Add `TEMPO_CURSOR_FILE` to the env passed into both the child Claude and the hook commands.
4. **`apps/agent/src/connect.ts`** — at session start, create a cursor file at `path.join(os.tmpdir(), 'tempo-cursor-<sessionId>')` (sibling to the existing mcp-config tmp file), **pre-populated with `evt_00000000000000`** so the Stop hook's first read sees a valid `EventId`, and pass its path via `TEMPO_CURSOR_FILE`. Clean up in the same `finally` block as `configPath`.

#### B.2 — `ScheduleWakeup` self-loop (prompt + allow-list)

5. **`apps/console/server/initial-prompt.ts`** — append a Polling section to the rendered prompt:

   > **Polling loop.** After every meaningful action (drafting/revising the Plan, posting a Reply, answering a Round), you must:
   > 1. Call `tempo_poll` with the cursor of the most recent event you have seen (start from the `last_event_id` returned by `tempo_attach`).
   > 2. Act on every event returned: reply to new Comments with `tempo_post_reply`, re-pull the Plan if `plan_edited_by_dev` is in the batch, etc.
   > 3. Then call `ScheduleWakeup(delaySeconds=30, prompt="Continue the Tempo planning loop. Call tempo_poll with the latest cursor and act on any new events. If the Thread is approved or you have explicit instructions to stop, stop scheduling new wakeups.", reason="poll the Console for new Dev activity")` so you re-wake to poll again.
   >
   > Stop scheduling new wakeups only when (a) the Thread status becomes `approved`, or (b) the Dev tells you in chat to stop.
   > A Stop hook will also nudge you with `additionalContext` when new events arrive — when you see that, call `tempo_poll` immediately on the next turn.

6. **`apps/agent/src/spawn-claude.ts`** — add `'ScheduleWakeup'` to `TEMPO_TOOL_NAMES` (one line, alongside the Stop-hook wiring from B.1).

**File layout:**
- `apps/agent/src/stop-hook.ts` (new) — ~50 lines, single-purpose: long-poll, write cursor, emit hook JSON. Sibling of `hook-relay.ts`.
- `apps/agent/src/cli.ts` (modified) — `stop-hook` subcommand dispatch (~6 lines).
- `apps/agent/src/spawn-claude.ts` (modified) — Stop hook entry + cursor file env + `'ScheduleWakeup'` allow-list entry (~18 lines).
- `apps/agent/src/connect.ts` (modified) — create + cleanup cursor file (~6 lines).
- `apps/console/server/initial-prompt.ts` (modified) — wording change. ~12 added lines.

---

## Layer placement (rule 19)

| New / changed function | Layer | Justification |
|---|---|---|
| `findAnchor(doc, quote, context)` in `editor/anchor-find.ts` | UI helper (pure) | Operates on the Tiptap doc inside the editor module. No DB, no HTTP — purely positional math over ProseMirror. Belongs next to the editor, not in `server/`. |
| `useEffect` re-applier in `editor/editor.tsx` | UI | Imperative interaction with the editor instance; lives where the editor lives. |
| `runStopHook()` in `agent/src/stop-hook.ts` | Boundary (agent ↔ Console) | Same layer as `hook-relay.ts`: short-lived child process wrapping one HTTP call. |
| `stop-hook` subcommand in `cli.ts` | CLI entrypoint | Mirrors existing `mcp-stdio` / `hook-relay` dispatch. |
| Stop hook entry + cursor file env in `spawn-claude.ts` | CLI entrypoint | Same layer as the existing PreToolUse hook + MCP config wiring. |
| Cursor file creation in `connect.ts` | CLI entrypoint | Same `finally`-cleanup pattern as the existing mcp-config tmp file. |
| Polling instructions in `initial-prompt.ts` | Prompt | Behavioral contract with the Agent. |
| `'ScheduleWakeup'` added to `TEMPO_TOOL_NAMES` in `spawn-claude.ts` | CLI entrypoint | Same allow-list array; one entry. |

No new modules in `apps/console/server/`. No new HTTP endpoints — `tempo_poll` and the events long-poll route already cover both mechanisms.

---

## Deletion test

| New module | If deleted in 6 months, where does complexity reappear? |
|---|---|
| `editor/anchor-find.ts` | The same offset-walking logic would be inlined into the re-apply effect. Worth extracting because it's the one piece tested by inspection — the rest of the effect is plumbing. Two callers possible later: server-side `reconcileCommentAnchors` could share it, but they live in different runtimes (Node server vs. browser ProseMirror doc), so don't share yet. Pure function, single caller, easy to delete. |
| `agent/src/stop-hook.ts` | A second copy would land in `hook-relay.ts` and the two would diverge. The hook entry needs a clear single home; keeping it a sibling of `hook-relay.ts` matches the existing layout. Single caller (the hook config in `spawn-claude.ts`). ~50 lines, easy to inline if Fix B's mechanism ever changes. |

---

## Alternatives considered

### A1. Fix A: re-apply marks vs. encode marks in the markdown source

- **Chosen: re-apply on load.** Markdown stays clean (D4 — "Markdown is the source of truth"); marks are derived from the DB Comments rows.
- Alternative: enable `html: true` on the Markdown extension and serialize `<span data-comment-id>` into the markdown body. Rejected — pollutes the Plan body with HTML, breaks "Copy Plan" handoff (the Dev would paste HTML into a fresh Claude session), and the Comments table is already authoritative.
- Alternative: change the Plan body schema to carry a ProseMirror JSON tree alongside markdown. Rejected — large change to D4, contracts, server reconciliation, and the Agent's `tempo_write_plan` contract. Out of scope for a bugfix.

### A2. Fix A: where to find the anchor

- **Chosen: client-side `findAnchor` using `doc.textBetween` + char-offset → ProseMirror position walk.** Self-contained, no server round-trip per Comment, matches what the existing on-create code does (it captured `{from, to}` from the editor's own selection state).
- Alternative: server returns `{from, to}` positions with each Comment. Rejected — positions would invalidate on every plan edit; the Comment table only stores `plan_quote`/`plan_context` for exactly this reason (anchor reconciliation).
- Alternative: store ProseMirror node + offset in the DB. Rejected — same reason; quotes are stable across edits, positions are not.

### A3. Fix B: both mechanisms vs. each alone

- **Chosen: Stop hook + `ScheduleWakeup` together (belt-and-suspenders).** Stop hook gives ~5–10 s end-to-end reaction during active turns. `ScheduleWakeup` keeps the session "armed" past the stop-hook window so Comments still land after long idle. Each covers the other's failure mode (Stop hook stops firing after one timed-out cycle; `ScheduleWakeup` drifts if the model forgets the loop instruction).
- Alternative: `ScheduleWakeup` alone (prompt-only, no Tempo code). Rejected — accepted on the prior round of judge review, but the Dev correctly flagged that the model can forget the loop instruction and the 30 s tick is too slow when the Dev is actively conversing.
- Alternative: Stop hook alone. Rejected — only catches Comments that arrive within ~25 s of the Agent's last turn. Past that, the Dev would need to type to wake the session.
- Alternative: revert to the Agent SDK (`query()` streaming loop). Rejected — undoes the explicit 2.x migration to interactive `claude`; loses TTY ergonomics.
- Alternative: parallel `claude -p --resume <id>` per event. Rejected — two Claude processes race over the same session.
- Alternative: keep the current loose "Poll for new Console events with tempo_poll between actions" wording. Rejected — already proven insufficient: the model ends its turn when it thinks it's done.

### A4. Fix B: wakeup interval + long-poll wait

- **Chosen: 30 s `ScheduleWakeup` delay + 25 s long-poll inside `tempo_poll`.** Long-poll dominates: when the Agent is "armed" (either inside a wake tick or inside a Stop-hook long-poll), Dev-visible latency is **sub-second** (the longPoll's 500 ms tick reads the new event row; plus model API latency to act, typically 5–10 s end-to-end). When the Agent is *between* wakes and outside the stop-hook window, worst case is one 30 s tick. Typical latency: 1–5 s.
- Alternative: 5 s `delaySeconds` for snappier feel. Considered — would tighten the worst case to ~5 s but burns Claude turns on empty polls. If 30 s feels slow in practice, the prompt is one line to change.
- Alternative: 0 s `delaySeconds` (immediate self-reschedule). Rejected — wastes Claude turns; `ScheduleWakeup` is for genuine waits.
- Alternative: drop the 500 ms long-poll tick in `events-stream.ts` and use an EventEmitter on `appendEvent` instead (~15 lines). Not in scope — gives sub-100 ms push but the bottleneck after that is model API latency, which we cannot shrink. Filed under "Spotted but not fixed" in `AGENTS.md` for a future low-latency pass.

### A5. Fix B: cursor file storage

- **Chosen: per-session file at `os.tmpdir()/tempo-cursor-<sessionId>`.** Matches the existing `os.tmpdir()/tempo-mcp-*/config-<sessionId>.json` pattern; cleaned up in the same `finally` block in `connect.ts`. Crash-safe across hook invocations.
- Alternative: store the cursor in the Console (`sessions.last_cursor` column). Rejected — server-side state for a per-Agent-process bookmark; if two Agent processes ever attached to the same session (forbidden by D8) they'd clobber each other.
- Alternative: in-memory cursor in `spawn-claude.ts`. Rejected — hooks run as separate short-lived child processes and can't share memory with the parent.

---

## Uncertainties

- **U1 — RESOLVED.** Committed to the module-level `reapplyingMarks` boolean guard (the fallback). Does not depend on the unverified `chain().run({ emitUpdate: false })` option in Tiptap v3. The boolean is checked at the top of `onUpdate`; set true before the re-apply chain runs, reset in a microtask after. Same effect, smaller surface.
- **U2.** Whether `editor.commands.setContent(markdown, { emitUpdate: false })` already destroys all marks on the way through. The current code calls this when the external markdown changes (line 85). Since markdown can't carry the mark spans, every external update wipes marks even for unchanged comments. The new effect must therefore run *after* `setContent` resolves — depending on `markdown` in its deps will do, but watch for ordering races.
- **U3 — RESOLVED.** `claude --help` confirms `--allowedTools` is a *positive* allow-list ("Comma or space-separated list of tool names to allow"). `ScheduleWakeup` is a built-in Claude Code tool not in the current `TEMPO_TOOL_NAMES` array, so the Agent would be denied today. **Plan now includes** adding `'ScheduleWakeup'` to `TEMPO_TOOL_NAMES` in `spawn-claude.ts` as part of Fix B. No more open question.
- **U4 — MITIGATED by belt-and-suspenders design.** Whether the Agent reliably obeys the `ScheduleWakeup` instruction across many iterations is still unverifiable until manual smoke, but the Stop hook is the safety net: even if the model drifts and stops scheduling wakes, the next time it tries to stop, the hook fires its long-poll and blocks if events are waiting. The two mechanisms must *both* fail for a Comment to be lost.
- **U7 — RESOLVED.** Two related concerns about cursor handling, both addressed:
  - **Format**: empty/missing cursor file initialises to `evt_00000000000000` (the `newEventId(0)` sentinel from `event-log.ts:56`). The `EventId` contract regex `/^evt_[0-9]{14,}$/` accepts it; `readEventsAfter` returns all events with `id > cursor` so the sentinel surfaces every event since thread creation. The Agent's own MCP cursor (whatever it passes to `tempo_poll`) is unaffected — `evt_00000000000000` is also a safe initial value if the model ever needs one, since any real event ID is lexicographically greater.
  - **Sharing**: Stop hook's cursor file advances *only* so the hook doesn't re-notify on the next stop attempt; it never feeds back into the Agent's MCP-side cursor. The Stop hook's `additionalContext` instructs the Agent to call `tempo_poll` with its *own* most recent cursor (from `tempo_attach` or the prior `tempo_poll` response). The Console's long-poll is idempotent on re-read, so even if the Agent's cursor lags behind the hook's, no events are lost.
- **U5.** Does Tiptap's `Markdown.parse` (the `tiptap-markdown` extension's parser) silently drop unknown HTML even with `html: false`? If so, marks-applied-via-effect approach works cleanly. If `html: true` would be needed for some reason (it isn't here — confirmed unaltered), the whole assumption holds.
- **U6.** Edge case in Fix A: what if the Dev creates a Comment, the optimistic local state has it, then a refetch arrives before the create round-trip completes? The new re-apply effect would try to mark a not-yet-known commentId. Guard with `lastCreatedCommentId` (already in the composer store) — skip the effect while the promote-pending-mark effect is in flight.

---

## Destructive actions

None. No data migration, no schema change, no hook-skipping, no `rm -rf`, no force-push. All changes are additive in code; existing behavior is preserved on the wire.

Dev acknowledgment of destructive actions: **N/A** — no destructive actions in this plan.

---

## Out of scope

- Backfilling marks for historical Comments on Threads that were created before this fix lands. The re-apply effect handles them automatically on next mount.
- The EventEmitter-on-`appendEvent` upgrade (~15 lines) that would drop the 500 ms long-poll tick floor to sub-100 ms push. Filed as a follow-up in `AGENTS.md` → "Spotted but not fixed". Not needed for the Stop hook to feel instant — model API latency dominates.
- Polling for clarification-round events (the same Stop-hook covers any event kind; no special-casing needed in this plan).
- Updating tests — repo has no tests (T12).

---

## Pickup notes

After APPROVED:
1. Implement Fix A — pure UI work, ships independently. (a) `anchor-find.ts` pure helper. (b) `editor.tsx` re-apply effect with `reapplyingMarks` boolean guard. (c) `thread-view.tsx` filters Comments by `archived_at === null` (resolved stays in) and passes to `PlanEditor`.
2. Implement Fix B:
   - (a) `apps/agent/src/stop-hook.ts` (new) — long-poll, write cursor, emit `{decision:"block",additionalContext:...}` if events.
   - (b) `apps/agent/src/cli.ts` — `stop-hook` subcommand dispatch.
   - (c) `apps/agent/src/spawn-claude.ts` — Stop hook entry in `hookSettingsJson()` with `timeout:30`; add `'ScheduleWakeup'` to `TEMPO_TOOL_NAMES`; pass `TEMPO_CURSOR_FILE` env.
   - (d) `apps/agent/src/connect.ts` — create/cleanup cursor file alongside mcp-config.
   - (e) `apps/console/server/initial-prompt.ts` — polling-loop instruction (Stop-hook nudge + `ScheduleWakeup` heartbeat).
3. Add the AGENTS.md "Spotted but not fixed" entry for the EventEmitter-on-`appendEvent` push upgrade (drops 500 ms tick floor).
4. Manual smoke: (a) refresh a Thread with existing Comments → highlights re-appear. (b) post a Comment while the Agent is mid-turn → Stop hook delivers within ~10 s. (c) post a Comment after the Agent has been idle for several minutes → `ScheduleWakeup` heartbeat catches it within ~30 s.
5. Run `code-simplifier` + `everything-claude-code:code-reviewer` per CLAUDE.md.
6. Commit.
