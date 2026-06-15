---
name: plan-structure
description: Author the top-level structure of a Tempo Plan. Use when drafting a new Plan or restructuring an existing one. Encodes the seven canonical sections, the readability principle that puts non-technical framing first, when to deviate, and the failure modes (RFC-cosplay, premature implementation detail, missing success criteria) that produce Plans no stakeholder reads.
---

# Plan structure

A Tempo Plan is read by a heterogeneous audience: the Dev who owns the change, their manager, a PM, a designer, the on-call engineer next quarter who opens the Thread cold. The structure that serves all of them is not "engineering doc, top to bottom" — it's a layered shape that lets a stakeholder decide after the first three sections, and lets an engineer execute after reading the rest.

This skill encodes that shape. The system prompt sketches it in seven bullets; this skill is what you read when those bullets aren't enough.

## The seven canonical sections

```
1. Problem
2. Outcome
3. Success criteria
4. Scope
5. Approach
6. Steps
7. Risks and open questions
```

Sections 1–3 are *stakeholder-facing* — they justify the work and define done. Sections 4–7 are *engineer-facing* — they describe execution. The Plan reads in that order so anyone can stop where their interest does.

### 1. Problem — *what's painful or missing today*

Plain language. No file paths. No code. No library names. Describe the world today in terms the user (or the team) actually experiences.

Bad: *"We need to swap MinIO for R2 because MinIO's S3 compatibility has gaps in versioned uploads and our current adapter doesn't handle them."*

Good: *"File uploads sometimes fail silently for users on slow networks. The current self-hosted storage doesn't surface partial-upload errors and the retry path is invisible. Devs can't debug failed uploads because the storage layer has no audit trail."*

Notice the second version names the experience (users, Devs), not the technology. It also doesn't smuggle in a solution ("swap MinIO for R2") — the Problem section is for *the problem*.

A Problem section is usually 1–3 paragraphs. A list of pain points is fine when there are 3+ distinct ones; otherwise prose.

### 2. Outcome — *what changes for the user (or team) when this ships*

The mirror of Problem. What will be different the day after this lands? Again, plain language, no technology.

Bad: *"R2 will be the storage backend. The adapter will use pre-signed URLs for uploads. Latency will improve."*

Good: *"Uploads succeed for users on slow networks. When an upload fails, the user sees a specific error and a retry button. Devs can see every upload attempt in the audit log."*

A good Outcome section is short — 3–6 bullets or a tight paragraph. If you can't make it concrete, the work hasn't been thought through yet; pause and grill (`grill-the-ask`).

### 3. Success criteria — *how we know it's done from outside the codebase*

The acceptance test. A list. Each item is observable by someone who isn't reading the diff.

Format: short imperative or declarative bullets. Numbers when numbers matter.

> - Users on connections under 1 Mbps complete a 5 MB upload at least 95% of the time.
> - Failed uploads surface a retry button within 2 seconds of the failure.
> - The audit log records every attempt with timestamp, size, outcome, and (if failed) the error class.
> - The old MinIO bucket is empty (or read-only) within 7 days of cutover.

Avoid: *"works correctly"*, *"is performant"*, *"is well-tested"*. None of these can be verified without reading the implementation, so they fail the section's purpose.

### 4. Scope — *what's in, what's deliberately out*

Two sub-lists, both useful. The *out* list is often more valuable than the *in* list — it's what stops scope creep and lets the Dev defend "no" to adjacent asks.

```
**In scope**
- Upload path through the Console API.
- Audit log for upload attempts.
- Migration of existing files from MinIO to R2.

**Out of scope (this Plan)**
- Image thumbnailing — tracked in Thread X.
- Download path — already runs on R2.
- Customer-facing storage usage dashboards.
```

A bug fix or a one-line change doesn't need a Scope section. A feature with any ambiguity does.

### 5. Approach — *the technical sketch*

The first engineer-only section. Now you can name modules, services, data shapes.

Lead with a 2–4 sentence summary of how it works end-to-end before drilling into details. The summary is what an engineer who reads only this section needs.

> The Console exposes a `POST /attachments/init` endpoint that signs a 30-minute pre-signed PUT URL via R2. The browser uploads bytes directly to R2 — no server hop. On success, the browser posts the attachment id to `POST /discussion/messages`; the Console HEADs R2 to verify the upload exists, then inserts the message and attachment rows in one transaction.

Then add the necessary supporting material: a sequence diagram for the upload flow, the data model changes, the new env vars, any non-obvious tradeoffs. Use `mermaid-diagram` for graphs, `code-block` for the exact data shapes, `alert-callout` for the one or two gotchas that earn a callout.

The Approach should be specific enough that the Steps section is mostly mechanical. If Steps still requires meaningful design decisions, push them up into Approach.

### 6. Steps — *concrete file-level changes, in order*

The order is the order they should happen — usually so the Plan can be split into reviewable PRs.

Format: numbered list of imperatives, each one a short paragraph or a checklist.

