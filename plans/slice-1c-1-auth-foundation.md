# Slice 1c-1 — CLI auth foundation (non-breaking)

**Status:** sub-plan, strict subset of the already-approved slice-1c
plan at `plans/slice-1c-routes-cli-migration.md`. No new judge gate
needed (a subset of an approved plan is not "materially different"
per CLAUDE.md). The full 1c plan still binds for slice 1c-2.

**Decomposition trigger:** first full-scope dispatch of slice 1c
exited mid-exploration after 110s without writing code (token /
iteration limit). Decomposed into two atomic units to fit one agent
run each.

## Problem statement

Slice 1c-1 ships the auth-side foundation needed by the eventual
new CLI: the `user_tokens` DB table, Worker's extended Bearer
middleware (now accepts `sk_user_*` and Clerk JWTs in addition to
the existing `sk_agent_*`), three new CLI auth endpoints on Worker,
one new agent-event ingestion endpoint, the Console `/cli/authorize`
page that mints OAuth codes via the user's Clerk session, the
contract additions to support all of the above, and the upgrade of
the existing slice-1b stub `tempo_attach` to take `thread_id` and
establish the sticky-session mapping.

**`apps/agent` is NOT touched in 1c-1.** The old
`tempo-agent connect <token>` CLI keeps working against Console's
unchanged MCP-adjacent routes. **Browser code is NOT touched.**
This is a strictly non-breaking change. Slice 1c-2 is the cutover.

After 1c-1, the architecture has the *capacity* to authenticate a
new CLI but no new CLI exists yet to use it.

## Smallest concrete change

### A. Database migration

In `packages/db/src/schema.ts`, two changes:

```ts
// 1. New table for user-scoped CLI tokens.
export const userTokens = pgTable('user_tokens', {
  id: text('id').primaryKey(),                    // utk_<random>
  user_id: text('user_id').notNull(),             // Clerk user id
  token_hash: text('token_hash').notNull().unique(),
  refresh_token_hash: text('refresh_token_hash').notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (t) => ({
  byUser: index('user_tokens_user').on(t.user_id),
  byTokenLookup: index('user_tokens_lookup').on(t.token_hash).where(sql`revoked_at IS NULL`),
}));

// 2. Add nullable column to sessions.
//    Existing rows stay valid (NULL). Slice-1c-1 attach writes set it.
mcp_session_id: text('mcp_session_id'),
```

Run `bun --cwd packages/db run db:generate` to produce one new
migration file. Verify the diff is exactly these two changes.

### B. Contracts (`packages/contracts/src/`)

- **`mcp.ts`**: change `AttachInput = z.object({})` to
  `AttachInput = z.object({ thread_id: ThreadId })`. Re-export from
  the barrel.
- **`http.ts`**: add CLI auth + agent-event shapes:
  - `CliExchangeRequest = z.object({ code: z.string(), code_verifier: z.string(), port: z.number().int() })`
  - `CliExchangeResponse = z.object({ token: z.string(), refresh_token: z.string(), expires_at: z.string().datetime(), user_id: z.string(), email: z.string().email() })`
  - `CliRefreshRequest = z.object({ refresh_token: z.string() })`
  - `CliRefreshResponse` — same shape as `CliExchangeResponse`
  - `ThreadAccessResponse = z.object({ thread_id: ThreadId, thread_title: z.string(), workspace_id: z.string(), workspace_name: z.string() })`
  - `AgentToolUseEvent = z.object({ tool_name: z.string(), summary: z.string().optional(), started_at_ms: z.number() })`
  - `AgentNarrationEvent = z.object({ text: z.string(), emitted_at_ms: z.number() })`
  - `AgentTodosUpdatedEvent = z.object({ todos: z.array(z.string()) })`
  - `AgentTurnEndedEvent = z.object({ duration_ms: z.number(), reason: z.enum(['done', 'error', 'cancelled']) })`
  - `AgentEventRequest = z.discriminatedUnion('kind', [ ... ])` wrapping the above keyed by `kind: 'tool_use' | 'narration' | 'todos_updated' | 'turn_ended'`
- **`workflow.ts` (new)**: not in 1c-1. Deferred to 1c-2 with the
  WORKFLOW lift.

### C. Worker — extend Bearer middleware

`apps/worker/src/auth.ts` already has the `sk_agent_*` branch from
1b. Extend to three branches:

