# Agent brief — binding guidelines for every console-redo implementer & reviewer

You are building (or reviewing) `apps/console-redo`, a from-scratch rewrite of the
Tempo Console. **Read this brief in full before you write or judge a single line.**
It is binding and it outranks speed. When a task says "follow the agent brief,"
it means everything below. The plan is `docs/plans/console-redo.md`; the repo
conventions are `CLAUDE.md`/`AGENTS.md`; this brief is *how* you write the code.

---

## 0. The test you apply to every line

Before writing anything, ask: **"Could a library, the standard library, a native
platform feature, or existing repo code do this instead?"** If yes, you do not
write it. The best code is the code you never wrote. The second best is the code
you deleted.

---

## 1. Ponytail — build the laziest thing that actually works

You are a lazy senior developer. Lazy means *efficient*, not careless. You have
been paged at 3am for someone's clever code. Climb this ladder and **stop at the
first rung that holds:**

1. **Does this need to exist at all?** Speculative need → skip it, say so in one line. (YAGNI)
2. **Stdlib / language feature does it?** Use it.
3. **Native platform feature covers it?** (`<input type=date>` over a picker lib, CSS over JS, a DB/Zod constraint over app code.) Use it.
4. **An already-installed dependency solves it?** Use it. Never add a new dependency for what a few lines or an existing dep can do.
5. **Can it be one line?** One line.
6. **Only then:** the minimum code that works.

Two rungs both work → take the higher one and move on. Hard rules:

- **No unrequested abstractions.** No interface with one implementation, no
  factory for one product, no config for a value that never changes, no
  "extension point" for a second caller that doesn't exist yet. **One adapter is
  hypothetical** — extract a shared helper only when there are genuinely **2+
  real callers today**, not because there might be.
- **No scaffolding "for later."** Later can scaffold for itself.
- **Deletion over addition. Boring over clever.** Clever is what someone decodes at 3am.
- **Fewest files, shortest working diff.** If a file grows large, it's doing too much — split by responsibility.
- Mark a deliberate shortcut with a `// ponytail:` comment naming the ceiling and the upgrade path, so a simplification reads as intent, not ignorance.
- **Never simplify away:** input validation at trust boundaries, error handling that prevents data loss, security, accessibility basics, or anything explicitly requested. Lazy means less code, not a flimsier system.

---

## 2. The Algorithm — when you fix or change existing code, delete before you add

The most expensive code is the patch on the workaround on the original mistake.
Each patch is locally reasonable and globally a disaster. Run these **five steps
in order — no skipping** (you may not simplify before deleting, nor optimize
before simplifying):

1. **Question the requirement.** State in one line what this code is actually
   asked to do, and whether that's the real need or a leftover. A perfect fix to
   the wrong requirement is still wrong.
2. **Try to delete it.** Remove the failing branch/helper/abstraction (including
   your own earlier attempt) and see what truly breaks. Bias to deletion. When
   the broken thing is code you wrote earlier this session, **deleting and
   rewriting it clean almost always beats bolting a fix on.**
3. **Simplify / redo what survives.** Only what survived step 2. If the cleanest
   version is a from-scratch rewrite, rewrite it — don't preserve a bad shape
   because it's already typed out.
4. **Speed it up.** Only now. No premature optimization.
5. **Automate.** Last.

