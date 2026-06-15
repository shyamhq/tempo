# `@tempo/server` — extraction plan

**Problem.** Eleven server-domain modules live duplicated under `apps/console/server/**` and `apps/worker/src/server/**` after slice 1c-2b. Six are byte-equivalent twins; two (`threads.ts`, `plan.ts`) are subset/superset variants kept in lock-step by hope. Drift breaks Plan round-trip silently. Beyond drift, the split obscures where business logic lives — Worker should be free to focus on transport (MCP endpoint, Hosted-VM driver, Gateway, browser HTTP), not own a copy of the data layer that Console also owns a copy of.

**Smallest concrete change.** Create one workspace package — `@tempo/server` — that owns every server-domain module (Thread runtime + R2 + Workspace-admin business logic). Both `apps/console` and `apps/worker` import it. Each app keeps only its transport-shaped code: Console keeps Next.js route handlers, SSR pages, Clerk webhook, `actor.ts`; Worker keeps the MCP server, Express routes, `auth-lookup.ts`, `cli-auth.ts`, the SSE route handler.

**Layer assignment (every new file).**

| File in `packages/server/src/` | Layer | Why here |
|---|---|---|
| `ids.ts` | leaf util | no deps — pure ID generators |
| `r2.ts` | adapter | S3 client + signed URLs; only adapter the package owns |
| `event-log.ts` | business | append + read protocol; cursor semantics; URL re-signing |
| `events-stream.ts` | business | `longPoll` + `sseStream` — pure cursor-poll loops over `event-log` |
| `attachments.ts` | business | row lifecycle + R2 verification |
| `replies.ts` | business | flat-list reply append, attachment-aware |
| `comments.ts` | business | anchor lifecycle, replies, attachments, events |
| `discussion.ts` | business | message append (text + questions), events |
| `sessions.ts` | business | session lifecycle, presence, race-free disconnect |
| `threads.ts` | business | thread CRUD (union of both apps' current surfaces) |
| `plan.ts` | business | plan read/write, block-html orchestration |
| `plan/block-html.ts` | business | jsdom round-trip (PM ↔ HTML) |

**Stays in `apps/console/server/`:**
- `actor.ts` — uses `auth()` + `clerkClient` from `@clerk/nextjs/server`, Next.js-bound
- `clerk-webhook.ts` — webhook handler shape; consumes Clerk's `WebhookEvent`
- `email.ts` — Resend SDK + Next.js env; admin-only
- `http.ts` — response shape helpers for Next route handlers
- `workspaces.ts` — zero Worker callers today; "one adapter is hypothetical." Imports `@clerk/nextjs/server`. Moves only when the Hosted-Agent driver (or any Worker code path) actually needs Workspace reads — at that point it's a half-day lift.
- `spaces.ts` — zero Worker callers today. Uses React's `cache()` for SSR dedupe; moving would force `react` into the shared package or a re-export shim. Stays.

**Stays in `apps/worker/src/server/`:**
- `auth-lookup.ts` — MCP session-id → thread-id; sk_user_* hash lookup; Worker-process internal
- `cli-auth.ts` — connect-token issuance + Clerk JWT decode for browser routes

**Stays in `apps/worker/src/`:**
- Everything under `mcp/**` — MCP server + tools (transport)
- Everything under `routes/**` — Express handlers, including the SSE route adapter that pipes `sseStream(threadId, cursor)` (the package's business logic) into an Express `text/event-stream` response
- `index.ts`, `env.ts`, `logger.ts`

**Alternatives considered.**
1. **Worker absorbs everything; Console fetches over HTTP** (Option B in the options HTML). Strongest alignment with the business model literally — but adds an HTTP hop to every Console SSR read and creates a Console-Worker availability coupling. User-rejected in favour of the in-process shared package; revisit later if drift returns or the Hosted-Agent driver wants stricter isolation.
2. **Vertical per-noun packages** (`@tempo/plan`, `@tempo/comments`, …). Fails the deletion test on the split itself — collapsing them back loses no insight, only adds ceremony. Premature seams.
3. **Hand-written `@tempo/worker-client` typed client.** Not needed in this slice; revisit when a second non-Console consumer of Worker's HTTP appears (e.g. the Hosted-Agent driver wants to call the same browser routes from outside its process).

**Deletion test on `@tempo/server` itself.** Delete it → every business-logic file reappears as duplicate trees under both apps (literally today's state). Concentrates, doesn't move. Passes.

**Uncertainties.**
- `events-stream.ts` calls `setInterval` / `setTimeout` directly. Acceptable in a Node-only package, but if we ever want this package to run inside a Cloudflare Worker or Edge runtime, this changes. Not a near-term concern.
- `events-stream.ts` twins have one real divergence: Console writes `evs[evs.length - 1]!.id`, Worker writes `evs[evs.length - 1]?.id ?? current`. **Use the Worker variant** when consolidating — non-null assertion is unsafe under `noUncheckedIndexedAccess`.
- `CONTEXT.md` line 91 names `apps/console/server/attachments.ts` as the Attachment noun's canonical home. After step 4, update it to `packages/server/src/attachments.ts`. One-line edit; doesn't block the move.

**Order of commits.**

1. Scaffold `packages/server` (empty src, package.json, tsconfig, biome inherit).
2. Move `ids.ts` + `r2.ts`; rewrite imports; delete duplicates.
3. Move `event-log.ts` + `events-stream.ts`.
4. Move `attachments.ts` + `replies.ts`.
5. Move `comments.ts` + `discussion.ts`.
6. Move `sessions.ts` + `threads.ts` (union surface) + `plan.ts` + `plan/block-html.ts`. **`threads.ts` moves with Console's existing N+1 `listThreads` session-status loop intact** — no drive-by fixes mid-move. Log the join optimisation under `AGENTS.md` → "Spotted but not fixed."
7. Final sweep: delete any stragglers, typecheck, lint, one full smoke flow (Dev posts comment → other Dev sees via SSE → Local Agent sees via `tempo_poll`). Update `CONTEXT.md` line 91 to point Attachment at its new home.

Each step is one commit. After each commit, both apps compile, both apps run, the smoke flow works. Worker's `apps/worker/src/server/` shrinks to two files (`auth-lookup`, `cli-auth`); Console's `apps/console/server/` shrinks to six (`actor`, `clerk-webhook`, `email`, `http`, `workspaces`, `spaces`).