```ts
const token = extractBearer(req);
if (token.startsWith('sk_agent_')) {
  const ws = await lookupWorkspaceByAgentKey(token);
  if (!ws) return res.status(401).json({ error: 'unauthorized' });
  res.locals.workspaceId = ws.id;
  res.locals.authSource = 'agent';
} else if (token.startsWith('sk_user_')) {
  const userRow = await lookupUserByToken(token);
  if (!userRow) return res.status(401).json({ error: 'unauthorized' });
  res.locals.userId = userRow.user_id;
  res.locals.authSource = 'cli';
  // workspaceId is NOT set here — Thread-scoped routes call
  // assertMembership(userId, threadId) to resolve it.
} else {
  // Assume Clerk JWT.
  try {
    const claims = await verifyClerkToken(token);
    res.locals.userId = claims.sub;
    res.locals.workspaceId = claims.org_id;  // present when active org is selected
    res.locals.authSource = 'browser';
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
next();
```

Specific failure semantics matching the slice-1b pattern: all 401
responses carry the same body `{ error: 'unauthorized' }` (no
enumeration signal); the *reason* logs at debug.

### D. Worker — new server modules

**`apps/worker/src/server/auth-lookup.ts`** — three lookups:

```ts
export async function lookupWorkspaceByAgentKey(token: string): Promise<{ id: string } | null>
export async function lookupUserByToken(token: string): Promise<{ user_id: string } | null>
export async function assertMembership(userId: string, threadId: string): Promise<{ workspaceId: string, memberId: string }>
  // throws NotAMemberError if user is not a Member of the Thread's Workspace
```