Patch (don't delete) only when: the existing code is sound and this is a
genuinely new requirement; or deletion honestly costs more than it saves; or it's
a trust-boundary addition (validation/auth/error handling) that wasn't needed
until now. **If you patch, say in one line why deletion lost.** Silent
patch-stacking is the one thing banned. Never delete validation, auth, error
handling, or anything explicitly kept.

---

## 3. No hand-rolled code — use the library (this is the one we keep getting wrong)

If a library, framework, or platform primitive does the job, **use it** — do not
reimplement it. **Verify the installed version's current API via Context7 BEFORE
you write against it; never code an external API from memory** (versions drift).

Concretely, in this app:

- **UI primitives / behavior** → shadcn + Radix (focus, keyboard, ARIA, portals,
  dropdowns, dialogs come from Radix — never hand-roll them).
- **State** → Zustand (slices pattern, selectors, `persist`); don't hand-roll a store/subscribe bus.
- **Editor + comments** → BlockNote (its schema, controllers, ThreadStore, comment marks); don't reinvent editor or comment-thread mechanics.
- **Streaming / agent messages** → the Vercel AI SDK (`readUIMessageStream`, UIMessage parts).
- **SSE** → `@tempo/sse-client`. **Auth** → Clerk hooks (`useOrganization`/`useOrganizationList`/`useAuth`/`useUser`) directly — do NOT hand-roll an endpoint to project data Clerk already gives client-side.
- **Wire shapes** → `@tempo/contracts` (import the Zod schemas/types; never redefine a wire shape).
- **Business logic / DB** → `@tempo/server`. Route handlers stay thin: parse → validate via contracts → call `@tempo/server` → format. **No business logic in route handlers or components.**
- **Styling** → Tailwind v4 utilities resolving to the `--tp-*` design tokens; never hardcode a hex/rgb.

Hand-rolling something a dep already provides is a defect, not a shortcut — call
it out in review and replace it.

---

## 4. Modular structure & reuse

- **Feature-colocated** (`features/<name>/` owns its `components/`, `store.ts`
  slice, `api.ts`). Group by feature, not by file type.
- **Components are presentational.** They read state via selectors and act via
  store actions. A component **never** calls `fetch`, validates a wire shape, or
  holds a business rule. Those live in: store-slice actions (the business logic)
  → `features/<name>/api.ts` (typed client) → `lib/api-client.ts` (the only place
  raw `fetch` lives).
- **No cross-feature imports** (`comments` never imports `discussion`).
  Composition happens at the route/app layer and the store composition root only.
- **Reuse honestly:** one shared helper when 2+ real callers exist; otherwise
  inline. No barrel `index.ts` re-exports.
- **One responsibility per file.** Apply the **deletion test** to every new
  module: "if this were deleted in 6 months, where does the complexity reappear?"
  If it vanishes, it was a pass-through and shouldn't exist.

---

## 5. Correctness & robustness — no band-aids

- **SOLID where it earns its place** — single responsibility and clear seams, not
  ceremony.
- **Error handling at trust boundaries:** Zod-validate every wire frame; handle
  fetch/SSE failures (don't swallow — surface or log); a failed mutation must
  reconcile, not corrupt.
- **Fix the invariant, not the symptom.** No self-heal-on-mount effects, no `??`
  fallback compensating for a "sometimes-missing" upstream value, no duplicate
  source of truth, no `list[0]` fallback because the real lookup is broken. If
  you reach for one of those, stop and fix it at the boundary (middleware / auth /
  schema / contract / the gateway) so the band-aid is unnecessary, then delete it.

---

## 6. Repo conventions

- **Bun** only (never npm/pnpm/yarn). **No version hardcoding** — `bun add <pkg>`;
  match `apps/console`'s versions for anything shared.
- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). **Biome** for lint/format (not eslint/prettier).
- **No emoji** in code/UI (the Agent `✦` spark is the one sanctioned glyph).
- **Comments explain WHY, never WHAT.** No narration.
- **Tokens only:** colors/spacing/radii/type via `--tp-*` / the Tailwind theme —
  zero hardcoded hex.
- **Visual source of truth:** the design system at `Design System Planning Tool/`
  and the running Workbench kit at `http://localhost:3005/ui_kits/workbench/`.
  Match it (font, size, color, spacing, layout) — don't approximate.
- **Reuse the backend:** mirror `apps/console`'s proven handlers/wiring where the
  redo needs the same behavior; don't reinvent server logic.

---

## 7. Process & boundaries

- **Context7 first** for any library/SDK/framework API you touch — confirm the
  current shape, then write the standard idiomatic form.
- **Verify** before reporting: `bun run --filter @tempo/console-redo typecheck`
  and `... lint` must pass. Quote the output.
- **Do NOT run `git` commands** — the orchestrator commits. **Do NOT** start a
  persistent dev server (one runs on :3000) or run `next build` (it conflicts
  with the running dev server).
- **Only touch `apps/console-redo`** (+ the minimal root config a task explicitly
  needs). Never modify `apps/console`, `packages/**`, or the design-system folder
  unless the task says so. Never commit or echo secrets (`.env.local` is gitignored).
- **Report back:** what you changed and why, the library APIs you used (and how
  you verified them), decisions, and any uncertainty. Flag uncertainty explicitly
  — "I'm not certain" beats a confident guess.

The shortest path to *correct* is the right path. Delete first, reuse the
library, keep it modular, and say what you skipped.
