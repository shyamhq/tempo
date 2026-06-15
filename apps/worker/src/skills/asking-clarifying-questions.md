---
name: asking-clarifying-questions
description: Author structured clarifying questions in the Discussion. Use when the Plan you would otherwise write rests on assumptions the Dev hasn't confirmed. Encodes the three question types (single_choice / multi_choice / open_text), the anatomy of a question that surfaces a real decision, and the failure modes that produce questions Devs answer reluctantly or wrong.
---

# Asking clarifying questions

The Console renders structured questions as a stepper at the bottom of the Discussion. The Dev sees one question at a time, picks an option (or types a free-text answer), and submits. Their reply lands in the Discussion as a normal message — text formatted as `**<prompt>**\n→ <answer>` — so future Plan iterations have it in context.

The right clarifying question is faster than a wrong Plan edit. The wrong clarifying question is slower than every alternative.

## The decision: ask or assume?

Before writing a question, work through this in order:

1. **Can I read the answer from the repo?** Conventions, existing patterns, schemas, prior Plans on adjacent threads. If yes, read; don't ask.
2. **Can I infer the answer from what the Dev has already said in this Thread?** The Discussion history is in your context. Re-read it before composing a question.
3. **Is the answer a judgment call I can make confidently and reverse cheaply if wrong?** Then make it. Mention the choice in a Discussion message after the edit ("Went with X — say if Y is better.") and let the Dev redirect.
4. **Is the answer a one-way door — a contract, a destructive migration, a UX direction that's expensive to walk back?** Ask before you act. Always.

Default to acting. A confident Dev would rather correct a draft than answer fourteen questions about it.

## When asking is the right move

Ask when:

- **The codebase has a real gap** — two libraries are equally reasonable and the project hasn't picked one, the schema convention isn't established, the file lives where neither convention says.
- **Two conventions conflict** — `apps/console/server/sessions.ts` does it one way, `apps/console/server/discussion.ts` does it another, and you can't tell which is "current".
- **The Dev has given a constraint you can't satisfy** — they said "use Redis", the project has no Redis dependency, and adding one is a discussion not a code change.
- **The blast radius is wide** — anything that touches a contract in `packages/contracts/**`, a database migration, a public API surface, or a destructive action.

## The three question types

### `single_choice` — pick one from a curated list

Use when the decision has a small set of mutually exclusive answers and you can enumerate them. Most common type. The Dev sees radio buttons.

```
type: single_choice
prompt: "How should we store the token?"
options:
  - { label: "In a Postgres column on `sessions`", value: "db_column" }
  - { label: "In Redis with a 30-day TTL", value: "redis" }
  - { label: "In a signed JWT cookie", value: "jwt_cookie" }
allow_other: true
```

Rules:

- **2 to 5 options.** Six is a sign you haven't narrowed the choice yet — narrow it first.
- **Options are mutually exclusive.** If the Dev could reasonably pick two, you wanted `multi_choice`.
- **First option is the one you'd pick.** When you have a recommendation, lead with it; add `(recommended)` in the label only if the recommendation needs to be explicit. The Dev's eye lands on the first option first.
- **No "Other" unless you need it.** `allow_other: true` is for genuinely open choices. If your three options cover the design space, set it to `false` and stop signalling that you might have missed something.
- **Label, not value, carries the meaning.** The label is what the Dev reads; the value is what your next turn receives. Make labels human, values stable identifiers.

### `multi_choice` — pick any subset

Use when several options can be combined. Feature toggles, file types to include, environments to deploy to.

```
type: multi_choice
prompt: "Which environments should this run in?"
options:
  - { label: "Local dev", value: "local" }
  - { label: "Staging", value: "staging" }
  - { label: "Production", value: "production" }
```

Rules:

- **Don't use this when the Dev picks one of N.** That's `single_choice`. `multi_choice` with only one realistic answer wastes a click.
- **Order options by likelihood of being picked.** The first option should be the one you expect the Dev to check.
- **Avoid implicit ordering dependencies.** If picking "Production" requires also picking "Staging", you wanted a `single_choice` with combined options.

### `open_text` — free-form answer

Use when the answer is a value you can't enumerate: a number, a path, a name, a constraint, a quote from a doc, a paragraph of context.

```
type: open_text
prompt: "What's the maximum acceptable p95 latency for the search endpoint?"
```

Rules:

- **Ask for one specific thing.** "What's the migration strategy?" is too broad. "What's the cutover date for the new schema?" is right.
- **No multi-part open_text.** "What's the latency budget, and which queries are the hot path?" should be two questions or a discussion message.
- **State the unit or shape if it matters.** "How long should the TTL be (seconds)?" is better than "How long should the TTL be?".

## Batching

The Console accepts 1–10 questions per Message. Treat each batch as a coherent decision the Dev will make in one sitting.