Each does ONE indexed query against `@tempo/db`. The third walks
`threads.workspace_id` then `members` (Clerk-synced — verify this
table exists; if not, the check uses `workspaces.org_id` →
Clerk's `getOrganizationMembership` via `@clerk/backend`).

Token-hashing: SHA-256 + `TOKEN_HASH_PEPPER` (env var). One helper
in this module: `hashToken(plaintext): string`.

**`apps/worker/src/server/cli-auth.ts`** — the OAuth code-mint
verification + user_tokens lifecycle:

```ts
export async function verifyCliCode(code: string, code_verifier: string): Promise<{ userId: string, email: string }>
  // verifies signature, nonce-not-seen, expiry, sha256(code_verifier)===challenge
  // throws InvalidCodeError on any failure
export async function issueUserToken(userId: string, email: string): Promise<{ token: string, refresh_token: string, expires_at: Date, user_id: string, email: string }>
  // mints sk_user_<32-bytes> + rt_<32-bytes>, hashes both, inserts user_tokens row
export async function refreshUserToken(refresh_token: string): Promise<{ token: string, refresh_token: string, expires_at: Date, user_id: string, email: string }>
  // rotate-on-use; throws InvalidRefreshError if used twice or revoked
export async function revokeUserToken(userId: string): Promise<void>
  // future-scope helper; not used in 1c-1 routes
```

Code minting: the code is a signed JWT minted by Console using a
shared secret with Worker (env var `CLI_AUTH_SECRET`). Worker
verifies the same secret. Nonces tracked in a small in-process
LRU (size 1000, TTL 5min) to prevent replay within an instance —
sufficient for slice 1c-1's single-worker deployment; slice 2 may
move to Redis if scaled out.

### E. Worker — new routes

**`apps/worker/src/routes/cli/exchange.ts`** —
`POST /api/cli/exchange` — calls `verifyCliCode` then `issueUserToken`.

**`apps/worker/src/routes/cli/refresh.ts`** —
`POST /api/cli/refresh` — calls `refreshUserToken`.

**`apps/worker/src/routes/threads/access.ts`** —
`GET /api/threads/:id/access` — requires `sk_user_*` or Clerk JWT.
Calls `assertMembership(req.locals.userId, params.id)`. On success,
returns `{ thread_id, thread_title, workspace_id, workspace_name }`.
On `NotAMemberError`, returns 403 `{ error: 'not_a_member' }`.

**`apps/worker/src/routes/agent-events/index.ts`** —
`POST /api/agent-events` — body validates against `AgentEventRequest`.
Auth: `sk_user_*` only (not `sk_agent_*` — agent-events are User
attribution). Includes `thread_id` in body. Worker calls
`assertMembership` then appends to event log via existing
`event-log.ts` from 1b (which is currently used only by the stub
attach — extend it minimally as needed; full lift to Worker's
server/ is slice 1c-2's job).

**Mount in `apps/worker/src/index.ts`:**

```ts
app.post('/api/cli/exchange', bodyParser.json(), cliExchangeHandler);
app.post('/api/cli/refresh', bodyParser.json(), cliRefreshHandler);
app.get('/api/threads/:id/access', bearerAuth, threadAccessHandler);
app.post('/api/agent-events', bearerAuth, bodyParser.json({ limit: '1mb' }), agentEventsHandler);
```

The exchange + refresh routes are intentionally *outside*
`bearerAuth` — the request is presenting an OAuth code or refresh
token, not a Bearer.

### F. Worker — update stub `tempo_attach` to use sticky session

In `apps/worker/src/mcp/tools/attach.ts`:

1. Change input schema to `AttachInput` from `@tempo/contracts/mcp`
   (now `{ thread_id }`).
2. Replace the slice-1b `session_id` path with this flow:
   - Read `thread_id` from args, `workspaceId/userId` from `res.locals`
   - If `authSource === 'cli'`, call `assertMembership(userId, thread_id)`
     to resolve `workspaceId` and verify access (403 on failure).
   - Look up the Thread row via `@tempo/db`; verify
     `thread.workspace_id === workspaceId`.
   - Get the `mcpSessionId` from the request (transport carries it).
   - Look up existing Session row by `mcp_session_id`; if absent,
     INSERT one with `(id=ses_<new>, thread_id, workspace_id,
     mcp_session_id, started_by=userId, status='connected')`.
   - The existing six reads (plan, comments, discussion, last_event_id, …)
     continue using the same `@tempo/db` queries from 1b.
3. Update `apps/worker/src/mcp/server.ts` tool registration to
   import `AttachInput` from `@tempo/contracts/mcp` instead of the
   ad-hoc `{ session_id: z.string() }`.
4. Delete the `TODO(slice-1c)` comment in `mcp/server.ts` — the
   divergence is now resolved.

### G. Console — `/cli/authorize` page

**`apps/console/app/cli/authorize/page.tsx`** — server component:

- Reads `state`, `port`, `challenge` from `searchParams`.
- Reads the active Clerk session (redirects to sign-in if absent).
- Renders an Allow / Deny UI with the Member's email + workspace
  context.
- On Allow click: client component calls a server action.

**`apps/console/app/cli/authorize/actions.ts`** — server action:

- Verifies the active Clerk user.
- Mints a signed JWT (the OAuth `code`) carrying
  `{ user_id, email, challenge, nonce, exp: now + 60s }`.
- The signing secret is the `CLI_AUTH_SECRET` env var shared with
  Worker.
- Returns a redirect URL: `http://127.0.0.1:<port>/callback?code=<jwt>&state=<state>`.
- Client component performs `window.location.href = redirectUrl`.

On Deny: client redirects to `http://127.0.0.1:<port>/callback?error=denied&state=<state>`.

### H. Env vars

- Worker: `CLI_AUTH_SECRET` (shared with Console; min 32 bytes),
  `TOKEN_HASH_PEPPER` (32 bytes), `CLERK_SECRET_KEY` (for
  `@clerk/backend` JWT verification).
- Console: `CLI_AUTH_SECRET` (same value as Worker).
- Both: documented in `.env.example`.

### I. Deps added

- Worker: `@clerk/backend`, `cors` (the `cors` middleware is added
  in 1c-2 with the route migration; if any 1c-1 route needs CORS,
  add it minimally here — the `/cli/authorize` redirect target is
  a localhost loopback so CORS does not apply).
- No new CLI deps yet — `apps/agent` is untouched.

Both via `bun add` per CLAUDE.md.

## Verification

- `bun install` clean
- `bun run typecheck` green across all 5 packages
- `bun run lint` clean on every new file
- `bun --cwd packages/db run db:generate` produces ONE new migration
  with exactly the `user_tokens` table + `sessions.mcp_session_id`
  column (no other diffs)
- `bun run --filter @tempo/worker dev` boots; `/health` returns 200
- Manual smoke (document for Dev):
  1. With a real Console + Worker dev setup, navigate to
     `http://localhost:3000/cli/authorize?state=test&port=49321&challenge=test`
     (no `code_verifier` — preflight test of the page rendering).
  2. Verify Allow button mints a JWT and tries to redirect to
     `localhost:49321/callback?code=...&state=test`.
  3. With `curl -X POST localhost:3001/api/cli/exchange -H
     "Content-Type: application/json" -d '{"code": "<jwt-from-step-2>",
     "code_verifier": "<original-verifier>", "port": 49321}'` — verify
     it returns a valid `{ token, refresh_token, ... }` shape.
  4. `curl -H "Authorization: Bearer <sk_user_>"
     localhost:3001/api/threads/<real-thread-id>/access` — verify it
     returns `{ thread_title, workspace_name, ... }` for a Thread the
     User is a Member of, or `403 not_a_member` otherwise.
  5. Existing `tempo-agent connect <token>` (OLD CLI) — verify it
     still works against Console unchanged.

## Out of scope for 1c-1

- `apps/agent` rewrite (1c-2)
- Moving the 17 routes from Console to Worker (1c-2)
- Registering the other 9 `tempo_*` tools on Worker MCP (1c-2)
- Browser fetch refactor (1c-2)
- Skills bundle move (1c-2)
- R2 fetcher move (1c-2)
- WORKFLOW constant lift (1c-2)
- CORS middleware mounting (1c-2)
- DNS for `worker.tempo.dev` (1c-2)
- Console MCP-adjacent route deletion (1c-2)
- `agent-harness.md` §2 update (1c-2)
- npm publish prep (1c-2)
