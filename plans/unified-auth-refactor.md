# Unified Auth Refactor — Plan (revised, ponytail pass)

## Problem statement

Worker has three Bearer flavors (`sk_agent_*`, `sk_user_*`, Clerk JWT) and
three entry points (HTTP browser, HTTP CLI `/api/agent-events`, MCP). The
current shape stores raw fields on `res.locals` (`userId?`, `workspaceId?`,
`authSource`) and every handler manually branches on `authSource`,
re-derives the workspaceId differently per source, and hand-writes the 403.

Three concrete pains hit during live test of slice 1c-2b:

1. Default Clerk JWTs don't carry `org_id` → every browser → Worker call
   returned 403.
2. `auth.ts` browser branch stored `claims.org_id` (a *Clerk* org id) into
   `res.locals.workspaceId` (a *Tempo* internal id). Type mismatch latent
   for a week.
3. `if (!workspaceId) → 403` only checked "user has *some* active org",
   never that user is a member of *this thread's* workspace.
   Cross-workspace authorization hole.

The CLI branch is correct (every route calls `assertMembership`). Browser
and MCP branches are not. We're not adding a fourth conditional — we're
collapsing all three into one canonical shape.

## What every consumer actually wants

A route handler asks one question: *"can this caller act on this resource?"*

It does not care which Bearer prefix arrived. The polymorphism over Bearer
type belongs inside the auth module, not spread across every handler / MCP
tool / route file.

## The shape

**One file. Two functions. Three Express middlewares. One error class.**

```ts
// apps/worker/src/auth.ts (replaces the existing auth.ts; ≈ 130 LOC total)

export type Caller =
  | { kind: 'agent'; workspaceId: string }
  | { kind: 'cli'; userId: string }
  | { kind: 'browser'; userId: string };

export class ForbiddenError extends Error { constructor(public reason: string) }

declare global { namespace Express { interface Request {
  caller: Caller;
  workspaceId: string;   // set by ensureThread/CommentAccess
}}}

// Parse Bearer → identify caller. Throws ForbiddenError on bad bearer.
async function identify(header?: string): Promise<Caller>;

// Caller + threadId → workspaceId, or throw. The only place the kind
// switch lives. agent: workspaceId match. cli/browser: assertMembership.
export async function authorizeThread(caller: Caller, threadId: string): Promise<string>;

// Express middlewares — the only thing routes touch:
export const bearerAuth: RequestHandler;          // sets req.caller; 401 on fail
export const ensureThreadAccess: RequestHandler;  // reads req.params.id, sets req.workspaceId; 403 on fail
export const ensureCommentAccess: RequestHandler; // resolves commentId → threadId, then same; 404 if no comment
```

That is the entire surface.

## How routes look

```ts
app.post('/api/threads/:id/plan', bearerAuth, ensureThreadAccess, writePlanHandler);
app.post('/api/threads/:id/discussion/messages', bearerAuth, ensureThreadAccess, createDiscussionMessageHandler);
app.post('/api/comments/:id/replies', bearerAuth, ensureCommentAccess, createReplyHandler);
app.delete('/api/comments/:id', bearerAuth, ensureCommentAccess, deleteCommentHandler);
// ... (8 browser routes + 1 CLI route + /mcp)
```

Auth shape is in the route declaration. Handlers carry no auth code.

## How handlers look (after)

```ts
export const writePlanHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const parsed = WritePlanRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await writePlan(req.params.id, parsed.data.pm_json, 'dev');
    res.json({ ok: true, updated_at: result.updated_at });
  } catch (err) {
    if (err instanceof InvalidPlanBodyError) {
      res.status(400).json({ error: 'invalid_input', message: err.message });
      return;
    }
    logger.error({ err }, 'writePlan failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
```

Compared to before:
- No `const { authSource, workspaceId } = res.locals;`
- No `if (authSource !== 'browser' || !workspaceId) → 403;`
- No `if ((await requireBrowserMembership(...)) === null) return;`

Pure domain code. The 4-line auth ceremony is gone.

## MCP path

`/mcp` route: `bearerAuth` middleware identifies caller, then
`handleMcpRequest(req.caller, req, res)` dispatches as today. The transport
layer's `AuthContext` becomes `Caller` (same data, single source of truth).

`tempo_attach` and any future thread-scoped MCP tool calls
`await authorizeThread(caller, threadId)` directly. The current
`agent + browser carry workspaceId` branch in `attach.ts:71-78` is deleted.

## Alternatives considered

### A. Tactical helper per route flavor (current half-done state)

`requireBrowserMembership(res, userId, threadId)` for browser; existing
inline `assertMembership` for CLI/agent. Per-handler branches stay.

- **+** Smallest possible diff.
- **−** Doesn't solve the shape. Adding a new flavor or moving an
  endpoint between flavors keeps requiring per-handler edits.
- **−** Leaves `res.locals.workspaceId` as a sometimes-set field
  that TypeScript can't help with.
- **−** Doesn't fix the MCP path or `attach.ts`.

### B. Authenticator interface + 3 impl classes + `auth/` directory

(The previous draft of this plan.)

- **+** Symmetric source dispatch.
- **−** Three implementations of an interface where each impl is 20–30
  lines is a tax. The dispatch is one `switch` — promoting it to
  polymorphism costs more lines than it saves.
- **−** 5 new files, ~250 LOC added, ~120 LOC deleted. Net positive.

### C. Single file, function + middleware (this plan)