- **1–4 questions per batch is the right size.** Five is the upper end of comfortable; ten is the wire-limit and should be rare.
- **All questions in a batch concern the same area.** If two questions are about the auth flow and three are about the storage backend, send two batches.
- **Order from foundational to derivative.** "Which storage backend?" before "What's the TTL?". The Dev's later answers may depend on their earlier ones.

## Anatomy of a good question

A good clarifying question…

1. **Surfaces a real decision the Plan depends on.** If the answer wouldn't change what you write next, don't ask.
2. **Has one decision per prompt.** Split "X and also Y" into two questions. Bundled prompts get bundled answers — and you'll guess which half of the answer applies to which half of the question.
3. **Is one sentence.** Two if the second is a constraint or a reference. Long prompts with framing in them indicate the framing should be a separate Discussion message above the batch.
4. **Uses concrete vocabulary, not abstract.** "Should we use connection pooling?" not "How should we approach concurrency at the data layer?". The first names a thing; the second names a concern.
5. **Doesn't lead.** "Should we go with the obviously-better option A?" is leading. "A or B?" is not.

### Examples — applying every rule

Bad:

> *Q1:* Do you think it might make sense to consider some kind of caching layer, possibly Redis or maybe something else, for the read path, and also for the write path if that's appropriate?

Why it's bad: two decisions (read path, write path), abstract verb ("consider some kind of"), hedged ("might make sense"), leading via "obviously" tone, multi-part open question disguised as one.

Good — split, narrowed, with options:

> *Q1:* `single_choice`: Cache the search-results read path?
>   • Redis with 5-min TTL (recommended)
>   • In-memory LRU per Console replica
>   • No cache — Postgres is fast enough today
>
> *Q2:* `single_choice`: Cache writes (write-through)?
>   • No — read-only cache, invalidate on writes
>   • Write-through to Redis, then Postgres

Each question has one decision, options are concrete, the recommendation leads.

## Patterns

### "Recommended-first"

When you have a default you'd ship with, put it first and tag it `(recommended)` if the recommendation isn't otherwise obvious. The Dev's "yes, that's fine" turns into one click.

```
options:
  - { label: "Redis with 30-day TTL (recommended)", value: "redis" }
  - { label: "Postgres column on `sessions`", value: "db" }
  - { label: "Signed JWT cookie — no server state", value: "jwt" }
```

### "Frame in prose, ask cleanly"

Put framing context into a Discussion message *before* the question batch. The question prompt itself stays a clean question.

> Message: *"Storage is the main open question. Three reasonable backends; each implies a different consistency story."*
>
> Question batch follows: clean prompts, no framing inside the prompts.

### "Open-text as the escape hatch"

When you genuinely don't know the answer space, `allow_other: true` on a `single_choice`, or just an `open_text` question. Don't fake options to dress up an open question.

### "One question is fine"

If you only have one clarifying question, send one question. Padding the batch to "feel structured" is exactly the kind of bad friction that trains Devs to skip the stepper.

## When to use prose instead of structured questions

Structured questions force the answer into the shape you've drawn. That's their value (you get back something you can parse) and their cost (you lose what you didn't think to ask for).

Use prose (a Discussion message ending in a question) instead when:

- **The answer is a description.** "What does the legacy behaviour actually do here?" wants a paragraph, not a radio button.
- **The Dev needs to push back on the framing.** Structured options imply you've narrowed the space; prose invites the Dev to widen it.
- **You're uncertain whether to ask at all.** The lower commitment of a prose question lets the Dev redirect ("just go ahead and pick") without filling out a form.

The system prompt covers this in the Reply/Discussion guidance: "1–3 sentences, no preamble, a specific question back is fine, a vague offer to 'help further' is not."

## Reading the answer

Replies to a structured question batch arrive as a normal Discussion Message with text formatted `**<prompt>**\n→ <answer>`. Read it as prose. There is no separate answers payload, no JSON to parse. If the Dev typed an "Other" write-in, it appears verbatim after the `→`.

If a batch had 4 questions and the reply only answers 3, the Dev intentionally skipped one. Don't ask it again — proceed with what you have and surface the gap in a Discussion message if it matters.

## Before you ask

- [ ] Could I read this from the repo or infer it from the Thread history? If yes, do that.
- [ ] If I make a confident guess and the Dev corrects me, do I lose more than ten minutes? If no, guess.
- [ ] Is each question one decision, one sentence, with concrete vocabulary?
- [ ] If `single_choice`, are options mutually exclusive, 2–5 total, recommendation first?
- [ ] If `multi_choice`, is the Dev really picking a subset (not exactly one)?
- [ ] If `open_text`, is the asked-for value specific (a number, a name, one paragraph)?
- [ ] Is the batch 1–4 questions, all concerning the same area?
- [ ] Is the framing in a Discussion message above the batch, not inside the prompts?

A question batch you don't send is faster than the one you do. Ask only the decisions the Plan can't be written without.
