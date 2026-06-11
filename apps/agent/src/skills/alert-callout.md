---
name: alert-callout
description: Author alert callouts in Plan blocks. Use when one sentence needs to interrupt the reader — a gotcha, a prerequisite, a destructive action, a temporary workaround. Encodes the four variants (info / success / warning / error), their semantic meanings, copy rules, and the callout-fatigue trap that drains every callout's signal when overused.
---

# Alert callouts in Tempo Plans

Callouts are visual *interrupts*. The Console pulls them out of the reading flow with a coloured border, a tinted background, and an icon. That visual cost has to be paid back in attention — the reader's eye stops, parses the callout, then resumes. Every callout you write competes for that budget against every other callout in the Plan.

The first rule, which dominates every other rule on this page: **use them sparingly**. A Plan with one callout sells that callout; a Plan with eight callouts sells nothing — readers learn to skip them.

## The Tempo wrapper

```html
<div class="alert alert-warning">…inline html…</div>
```

The second class picks the variant — `alert-info`, `alert-success`, `alert-warning`, or `alert-error`. **Preserve the variant class on rewrites** or the Console renders the default styling and the visual signal is lost.

Callouts accept inline HTML — `<strong>`, `<em>`, `<code>`, `<a href>`. Keep the content to one or two short sentences. Don't put a paragraph, a list, or another block inside a callout — if it needs structure, it doesn't belong in a callout.

## The four variants

Pick the variant from the *reader's required reaction*, not the topic.

### `alert-info` — context the reader needs but won't act on

Background information that changes how the reader interprets the next paragraph but doesn't demand action. Configuration notes, version requirements, scope clarifications.

> **Use when:** "This applies only to Postgres ≥ 14." / "Numbers below are from staging, prod is ~3x." / "This Plan covers the read path only; writes are tracked separately."

### `alert-success` — a positive completed state, no action needed

Confirms that something works, that a prior decision has held up, that a constraint is already satisfied. Rare in a Plan — most Plans describe work *not yet done*. Use sparingly.

> **Use when:** "Migration is reversible — `down.sql` restores the prior schema." / "The new endpoint is already deployed behind a flag; flipping the flag is the only remaining step."

### `alert-warning` — a non-blocking hazard the reader must remember

Something that will bite if forgotten but doesn't stop the plan from proceeding. Cache invalidation gotchas, ordering constraints, brittle third-party assumptions, deprecation deadlines.

> **Use when:** "Run migrations before the rolling deploy — the new code expects the column to exist." / "This breaks if the user has more than one active session — rare today, common after the SSO rollout."

### `alert-error` — a destructive or blocking action

The reddest light. Use only when getting this wrong destroys data, breaks production, or invalidates the entire Plan. Destructive migrations, irreversible deletes, security-critical paths, anything where "oops" is unrecoverable.

> **Use when:** "Dropping `users.legacy_id` cannot be reversed — back up the column before merging." / "Do not run this on the production DB without the maintenance window scheduled — it locks the table for ~40 minutes."

## When *not* to use a callout

Most of the time. Specifically:

- **As emphasis.** If you'd otherwise write "important: …" inline, write the sentence inline. Don't promote ordinary emphasis to a callout — it drains the signal everywhere else.
- **For section openers.** A callout is not a heading. If you need to set up a section, use a heading.
- **As a quote block.** Use a real `<blockquote>` if you're quoting something. Callouts are for action signals, not citations.
- **For long content.** If the message takes more than two sentences, it's not interrupting the reader — it *is* the reader. Make it a regular paragraph or a list.
- **When the body of the Plan covers it.** If "watch out for X" is followed two lines later by "we handle X by …", neither needs a callout — the prose carries it.
- **For TODOs or open questions.** Those have their own home: the "Open questions" section at the end of the Plan, or a Discussion message asking the Dev.

## How many per Plan?

A useful rule of thumb: **one callout per ~400 words of Plan, max two per Plan in most cases**. If you find yourself writing a third, audit the first two — one of them is probably ordinary emphasis dressed up.

Long Plans (architecture overviews, multi-phase rollouts) can carry more, but the same per-section ratio holds: at most one callout per major section, ideally fewer.

## Position the callout where the reader needs it

- **Before** a step that has a prerequisite or destructive consequence — the reader needs to know before they act.
- **After** an explanation that has a non-obvious caveat — the explanation lands, then the caveat sticks.
- **Never** floating at the top of a section as a vague "FYI" — that's a paragraph with extra decoration.

## Copy rules for the callout body

- **Lead with the *what*.** First three words should tell the reader what the callout is about. *"Cache invalidation is …"* not *"It's worth noting that …"*.
- **Past tense for completed state, present tense for everything else.** "Migration is reversible." not "Migration was made reversible."
- **No "please" / "remember to" / "make sure to".** Cut the politeness; it dilutes the signal. *"Run migrations before the deploy."* not *"Please remember to run migrations before the deploy."*
- **Concrete, not abstract.** *"`users.legacy_id` cannot be reversed"* not *"this is a destructive change."*
- **One thought per callout.** If you have two warnings, write two callouts (or, better, merge them into one and reconsider whether they both need callout-level signal).

## Examples — applying every rule

Before:

> ⚠️ Note: Please make sure to back up your data before running this migration. Also remember that this migration is not reversible and will drop a column. Additionally, you should test this on staging first.

After:

```html
<div class="alert alert-error">Dropping <code>users.legacy_id</code> is irreversible — snapshot the column to <code>users_legacy_id_backup</code> before merging.</div>
```

Why the rewrite worked:

- Single thought, not three.
- Concrete column name, not "your data".
- `error` variant matches "irreversible destructive change".
- No politeness verbs.
- The "test on staging first" advice belonged in the Steps section, not the callout.

## Before you write a callout

- [ ] Does this *interrupt* the reader for a reason they'll thank me for?
- [ ] Is it one sentence (max two)?
- [ ] Is the variant picked from the reader's required reaction, not the topic?
- [ ] Is the variant class preserved exactly (`alert-info` / `alert-success` / `alert-warning` / `alert-error`)?
- [ ] Is this the only callout in its section?
- [ ] Could the same point go inline without losing meaning? If yes, do that instead.

A callout you don't write is faster to read than the one you do.
