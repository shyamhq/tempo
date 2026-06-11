---
name: code-block
description: Author code blocks in Plan blocks. Use when concrete syntax matters — the exact SQL, the exact config, the exact API shape, the exact CLI invocation. Encodes language-tag conventions, length limits, elision rules, and the situations where a code block is the wrong tool entirely.
---

# Code blocks in Tempo Plans

Code blocks exist for one reason: when the exact syntax is the point. The schema migration's exact SQL, the env var's exact name, the request body's exact shape, the CLI flag's exact spelling. If the reader could paraphrase your code block and not lose anything, you wrote prose with extra ceremony — delete it.

## The Tempo wrapper

```html
<pre><code class="language-typescript">…code…</code></pre>
```

Replace `typescript` with the actual language tag. The class is load-bearing — without it the Console renders the block as plain `<pre>` with no syntax highlighting.

Two reserved language tags belong to other block types:

- `language-mermaid` → rendered as a Mermaid SVG. See the `mermaid-diagram` skill.
- `language-html-block` → rendered as a sandboxed iframe. See the `html-block` skill.

Anything else (`typescript`, `tsx`, `javascript`, `python`, `sql`, `bash`, `shell`, `json`, `yaml`, `toml`, `dockerfile`, `go`, `rust`, `kotlin`, `swift`, etc.) renders as a syntax-highlighted code block. If the snippet has no natural language (a directory tree, a log line, a pseudocode sketch), use `language-text` or `language-plaintext`.

## When code blocks are the right tool

- **Exact SQL** for a migration, the part of the migration the reviewer needs to verify.
- **API request/response shape** that the implementer will encode literally (Zod schema, OpenAPI snippet, sample JSON).
- **CLI invocation** the Dev will run verbatim, including flags and example values.
- **Config snippet** (`.env`, `tsconfig.json` fragment, a single `package.json` script) where the keys matter.
- **A short before/after diff** of a function signature or contract field.
- **Pseudocode** for a non-trivial algorithm where prose is ambiguous.

## When code blocks are the wrong tool

- **Sketching architecture.** Code blocks are not whiteboards. Use a flowchart or sequence diagram.
- **Pasting whole files.** If you'd paste 200 lines, the Plan is the wrong artefact — the file lives in the repo. Show the 5 lines that matter; reference the file path for the rest.
- **As a sentence highlighter.** A single `function` name or `--flag` reads better inline as `<code>function</code>` than wrapped in a fenced block.
- **For data dumps.** A 60-row JSON example is noise. Show the shape (5 rows max) and describe the rest.

## Length limits

The hard rule: **20 lines per snippet, 30 in exceptional cases**. Longer than that and you're either dumping context the Plan doesn't need or splitting concepts that should be separate snippets.

If your snippet is hitting 25 lines, do one of these:

1. **Elide aggressively.** Replace the irrelevant middle with `// … unchanged …` or `// 50 lines of validation …`. Keep what the reviewer must verify; cut what they can take on faith.
2. **Split.** Two 12-line snippets with a sentence of prose between them read faster than one 24-line snippet.
3. **Reference the repo.** `// See \`apps/console/server/plan.ts:84\` for the existing handler.` then show only the diff.

## Elision conventions

Use comments in the snippet's native language:

- TypeScript/JS: `// … unchanged …` or `/* … unchanged … */`
- Python/Bash/YAML: `# … unchanged …`
- SQL: `-- … unchanged …`
- JSON: there is no comment syntax. Either use `"…": "…"` as a sentinel key/value, or switch the snippet to JSON5 / annotated YAML for the example.

When eliding inside a function:

```typescript
async function approveThread(threadId: string) {
  await assertWorkspaceAccess(threadId);
  // … existing validation, ~15 lines …
  await db.update(threads).set({ status: 'approved' }).where(eq(threads.id, threadId));
}
```

When eliding inside an object:

```typescript
const plan = {
  id: 'plan_…',
  body_pm_json: { /* … verbatim PM JSON … */ },
  updated_at: new Date(),
};
```

## Annotation in prose, not in comments

Code blocks are short for a reason; explanation belongs *before or after* the block, not crammed into comments inside it.

Bad:

```typescript
// This function checks if the user has access to the workspace.
// It throws a 403 error if not. It's called by every API route.
// We added this in Phase 5.
async function assertWorkspaceAccess(threadId: string) { … }
```

Good — explain in prose, keep the snippet tight:

> Every API route calls `assertWorkspaceAccess` (added in Phase 5) before reading or writing thread state. It throws a 403 when the active workspace doesn't own the thread.

```typescript
async function assertWorkspaceAccess(threadId: string) { … }
```

The exception: comments that explain a *non-obvious why* inside the code, the kind the implementer needs to see at the call site. Keep those.

## Substitution and placeholders

When the snippet contains values the reader must substitute, mark them clearly. Two conventions, pick one and be consistent within the Plan:

- **Angle brackets:** `tempo-agent connect <token>` — best for CLI examples, where `<…>` is a long-standing shell convention.
- **All-caps placeholder:** `DATABASE_URL=postgres://USER:PASS@HOST:PORT/DB` — best for env vars and config keys.

Never use real-looking secrets, real customer names, or real-looking production URLs. `example.com`, `alice@example.com`, `acme-corp` are the safe defaults.

## File paths above the snippet

When the snippet is *from* a specific file, name the file in the prose immediately above:

> Add to `apps/console/server/threads.ts:42`:
>
> ```typescript
> export async function approveThread(threadId: string) { … }
> ```

The reader's first question is always "where does this go?" — answer it before they have to ask.

## Diffs

For before/after, prefer two short labeled snippets to one diff-style snippet. The Console doesn't render diff highlighting specially.

Acceptable:

> **Before:**
> ```typescript
> if (!user) throw new Error('Unauthorized');
> ```
>
> **After:**
> ```typescript
> if (!user) throw new HttpError(401, 'Unauthorized');
> ```

If you must use diff format, tag it explicitly:

```diff
- if (!user) throw new Error('Unauthorized');
+ if (!user) throw new HttpError(401, 'Unauthorized');
```

`language-diff` renders with `+`/`-` line coloring in most highlighters.

## Inline `<code>` vs fenced code blocks

- Single identifier (`approveThread`), single flag (`--no-verify`), single env var (`DATABASE_URL`), single short literal (`'approved'`) → inline `<code>` in the surrounding sentence.
- Multi-line, or a snippet the reader will actually copy → fenced block with a language tag.

A function name floating alone in a fenced block is a smell. So is a 30-line block where every other line is `console.log`.

## Before you write a code block

- [ ] Does the exact syntax matter? If not, prose with inline `<code>` is enough.
- [ ] Under 20 lines (30 in exceptional cases)?
- [ ] Correct `language-…` class on the `<code>` tag?
- [ ] Elision used to cut everything the reviewer doesn't need to verify?
- [ ] File path named in prose above the snippet, if it's tied to a specific file?
- [ ] Placeholders clearly marked? No real secrets, real users, or real URLs?
- [ ] Explanation in prose around the block, not crammed into inline comments?

The right code block answers a precise question the prose has just posed. The wrong code block is a wall of text dressed as evidence.