- **+** ~80 LOC added (one file). ~200 LOC deleted across 14 handlers.
  Net deletion.
- **+** Routes become declarative: `bearerAuth, ensureThreadAccess,
  handler`. Auth is visible at route registration, not buried in the
  handler body.
- **+** No new directory. One file replaces the old auth.ts, the two
  tactical helpers, and the per-handler ceremony.
- **+** Stays inside Express's native middleware composition — no library
  needed.
- **−** A union-typed `Caller` with a `switch` inside `authorizeThread`.
  Three branches, all real today.

### D. Express `app.param()` middleware

`app.param('id', authorizeThreadParam)` runs the gate any time a route has
`:id`. Even thinner per-route.

- **+** Zero per-route auth code (after `app.param` registration).
- **−** `:id` is overloaded: in `/api/threads/:id/*` it's a threadId; in
  `/api/comments/:id/*` it's a commentId. `app.param` can't distinguish
  by parent path without re-introducing a switch on URL.
- **−** Hidden behavior — "where is this authorized?" requires reading
  two files. Slightly less local than route-chain middleware.

**Picked C.** D's thinness is real but the URL ambiguity makes it less
useful than it sounds. C keeps everything visible at the route registration
site, which is where developers look when reading a router.

## Library decision

**No new library.** Express 5 native middleware composition is the
canonical answer. `passport` / `casbin` / etc. would add more surface
than they save. `express-async-errors` is unnecessary on Express 5 (async
errors propagate to error handlers natively). `zod` already covers input
validation.

The Dev signaled willingness to add libraries if they help. They don't
here — the standard Express idiom is already as terse as the LOC count
suggests.

## Layer placement

Per CLAUDE.md §"Layer placement":

- `apps/worker/src/auth.ts` — business rules (authorization). Calls into
  `auth-lookup.ts` (DB) and `@clerk/backend` (external SDK).
- DB queries (`lookupWorkspaceByAgentKey`, `lookupUserByToken`,
  `assertMembership`) — stay in `apps/worker/src/server/auth-lookup.ts`.
  The two `requireBrowserMembership*` helpers I added during the tactical
  fix are deleted (their job moves into `auth.ts`).
- Route handlers — no auth code, just domain logic and input validation.
- Express module augmentation lives next to the consumer interface in
  `auth.ts`.

## Deletion test

If `apps/worker/src/auth.ts` is deleted in 6 months, the complexity
reappears as:

1. Three-branch Bearer parsing inline in routes (it was already there).
2. Per-route `assertMembership` calls (already there in CLI; needs to be
   added to browser).
3. Per-route 401/403 try/catch (already there).
4. The `agent + browser` source branching in `attach.ts` (already there).

Cleared — the file replaces what's already in the codebase, not
anticipated future complexity.

## Naming nits from judge

- `Caller` instead of `Authenticator` — describes *what the object is*
  (an authenticated caller), not *what it does* (authenticate). Adopted.
- Error body: standardize on `{ error: 'forbidden' }` across all 403s.
  Previous mix of `'not_a_member'` / `'no_active_org'` collapses; flag in
  commit message so any future audit-log consumer is not surprised.

## Uncertainties

- **Per-request Clerk SDK call cost.** `authorizeThread` calls
  `clerk.organizations.getOrganizationMembershipList` on every CLI and
  browser request. Today: ~100–300 ms per call. Acceptable for MVP.
  AGENTS.md "Spotted but not fixed" entry with revisit trigger ("> 100
  Clerk calls / min in real profile").
- **`req.auth` vs `req.caller` + `req.workspaceId`.** Going with two
  fields. Pro: each field's type is direct. Con: marginally more
  surface than `req.auth.caller` / `req.auth.workspaceId`. The two-field
  shape mirrors how the data is set (one by `bearerAuth`, one by
  `ensureThreadAccess`) — semantically honest about *which middleware*
  put the field there.
- **`res.locals` global type stays for now.** The `workspaceId?: string`
  declaration in the old auth.ts becomes unused — remove it. The new
  `Request` augmentation replaces it.

## Destructive actions

None. No schema migration. No deploy. No force push. The Bearer formats
and route URLs don't change — Console and Agent CLI see no wire-level
difference.

## Execution order

1. Land the new `auth.ts` with `bearerAuth`, `ensureThreadAccess`,
   `ensureCommentAccess`, `Caller`, `ForbiddenError`, `authorizeThread`,
   and the `Express.Request` augmentation.
2. Remove `requireBrowserMembership*` from `auth-lookup.ts` (added during
   the tactical fix earlier today). Keep `assertMembership` (used by
   `authorizeThread`).
3. Update `index.ts`: mount `ensureThreadAccess` / `ensureCommentAccess`
   on each browser route. Replace `/mcp` route's manual `res.locals`
   dispatch with `req.caller`.
4. Update `transport.ts`: `AuthContext` is now `Caller` (rename or alias).
   `authMatches` compares `kind` + identity.
5. Update `attach.ts`: drop source branching; call
   `await authorizeThread(caller, threadId)`.
6. Strip per-handler auth ceremony from the 8 browser routes + the
   `agent-events` route + `routes/threads/access.ts`.
7. Delete the old `Express.Locals` `workspaceId / userId / authSource`
   global declaration.
8. AGENTS.md note: Clerk SDK per-request cost; auth shape rebuilt as
   part of slice 1c-2b.

Typecheck, lint, build at each step.
