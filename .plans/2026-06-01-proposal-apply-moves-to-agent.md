# Move proposal application from Console to Agent

## Problem

When the Dev accepts an Agent's `edit_proposed` reply, the Console tries to apply the replacement to the Plan via `applyReplacement` / `replaceSection` in `apps/console/server/replies.ts:73-118`. That function does a brittle case-insensitive substring match on markdown heading text. Two real bugs sit on top of it:

1. The Agent's `target_section` was `"### 1. Resolve action in the collapsed view"` (literal `### ` prefix included, plus the word "the"). The Plan heading is `"### 1. Resolve action in collapsed view"` (no "the"). `replaceSection` strips `#` from the heading line but not from `target_section`, then does a substring match — silent no-op.
2. Even when target_section drops the prefix, any phrasing drift between the proposal and the Plan heading produces a silent no-op. The Dev sees "Accepted" but the Plan is unchanged. No event, no error.

Architectural root cause (CLAUDE.md / CONTEXT.md): **structural markdown rewriting is LLM work, not Console work.** The Console is UI + coordination; the Agent is the only LLM in the system. Today the Console owns a regex-based section editor — exactly the kind of dumb adapter that the Agent could do precisely with its full understanding of the Plan + the comment context.

## Smallest concrete change

1. **`apps/console/server/replies.ts`**: delete `applyReplacement` and `replaceSection`. `decideProposal` still updates `replies.proposal_status` and emits the `proposal_decided` event — that part is unchanged. The early-return short-circuit on `decision === 'accepted'` goes away.
2. **`apps/console/server/initial-prompt.ts`**: in the polling-loop section, add one bullet telling the Agent that when a `proposal_decided` event arrives with `decision='accepted'`, the Agent must `tempo_pull_plan` and `tempo_write_plan` to apply the replacement itself (and post a short text reply confirming). When `decision='rejected'`, just continue — no Plan change.

Nothing else changes. Database schema, contracts, MCP tools, UI all stay the same. The `target_section` / `replacement` fields on `edit_proposed` payloads keep their meaning — the Agent reads its own proposal back from the reply (already visible in the comment) and applies it.

## Alternatives considered

1. **Fix `replaceSection` to be more robust** (strip `#` from target, fall back to whole-document diff, etc.). Tradeoff: keeps the Console doing markdown structural editing — violates layer placement (CLAUDE.md "Business rules → server/<domain>/**, never structural-text logic in the coordination layer"). Each new edge case (renamed heading between propose and accept, multi-heading sections, code-fence collisions) adds more regex. The Agent already has the judgment for this; the Console doesn't.
2. **Require the Agent to send the full new Plan markdown with every `edit_proposed`** (drop `target_section`/`replacement`, send `new_full_plan`). Tradeoff: bigger payloads, the diff in the UI becomes "diff two full plans" instead of "show this section swap". The structured proposal stays human-reviewable; this alternative makes the UI worse for marginal benefit.
3. **Selected: Console emits `proposal_decided`; Agent applies on accept.** Tradeoff: adds one round-trip (Console event → Agent poll → Agent writes Plan) and a brief window where status='accepted' but Plan not yet rewritten. Acceptable: the Agent polls every 30s (already), and on accept it's typically already at the front of its loop. The Dev sees "Accepted" then the Plan updates seconds later, with a confirmation text reply. This matches how the Agent already handles every other "do the structural thing" — `tempo_write_plan` is its tool, not the Console's responsibility to invoke on its behalf.

## Uncertainties

- The Agent's reaction time. The polling cadence is 30s; on a fresh accept, the Stop-hook nudge fires immediately if the Agent is idle, so latency should be sub-second to a few seconds in practice. If it lags, that's a polling-cadence issue, not a correctness issue.
- The prompt change needs to be specific enough that the Agent reliably acts. The existing prompt already says "Act on every event returned: ... tempo_pull_plan if plan_edited_by_dev appears, etc." — that `etc.` is the gap. I'll replace it with an explicit case for `proposal_decided`.
- There's a subtle case: the Dev could accept a proposal while the Agent has already written a newer Plan that the proposal was authored against. The Agent should `tempo_pull_plan` first and reconcile — that's exactly what an LLM is better at than a regex.

## Layer assignment

- `decideProposal` stays in `apps/console/server/replies.ts` (business rule: record decision, emit event). Side-effect of mutating the Plan moves out.
- No new function added. The Agent's `tempo_pull_plan` + `tempo_write_plan` MCP tools already exist; only the prompt changes.
- `initial-prompt.ts` is a server module already; the new behavior is described in prose there, not in new code.

## Deletion test

Each thing I'm deleting:

- **`applyReplacement`**: if deleted in 6 months, the complexity reappears as… nothing. The Agent already pulls/writes the Plan on every other meaningful action. There is no pass-through here — the function is being moved across a layer boundary to where it belongs (LLM judgment).
- **`replaceSection`**: same. The function is a regex-based heuristic for a job the Agent does natively.

The Plan's section-replacement logic doesn't disappear — it lives in the Agent's judgment per call. That's correct: the cost of doing it precisely (read the Plan, identify the section, write the new Plan) is exactly the cost the LLM is built to pay.

Each thing I'm adding:

- One new bullet in `initial-prompt.ts` describing the `proposal_decided` case. If deleted in 6 months, the Agent might skip applying accepted edits. That's a real loss — the prompt is the canonical instruction. Not a pass-through.

## Destructive actions

None. No `git push`, no migration, no package publish, no `rm -rf`. Code-only edits to two files plus an opt-in plan note. No Dev acknowledgment required.

## Vocabulary check

Words used: Agent, Dev, Console, Thread, Plan, Comment, Reply, polling loop, proposal_decided event. All match CONTEXT.md. "Section" used informally for "markdown heading + body" — fine, that's not a Tempo noun.
