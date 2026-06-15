---
name: handoff-prep
description: Polish a Plan for the Approve → Copy → paste-into-Claude-Code handoff. Use in the final iteration before the Dev clicks Approve. Encodes the self-containment rules, the conversational-artefact scrub, and the block-type considerations that determine whether the copied markdown lands cleanly as a prompt for a fresh agent session.
---

# Handoff prep

When the Dev clicks **Approve**, the Plan is frozen and a Handoff card appears with a **Copy Plan** button. The button copies the Plan rendered as markdown — that markdown is then pasted into a fresh Claude Code session as the executing agent's prompt. That fresh agent has none of the Discussion context, none of the Comment thread, none of the Clarification Rounds, and no memory of who said what. It has the Plan and only the Plan.

This skill is what you read on the iteration *before* Approve. The Plan you wrote during iteration is for the Dev; the Plan that gets copied is for a different agent in a different session. The two often need to differ on the margins.

## The handoff principle

> The Plan that gets pasted must be a self-contained executable specification for someone with no Thread context.

If a reader who has never opened this Thread would be confused, the Plan isn't ready. Every reference to prior conversation, every implicit "as we discussed", every unresolved question that the Discussion answered but the Plan didn't absorb — these are the friction points that make the executing agent ask clarifying questions of a Dev who isn't in the loop anymore.

## The pre-Approve audit

Before the Dev approves, walk the Plan once with the four checks below.

### 1. Scrub conversational artefacts

Any phrase that implies a prior conversation is a leak from the Discussion. Replace it with the underlying fact.

| Leaks | Replace with |
|---|---|
| *"As discussed above, …"* | the fact itself |
| *"Per the Dev's note, …"* | the fact, stated directly |
| *"After some back-and-forth, …"* | (delete the sentence) |
| *"We landed on …"* | *"The approach is …"* |
| *"Initially we considered X but went with Y because …"* | *"Y, because …"* — or move the rationale to an "Alternatives considered" subsection |
| *"You mentioned …"*, *"the Dev wants …"* | the fact, stated directly |

The Plan is third-person, present tense, declarative. It is not a conversation summary.

### 2. Resolve every TODO and open question

The "Risks and open questions" section is the *only* section where uncertainty is acceptable in the executing handoff. Even there, every open question must have a resolution noted before Approve:

- **Answered in the Discussion?** Pull the answer into the Plan and delete the question.
- **Deferred to a follow-up Thread?** Reword as a "Follow-up Thread X tracks …" line and delete the question.
- **Genuinely open and the executing agent should ask?** Rare. Mark explicitly: *"Open — needs a decision from the Dev before implementation. Stop and ask."*

Anywhere else in the Plan: zero TODOs, zero "TBD", zero "we still need to figure out". The executing agent will not "figure out" — they will guess and ship the guess. Resolve before Approve.

### 3. Concrete file paths and identifiers

The executing agent reads the Plan with cold context. They do not know which file `the storage layer` lives in, what `the existing handler` is called, or where `the relevant types` are defined. Replace every such reference with the path + line where possible.

| Vague | Concrete |
|---|---|
| *"the existing storage layer"* | *"`apps/console/lib/r2.ts`"* |
| *"the relevant types"* | *"`packages/contracts/src/http.ts:42`"* |
| *"as it does today"* | quote the 3 lines or cite the file:line |
| *"the same pattern we used for X"* | *"the pattern in `apps/console/server/sessions.ts:84`"* |

When you cite a line, double-check it — if the file has changed since you read it, the citation is worse than no citation at all.

### 4. Block types — what survives the copy

The Console renders four rich block types. They translate to markdown with different fidelity:

| Block | Survives copy? | Notes |
|---|---|---|
| `mermaid-diagram` | Yes — pastes as a fenced ` ```mermaid ` block. Claude Code renders it back in the next session. | Round-trips cleanly. |
| `alert-callout` | Partially — markdown has no native callout. Pastes as a `> blockquote` with the variant lost. | Acceptable for `info` / `warning`; consider promoting destructive `error` callouts to a section heading like "**Destructive: …**" so the signal isn't lost. |
| `code-block` | Yes — fenced ` ```ts ` etc. | Round-trips cleanly. Make sure the language tag is set correctly before approve. |
| `html-block` | **No** — pastes as raw HTML. Claude Code can read it, but it's noise in a planning prompt, and the iframe-only behaviour (Tailwind via CDN, etc.) doesn't apply once it's text in a session. | Delete or convert to a prose description + a small flowchart. Keep HTML blocks for *Console-side review only*; replace them in the final Plan with their textual equivalent. |

If the Plan has html-blocks, ask the Dev before Approve: *"The HTML mockups are useful for review here, but they won't paste cleanly into a fresh Claude Code session. Want me to swap them for prose + a flowchart before you Approve?"*

### 5. Voice and tense

The Plan-as-prompt reads as instructions to an agent. Adjust voice if it drifted toward narration during iteration.

