---
name: grill-the-ask
description: Stress-test an under-specified Thread before writing the Plan. Use when the Thread title and initial Discussion give a vague direction ("Replace MinIO with R2", "Add SSO", "Speed up search") without naming the constraints, the acceptance criteria, the rollout plan, or the design space. Adapts the grill-me interview pattern for Tempo's structured question batches — codebase exploration first, then a batched walk of the decision tree, each question paired with a recommended answer.
---

# Grill the ask

When a Thread opens with a vague direction — *"Replace MinIO with R2"*, *"Add SSO"*, *"Make search faster"* — drafting a Plan against that direction guesses at half the decisions and writes a Plan the Dev will mostly delete. The cure is to interview before you draft.

This skill is adapted from [Matt Pocock's `grill-me`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md). The original asks questions one-at-a-time. Tempo's Discussion supports structured question batches (1–10 questions per Message, rendered as a stepper), so this version walks the decision tree in *batches per decision area* rather than one prompt at a time. The principles transfer; the mechanics differ.

## When to grill

Grill when **any of these is true**:

- The Thread title names a tech (*"Replace MinIO with R2"*) without naming the problem (*"uploads fail silently"*).
- The initial Discussion message is under two sentences and the work is multi-day.
- You can imagine 3+ materially different Plans that would all match the stated direction.
- The decision has wide blast radius (contract change, schema migration, public API, destructive action) and the constraints aren't given.

Do *not* grill when:

- The ask is a bugfix with a clear repro.
- The ask is a typo, copy change, or one-line config edit.
- The ask is a refactor where the goal is "preserve behaviour".
- The Dev has already given the constraints inline ("Replace MinIO with R2, target by Friday, no migration downtime, audit-log all attempts" — that's enough; draft).

## The grill principle

> Walk the decision tree from the root. Resolve each branch before drafting the next. For each open decision, **provide a recommended answer** along with the alternatives.

The recommendation does three things at once:
1. **Speeds up the Dev's reply** — agreeing with the recommendation is one click.
2. **Demonstrates your reading of the codebase** — *why* you recommend X is implicit in the option order and the per-option notes.
3. **Surfaces your own blind spots** — when the Dev rejects your recommendation, *why* they rejected it is the missing constraint you need.

A grill without recommendations is interrogation. A grill with recommendations is a design conversation.

## Step 1 — Read the repo first

Before composing a single question, exhaust the codebase. Most "vague" Threads are vague because the agent hasn't yet read the code that would constrain them. If a question can be answered by reading, *read*.

Specifically:

- **Where does the named thing live today?** *"Replace MinIO"* → find every reference to MinIO. Adapter, env vars, docker-compose, callsites.
- **What patterns does the repo already use?** A new auth flow follows the existing auth flow; a new storage backend follows the existing storage backend. The first place to look is "what did we do last time?".
- **What contracts are involved?** Any change in `packages/contracts/**` raises the blast radius. Read the contract before asking about the change.
- **What's the existing test/CI surface?** Tells you what counts as "done" without asking.

Aim to walk into the grill with a draft *recommendation* for every decision area, justified by something concrete in the repo. If you can't, the question you'd ask the Dev is too high-level — read more, ask less.

## Step 2 — Map the decision tree

Sketch the open decisions, mentally or in a scratch note. Group them by *decision area* — each area becomes a question batch.

For the *"Replace MinIO with R2"* example, the tree might look like:

```
A. Migration cutover
  A1. Cutover strategy (dual-write / read-fallback / blue-green / hard switch)
  A2. Cutover window (now / scheduled / waits for low-traffic)
  A3. Existing data fate (migrate all / migrate on-access / leave as cold archive)

B. Wire path
  B1. Upload path (server-relay / browser-direct via pre-signed URL)
  B2. Download path (server-relay / browser-direct via signed GET)
  B3. SSRF guard / origin allowlist (carry over from MinIO / new policy)

C. Operational surface
  C1. Audit log of upload attempts (none / event-log / external metric)
  C2. Cost monitoring (none / dashboard / alert threshold)
  C3. Failure mode when R2 5xxs (block / queue / read-only banner)
```

Three decision areas → three question batches, in dependency order (A is foundational, B depends on A, C depends on B). Each batch has 2–3 questions max — keep batches small so the Dev can answer one batch without losing context across questions.

## Step 3 — Draft each batch with recommendations

For each question:

1. **Phrase it as a `single_choice` if you can enumerate options.** Recommendations are clearest when the choice space is explicit.
2. **Lead the option list with your recommendation, marked `(recommended)`.**
3. **Each option carries a 1-line note** on the tradeoff, not just the name. The Dev shouldn't have to ask "why X over Y?" — your note answers it.
4. **`allow_other: true`** when the option list is your best enumeration but not exhaustive.
5. **Provide a 1-sentence framing message before the batch** explaining what decision area this batch covers. The framing is a normal Discussion message, not part of the question prompts.

### Worked example — Batch A (cutover)

Framing message (sent as a normal Discussion text Message before the batch):

> Three decisions on cutover. I've recommended a default for each based on the existing dual-write pattern in `apps/console/server/event-log.ts`, but happy to redirect.

Question batch:

```
Q1 (single_choice): Cutover strategy?
  • Dual-write for 7 days, then cut reads over (recommended) — lets us verify R2 in prod without committing
  • Read-fallback (R2 first, MinIO if miss) — slower at the edge, simpler to roll back
  • Hard switch on cutover day — fastest, riskiest, needs a maintenance window
  allow_other: true

Q2 (single_choice): Cutover window?
  • Scheduled — next Tuesday 02:00–04:00 UTC (recommended) — matches the on-call rotation handoff
  • Anytime in the next 24h — fastest delivery, requires you to be available
  • After the marketing launch settles (3+ weeks out) — lowest user-impact risk
  allow_other: true

Q3 (single_choice): Fate of existing MinIO data (~40 GB)?
  • Migrate everything once, before cutover (recommended) — clean slate post-cutover
  • Migrate on first access — defers the cost, complicates reads for a week
  • Leave as cold archive in MinIO, reference by URL — cheapest, requires keeping MinIO running
```

The Dev answers in one stepper pass. You absorb the answers, then send Batch B, then Batch C.

### Worked example — Batch C (operational), informed by Batch A's answers

Framing:

> Last batch, on operational surface — these depend on the dual-write strategy you picked, so I waited to ask.

```
Q1 (single_choice): Audit log of upload attempts?
  • Add to the existing event log (recommended) — `apps/console/server/event-log.ts` already journals attachment events
  • New `upload_attempts` table — finer-grained, more code
  • Skip — sample from prod logs later if needed
  allow_other: true

Q2 (single_choice): Failure mode when R2 5xxs during writes?
  • Read-only banner; block writes until R2 recovers (recommended) — matches our existing maintenance pattern
  • Queue writes to a local outbox; drain when R2 recovers — durability, more infrastructure
  • Fail loudly; user retries — simplest, worst UX
  allow_other: true
```

## Step 4 — Absorb the answers, draft the Plan

Once the batches are answered, you have a constrained design space. Restate the constraints in 1–3 sentences as a Discussion message before drafting, so the Dev can correct any misreading before the Plan iterates:

> Going with: dual-write for 7 days, scheduled cutover Tuesday 02:00 UTC, one-time bulk migration of existing files. Audit log writes into the existing event log; R2 5xx during writes flips the Console to a read-only banner. Drafting the Plan now.

Then draft. The Plan should now feel obvious — most decisions are locked, and you're filling in the implementation Steps.

## Anti-patterns

### Grilling on the wrong axis

You spent the grill picking the storage backend (R2 vs S3 vs Backblaze) when the Dev already named R2. The Dev clicked through the batch, picked R2, and lost time. Read the Thread *and* the codebase before grilling — if the constraint is given, don't grill it.

### Grilling instead of reading

You asked "where does the storage adapter live today?" when the file is `apps/console/lib/r2.ts` and one grep would have shown you. Every codebase-answerable question you ask trains the Dev to skip the stepper next time.

### Recommendations without rationale

Marking an option `(recommended)` without a per-option note is a vote, not a recommendation. The Dev can't agree with you unless they can see what you're recommending against. One sentence per option is the right cost.

### Five-question batches with shallow questions

Two well-chosen `single_choice` questions are better than five `open_text` questions that each demand a paragraph. Per-batch comfort tops out at ~3 well-formed questions.

### Grilling when the Dev wants to talk

If the Dev's opening Discussion message is a paragraph that already names the constraints, *don't grill*. They've handed you the design space; draft the Plan and ask one specific question only if something specific is missing. Grilling against a Dev who's already been generous reads as not-listening.

## Before you grill

- [ ] Is the ask actually under-specified, or did I just not read the codebase enough?
- [ ] For each decision I'm about to ask about, do I have a recommendation backed by something specific?
- [ ] Have I grouped questions into 2–3 batches by decision area, in dependency order?
- [ ] Each batch ≤ 3 questions, each question one decision, each option a labelled tradeoff?
- [ ] Recommendation leads every `single_choice` option list, with a 1-line rationale?
- [ ] Framing message before each batch explains the area being decided?
- [ ] After answers land, will I restate the constraints in 1–3 sentences before drafting?

The grill you don't run is a Plan you don't have to rewrite. Spend ten minutes on questions to save an hour on iteration.

## Reference

- Original *grill-me* skill (one-question-at-a-time variant): https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md
- Complementary skill in this set: `asking-clarifying-questions` (the mechanics of writing one good question; this skill is the strategy of writing a *sequence* of them).