> 1. **Add R2 binding to env config.** Update `apps/console/env.ts` to require `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Fail boot if missing. Update `env.example`.
>
> 2. **Implement pre-signed PUT URL signing.** Add `apps/console/server/storage/r2.ts` exporting `signPutUrl(key, mime, ttlSec)`. Use `@aws-sdk/s3-request-presigner` against the R2 S3 API endpoint.
>
> 3. **Add `POST /api/attachments/init`.** Thin route handler — Clerk auth, Zod validate, call `signPutUrl`, return `{ id, put_url, expires_at }`.
>
> …

Naming files explicitly (`apps/console/server/storage/r2.ts`) lets the Dev know exactly where the new code lives and lets the reviewer find it on the diff. Vague steps ("add the storage adapter") delay execution and survive into the code as guesses.

Cite line numbers (`apps/console/proxy.ts:42`) when modifying existing files. The Plan is the address book for the change.

### 7. Risks and open questions

Two related but distinct things. Put them in one section to keep the Plan from sprawling.

**Risks** — what could go wrong in production or during rollout, and what mitigates it. Two columns of thought: the risk, then the mitigation. Use prose when the risk is one paragraph; a table when there are 3+.

> - **R2 region outage.** R2 has had multi-region partial outages. Mitigation: the migration adds a fallback to read-only mode when R2 5xxs, surfacing a banner. Writes block until R2 recovers.
> - **Migration window.** Copying ~40 GB of existing files takes ~2 hours. Mitigation: dual-write to MinIO and R2 for the first 24h; cut reads over once the copy lands.

**Open questions** — what you don't yet know. Each one should have a clear path to resolution (whose answer? when?). Open questions are the only place in the Plan where "TBD" is acceptable — and only if it has a name attached.

> - **Cutover date?** Needs alignment with the on-call rotation. Owner: @<dev>. Target: by end of this Plan's discussion.
> - **R2 cost at peak?** Awaiting a usage estimate from the analytics team.

If a Plan has more than 3 open questions, it's not a Plan yet — it's a discovery thread. Use the `grill-the-ask` skill to close them before drafting further.

## When to deviate from the seven-section shape

The seven-section shape is the default, not a law. Some changes don't deserve all seven:

- **A typo fix or copy change.** Problem + Steps. Sometimes just Steps. No Scope, no Approach.
- **A bug fix.** Problem (1 paragraph), Approach (1 paragraph), Steps. Skip Outcome / Success criteria — the test is "the bug stops happening".
- **A refactor.** Problem (why the current code is hard to change), Approach, Steps. Maybe a Risks section if the refactor touches code with thin test coverage.
- **A library swap or dependency adoption.** Problem, Approach (why this library specifically), Steps. Maybe a Risks section. Skip Success criteria — there's no user-visible outcome.

The principle stays: lead with framing the audience needs, drill into detail later. Drop sections that don't carry weight. Don't invent sections to look thorough.

## Common failure modes

### RFC-cosplay

The Plan is written like an RFC: dense, exhaustive, comprehensive, designed to anticipate every reviewer concern in writing. RFCs are for cross-team decisions; Tempo Plans are for one Dev's work, iterated in conversation with you. Length signals effort, not quality — and quadruples review time.

Symptom: Plan exceeds ~600 words for a 3-day change; reviewer feedback comes back as "TL;DR".

Fix: cut. Anything that could move to a Discussion message *is* a Discussion message.

### Solution smuggled into Problem

The Problem section names the tech ("we need to swap X for Y") instead of the pain ("uploads fail silently"). When a stakeholder reads only the first section, they get the *what* but not the *why*, and can't push back on the framing.

Symptom: Problem mentions a specific library, vendor, or file path.

Fix: rewrite the Problem section in user/team terms. The solution belongs in Approach.

### Implementation detail in Approach (and nowhere else)

The Approach section is a sequence of fine-grained code-level instructions, and the Steps section just restates it as a numbered list. The Approach should sketch the *shape*; the Steps should encode the *order*.

Symptom: Approach is 800 words; Steps is "1. Do what's in Approach above."

Fix: shrink Approach to a 2–4 sentence end-to-end summary plus the design rationale; move file-level prescription to Steps.

### Missing or vague success criteria

The Plan describes what to build but not how anyone will know it works. The Dev ships the change, and three days later somebody asks "is this done?".

Symptom: Success criteria reads *"the feature works as described"*, or the section is missing.

Fix: write 3–5 bullets the Dev's manager could check off without reading the code.

### "Open questions" is a parking lot

Open questions accumulate, never resolve, and the Plan iterates with them unanswered. Each one is a future bug.

Symptom: Open questions has 5+ items, several from earlier iterations.

Fix: turn each into a structured question batch (`asking-clarifying-questions`) or a Discussion message ending in a question. Don't let questions hide in the Plan body.

## Plan length

A useful rule of thumb: **one screen of content per day of work**. A 3-day change → ~3 screens of Plan. A 2-week initiative → ~10. If the Plan is longer than that, the audience won't read it. If it's shorter, the work probably isn't well-defined yet.

A screen is roughly 400–500 words including whitespace and blocks. Round up for diagrams.

## Before you draft

- [ ] Do I have a Problem statement in plain user/team language, not technology?
- [ ] Is the Outcome concrete enough that I could quote a bullet to a non-engineer and they'd understand?
- [ ] Are the Success criteria observable from outside the codebase?
- [ ] Does Scope explicitly call out what's *not* included?
- [ ] Does Approach lead with a 2–4 sentence end-to-end summary?
- [ ] Are Steps file-level, in the order they should execute?
- [ ] Is each Open question paired with an owner and a target?
- [ ] Have I dropped sections that don't carry weight for this size of change?

The Plan you don't write is faster to ship than the one you do. Cut what doesn't earn its place; lead with what the audience needs first.