- **Imperative or declarative, not narrative.** *"Add a new env var R2_ACCOUNT_ID."* not *"We'll need to add a new env var R2_ACCOUNT_ID."*
- **Present tense for the design, imperative for the steps.** *"The Console signs the URL via R2. Steps: 1. Add the env var. 2. Implement the signer."* not *"The Console will sign the URL."* (will-tense reads as RFC).
- **Third-person where you have to refer to roles.** *"The Console …"*, *"The Agent …"*, *"The Dev …"* — never *"you"* or *"we"*.

### 6. Compress the front, expand the back

The first three sections (Problem / Outcome / Success criteria) were sized for the stakeholder audience during iteration. The executing agent needs them shorter — *they* aren't deciding whether to do the work; they're doing it.

A reasonable rule: **trim the framing sections by ~30% for Approve**. Keep the Problem statement (cold context still needs it), shorten the Outcome to bullets, and compress Success criteria to a checklist.

The Approach, Steps, and Risks sections often *grow* during the polish pass, because every vague reference gets replaced with a concrete one.

## Self-containment checks

Read the Plan once as if you have never opened this Thread. Flag anything that triggers a "wait, what?" reaction.

- Every acronym defined or expanded on first use.
- Every product noun explained ("the Console" → "the Tempo web UI at /threads/…" on first mention if the executing agent might not have project context).
- Every external dependency named with a version, not just *"the latest"*.
- Every assumed environment variable named in full caps with its expected source (`R2_ACCOUNT_ID` from the workspace secrets in `apps/console/env.ts`).
- Every API contract referenced by file:line in `packages/contracts/**`.

If the executing agent would still need to read the Discussion to answer a question, the Plan failed the self-containment test.

## Add a "How to execute this Plan" section if the Plan is non-trivial

For Plans of meaningful size (≥ 3 days of work), add a short executor-facing section just before "Risks and open questions". It's not part of the canonical seven; it's a courtesy to the next agent.

```
## How to execute this Plan

Run the Steps in order. Each Step is one PR. Don't batch Steps unless the
diff is genuinely tiny.

After each Step:
- `bun run typecheck && bun run lint` from the repo root must pass.
- Open a PR titled "[Step N] <Step's leading imperative>".
- Wait for the Dev's review before starting Step N+1.

Stop and ask the Dev if:
- Any Step's actual diff would meaningfully change the contract in
  `packages/contracts/**` from what the Plan describes.
- A required env var or secret isn't already configured.
- Any test fails for an unrelated-looking reason — that's usually a sign
  the Plan missed something.
```

This is the closest thing the Plan has to a runbook. Two paragraphs of execution discipline saves an hour of confusion.

## Worked example — before/after handoff polish

### Before (iteration draft, still has Discussion residue)

> ## Approach
>
> As we discussed, we're going to swap MinIO for R2. The Dev mentioned that the storage layer already has an adapter pattern, so this should be a fairly small change. We'll need to figure out the migration window — let's plan to talk about that after this Plan is approved.
>
> The existing code does it like this today, so we'll use the same pattern for the new code.
>
> TBD: pre-signed URL TTL — we said 30 minutes but might want longer for slow networks.

### After (handoff-ready)

> ## Approach
>
> The Console replaces the MinIO storage backend with Cloudflare R2. The existing storage adapter (`apps/console/lib/r2.ts`) is already S3-compatible — only the env vars and the endpoint base URL change. The browser uploads bytes directly to R2 via a 30-minute pre-signed PUT URL signed by the Console. The Console verifies upload existence with a HEAD request before recording the message + attachment rows in one transaction.
>
> The migration window is scheduled in a follow-up Thread (see Step 6).

The second version: no "as discussed", no "the Dev mentioned", no TBD. Pre-signed URL TTL is named (30 minutes) and the rationale is implicit in the Steps. The migration window is delegated to a follow-up Thread — explicit, not an open question.

## Before the Dev clicks Approve

- [ ] Zero TODOs / "TBD" / "we still need to figure out" outside the Open questions section?
- [ ] Open questions section is either empty or each item is marked with a clear next step (resolved into the Plan / tracked in Thread X / explicit "stop and ask")?
- [ ] Every vague reference replaced with a concrete file:line / identifier / version?
- [ ] Conversational artefacts ("as discussed", "you mentioned") all rewritten as direct facts?
- [ ] Voice is imperative/declarative present tense, not narrative future tense?
- [ ] Front sections compressed (~30%) and back sections sharpened for the executor?
- [ ] HTML blocks removed or converted (they don't paste cleanly)?
- [ ] Mermaid diagrams round-trip-safe? (Run the `mermaid-diagram` checklist.)
- [ ] Callouts use the right variant — and `error` variants are also called out in section headings so the signal survives the markdown copy?
- [ ] Plan length proportional to the work (≈ one screen per day)?
- [ ] Cold-read test: would a fresh agent who never opened this Thread know what to do?

The Plan you approve is the prompt the executing agent will spend the next session running against. Spend the last 10 minutes making it one less round-trip away from done.
