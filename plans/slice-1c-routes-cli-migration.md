# Slice 1c — Migrate MCP routes + reshape `apps/agent` (formal plan)

**Status:** detailed plan, ready for judge review. Supersedes the
rough stub formerly at this path.

## Problem statement

Slice 1a extracted `packages/db`. Slice 1b stood up `apps/worker` as
an Express + `@modelcontextprotocol/sdk` v1.29 host with a single stub
`tempo_attach` tool reading via `@tempo/db`. The topology flip is half
done.

Today's runtime path is still: user runs `tempo-agent connect <token>`
→ CLI spawns `claude` subprocess + embeds the Claude Agent SDK loop +
runs an in-process stdio MCP server whose tool handlers HTTP-call
Console's 17 MCP-adjacent routes. The user's own `claude` binary
cannot talk to Worker because Worker has only the one stub tool, and
the existing `tempo_*` surface lives in Console-backed handlers.

**Slice 1c finishes the flip.** All 10 `tempo_*` tools land on Worker
(reading via `@tempo/db`). The CLI is rewritten end-to-end into a
two-subcommand `tempo-agent init` (OAuth login → `~/.tempo/creds`) +
`tempo-agent connect <thread-id>` (spawn the user's own `claude` with
`--output-format stream-json`, tee events to Worker). The browser
moves its Plan/Comment/Discussion writes off Console's API routes onto
Worker, authenticating via Clerk JWT. Console's MCP-adjacent routes
and the embedded-SDK CLI both die in the same PR. After 1c, Console
serves the UI + Workspace admin only; Worker is the agent-shared data
plane.

The slice is intentionally large — atomic cutover was the explicit Dev
choice (see Acknowledgments) so the system doesn't sit in a
two-MCP-server transitional state.

## Smallest concrete change

### A. CLI rewrite (`apps/agent`)

**Delete** (~700 LOC):

- `cli.ts` (entry — replaced)
- `connect.ts` (today's handshake + subprocess launcher — replaced)
- `stream-pump.ts` (291 LOC SDK-aware driver — replaced by a much
  thinner JSONL forwarder)
- `mcp-server.ts` (in-process stdio MCP — Worker hosts MCP now)
- `mcp-config.ts` (temp stdio config writer — replaced by an
  ephemeral HTTP `.mcp.json` writer)
- `prompts/system-prompt.ts`, `prompts/initial-prompt.ts`,
  `prompts/allowed-tools.ts`, `prompts/nudge.ts` (planning behavior
  moves into Worker's `tempo_attach` workflow output)
- `skills/loader.ts`, `skills/index.ts`, `skills/*.md` (move to
  Worker — see Section J)
- `r2-fetcher.ts` (moves to Worker — see Section J)
- `cancel.ts`, `disconnect-on-exit.ts`, `nudge.ts`, `tool-summary.ts`
  (driver-side concerns; the new wrapper doesn't drive)

**Add** (~500 LOC):

- `cli.ts` — argv parser, dispatches `init` or `connect`
- `commands/init.ts` (~200 LOC) — OAuth flow controller:
  - Generate `state` + `code_verifier` (PKCE)
  - Start ephemeral `node:http` listener on random port (range
    49152–65535); bind to `127.0.0.1`
  - Open browser to
    `https://console.tempo.dev/cli/authorize?state=...&port=...&challenge=...`
    via `open` package
  - Wait for `GET /callback?code=...&state=...` (timeout 5 minutes)
  - Verify `state` matches; POST `code` + `code_verifier` to
    `https://worker.tempo.dev/api/cli/exchange`
  - Receive `{ token, refresh_token, expires_at, user_id, email }` —
    no Workspace info (one token covers every Workspace the User
    belongs to; Workspace context is derived from the Thread per-call
    via membership check)
  - Write `~/.tempo/credentials.json` with mode `0600` (use
    `fs.writeFile` with octal mode arg)
  - Print `✓ Authenticated as <email>. Run \`tempo-agent connect
    <thread-id>\` to start planning.`
  - Errors: timeout → `tempo init failed: browser flow timed out
    after 5min`; verification failure → `tempo init failed: state
    mismatch (possible replay)`
- `commands/connect.ts` (~150 LOC) — per-session wrapper:
  - Read `~/.tempo/credentials.json`; refresh via
    `/api/cli/refresh` if `expires_at` is within 60 seconds
  - Pre-flight: `GET /api/threads/<thread-id>/access` with the
    Bearer `sk_user_*` token. Worker resolves Thread → Workspace →
    membership check on the User; returns `{ thread_title,
    workspace_name }` on success, 403 with body `{ error:
    "not_a_member" }` on failure. Prints a clean error and exits
    on 403; prints `→ Connecting to <workspace_name>'s Thread
    "<thread_title>" …` on success.
  - Write ephemeral `/tmp/tempo-<pid>-<random>.json` (mode 0600)
    with HTTP-streamable MCP config pointing at
    `worker.tempo.dev/mcp` + the live `sk_user_*` token
  - Spawn `claude --output-format stream-json --mcp-config
    <tmp> --print "/tempo-plan <thread-id>"` via `node:child_process`
  - Pipe stdout to `stream-pump`; stderr to ours
  - On exit (SIGINT / `claude` termination / parsed `result` event
    with `is_error=true`): kill child, `unlinkSync` temp file
- `stream-pump.ts` (~100 LOC, simplified) — parse one JSON-per-line
  envelope from `claude` stdout; map each envelope to a Worker
  agent-event payload; POST to
  `https://worker.tempo.dev/api/agent-events` with the
  `sk_user_*` token; buffer + retry on transient failure with
  exponential backoff (max 3 attempts)
- `credentials.ts` (~80 LOC) — read/write/refresh
  `~/.tempo/credentials.json`; lock-file mutex to avoid concurrent
  `tempo-agent connect` invocations racing the refresh
- `event-mapper.ts` (~70 LOC) — convert stream-json events
  (`tool_use`, `tool_result`, `thinking`, `text`, `assistant`,
  `result`, `system`) into Worker's typed agent-event payloads
  defined in `@tempo/contracts/http`

**Keep:**

- `env.ts` — env validation (defaults `TEMPO_WORKER_URL` and
  `TEMPO_CONSOLE_URL`)
- `errors.ts` — error hierarchy with `toDevMessage()`
- `logger.ts` — Pino, stderr-routed (CLI's stdout may carry
  user-facing output)

**Dep changes:**

- Remove: `@modelcontextprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`
- Add: `open` (browser launcher), `proper-lockfile` (mutex for creds
  file)
- Keep: `zod`, `pino`, `pino-pretty`, `@tempo/contracts`

**Net LOC:** ~700 deleted, ~500 added → -200 LOC.

**npm bump:** `@gmeher/tempo-agent` → `1.0.0`. Old `connect <token>`
signature is removed entirely; trying it prints
`unknown subcommand "<token>" — did you mean "tempo-agent connect
<thread-id>"? Run "tempo-agent --help" for the new CLI shape.`

### B. Worker — move 17 routes + ~14 server modules

**Move from `apps/console/server/**` to `apps/worker/src/server/**`:**

| Module | LOC | Notes |
|---|---|---|
| `plan.ts` | 349 | All plan reads/writes |
| `plan/block-html.ts` | 130 | HTML ↔ ProseMirror conversion |
| `comments.ts` | 167 | Comment CRUD + anchor reconciliation |
| `replies.ts` | 44 | Reply CRUD |
| `discussion.ts` | 98 | Discussion messages |
| `threads.ts` (partial) | ~130 of 256 | Agent-facing methods only: `getThread`, `updateThread`, `threadBelongsToWorkspace`, `latestSessionStatus`, `latestAttachedRepo`. Stays in Console: `createThread`, `deleteThread`, `listThreads`, `getConnectToken`, `reopenThread`, `approveThread`. |
| `sessions.ts` | 147 | Session lifecycle, heartbeat, workspace check |
| `status.ts` | 42 | Agent event recording |
| `event-log.ts` | 147 | Append + read + URL stripping |
| `events-stream.ts` | 108 | Long-poll + SSE |
| `attachments.ts` | 141 | R2 init upload + verify + list |
| `db-queries/plans.ts` | 33 | Read accessor |
| `http.ts` | 33 | Response helpers (Worker keeps its own variant) |

Note `ids.ts` already lives in `@tempo/db` from slice 1a.

**Register on Worker's `McpServer`** (`apps/worker/src/mcp/server.ts`):

| Tool | Maps to (Worker server module) |
|---|---|
| `tempo_attach` (1b stub → real) | `server/sessions` + `server/plan` + `server/comments` + `server/discussion` + `server/event-log` |
| `tempo_pull_plan` | `server/plan` |
| `tempo_update_plan` | `server/plan` (first-draft only; fails with `plan_not_empty` if non-empty) |
| `tempo_update_block` | `server/plan` |
| `tempo_add_blocks` | `server/plan` |
| `tempo_delete_block` | `server/plan` |
| `tempo_poll` | `server/events-stream` (long-poll) |
| `tempo_post_reply` | `server/replies` |
| `tempo_post_discussion_message` | `server/discussion` |
| `tempo_set_thread_meta` | `server/threads` |
| `tempo_load_skill` | `server/skills/loader` (see Section J) |

**`mcp/tools/` shape:** each tool gets its own file under
`apps/worker/src/mcp/tools/` (per slice-1b's locked pattern). The
1b `attach.ts` (currently 192 LOC inlining 4 reads) **refactors as
part of this slice** to delegate to the lifted `server/` modules:

```ts
// apps/worker/src/mcp/tools/attach.ts (post-1c)
import { getPlanState } from '../../server/plan';
import { listCommentsForThread } from '../../server/comments';
import { listMessagesForThread } from '../../server/discussion';
import { latestEventId } from '../../server/event-log';
import { getSession } from '../../server/sessions';
import { getThread } from '../../server/threads';
import { WORKFLOW } from '@tempo/contracts/workflow';
```

This is the consolidation the slice-1b code-simplifier deferred (judge
note 4) — naturally addressed when the `server/` modules land.

**Browser-facing routes on Worker** (called via `fetch(`${WORKER_URL}/...`)`
from Console's browser):

- `POST /api/threads/:id/comments` (create Comment)
- `DELETE /api/comments/:id`, `PATCH /api/comments/:id`
  (resolve/unresolve)
- `POST /api/threads/:id/plan/recheck`
- `POST /api/threads/:id/approve`, `POST /api/threads/:id/reopen`
- `POST /api/threads/:id/cancel-current-session`
- `POST /api/threads/:id/attachments/init`
- `GET /api/threads/:id/events` (long-poll + SSE)

These are the routes the browser writes today (in Console). They move
to Worker because they touch agent-shared tables.

### C. Console-side cleanup

**Delete** from `apps/console`:

- All 17 MCP-adjacent route handlers under `app/api/`
- All 14 server modules listed in Section B
- `apps/console/server/workflow.ts` (constant moves to
  `@tempo/contracts`)
- `apps/console/lib/api-client.ts` (rewritten — see Section D)

**Add:**

- `app/cli/authorize/page.tsx` — server component, reads Clerk
  session; on Allow click, calls a server action that mints an OAuth
  code (signed JWT carrying user_id + org_id + nonce + 60s expiry),
  redirects to `http://127.0.0.1:<port>/callback?code=<jwt>&state=<state>`
- `app/api/cli/mint-code/route.ts` — server action target; the actual
  code-minting endpoint (Clerk-protected)
- (No new server-side modules — code minting is a single function,
  no `server/cli-auth.ts` needed)

**Update:**

- `apps/console/lib/api-client.ts` rewritten to point at Worker URL.
  Becomes the only place that calls Worker from the browser. Reads
  `process.env.NEXT_PUBLIC_WORKER_URL` (a build-time env exposed to
  the browser bundle). Sends `Authorization: Bearer <clerk_jwt>` on
  every call, fetched via `useAuth().getToken({ template:
  'tempo-worker' })` from the Clerk React SDK at call-time.
- `next.config.ts` — add `NEXT_PUBLIC_WORKER_URL` to runtime config
- `.env.example` — document `NEXT_PUBLIC_WORKER_URL`

### D. Auth refactor

Worker's `auth.ts` (built in 1b for `sk_agent_*`) becomes a unified
Bearer middleware that branches by prefix:

```ts
// pseudo-code
const token = extractBearer(req);
if (token.startsWith('sk_agent_')) {
  workspaceId = await lookupWorkspaceByAgentKey(token);
  res.locals = { workspaceId, source: 'agent' };
} else if (token.startsWith('sk_user_')) {
  const user = await lookupUserByToken(token);
  res.locals = { userId: user.user_id, source: 'cli' };
  // workspaceId NOT set here — resolved per-route via
  // assertMembership(userId, threadId) below.
} else {
  // assume Clerk JWT
  const claims = await verifyClerkJwt(token);
  res.locals = { userId: claims.user_id,
                 workspaceId: claims.org_id_internal,
                 source: 'browser' };
}
```

Route handlers and MCP tool handlers that act on a specific Thread
then call `assertMembership(req.locals.userId, threadId)` from
`apps/worker/src/server/auth-lookup.ts`. That helper resolves the
Thread's Workspace, runs a membership check via the existing
`members` table (Clerk-synced), and attaches `workspaceId` +
`memberId` to `req.locals` on success or throws a `403
not_a_member` on failure. For `sk_user_*` callers this is required
on every Thread-scoped call; for browser (Clerk JWT) callers the
workspaceId is already in `req.locals` and the helper is a no-op
verification (just confirms the User is still a Member); for the
legacy `sk_agent_*` workspace-scoped key the helper is skipped (the
key directly binds Workspace and the membership concept does not
apply).

Three lookup queries lifted into `apps/worker/src/server/auth-lookup.ts`:
`lookupWorkspaceByAgentKey`, `lookupUserByToken`, `assertMembership`
(short-cached LRU possible but not implemented in 1c).

`@clerk/backend` added to Worker as a runtime dep.

### E. Database migration

New migration in `packages/db/drizzle/`:

```sql
CREATE TABLE user_tokens (
  id              text PRIMARY KEY,        -- utk_<random>
  user_id         text NOT NULL,           -- Clerk user id (no workspace binding)
  token_hash      text NOT NULL UNIQUE,    -- sha256+pepper of sk_user_<...>
  refresh_token_hash text NOT NULL UNIQUE, -- sha256+pepper of rt_<...>
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
CREATE INDEX user_tokens_user
  ON user_tokens (user_id);
CREATE INDEX user_tokens_lookup
  ON user_tokens (token_hash) WHERE revoked_at IS NULL;
```

Pepper sourced from `TOKEN_HASH_PEPPER` env var (Fly secret).
Workspace context derives from the Thread on every call; no
workspace_id column on the token itself.

### F. Contract additions

In `packages/contracts/src/`:

- `mcp.ts` — `AttachInput` updated:
  `z.object({}) → z.object({ thread_id: ThreadId })`
- `workflow.ts` (new) — exports `WORKFLOW` constant (the 31-line
  string from `apps/console/server/workflow.ts`)
- `http.ts` — new schemas:
  - `CliExchangeRequest = z.object({ code, code_verifier, port })`
  - `CliExchangeResponse = z.object({ token, refresh_token, expires_at,
    user_id, email })`
  - `CliRefreshRequest = z.object({ refresh_token })`
  - `CliRefreshResponse = same shape as exchange response`
  - `ThreadAccessResponse = z.object({ thread_id, thread_title,
    workspace_id, workspace_name })` — returned by Worker's preflight
    `GET /api/threads/:id/access` (403 with `{ error: 'not_a_member' }`
    if the User isn't a Member)
  - `AgentToolUseEvent = z.object({ tool_name, summary,
    started_at_ms })`
  - `AgentNarrationEvent = z.object({ text, emitted_at_ms })`
  - `AgentTodosUpdatedEvent = z.object({ todos: z.array(z.string()) })`
  - `AgentTurnEndedEvent = z.object({ duration_ms, reason })`
- `index.ts` — export the new symbols from the barrel

### G. CORS configuration on Worker

`apps/worker/src/index.ts` adds CORS middleware (the `cors` npm
package) with:

```ts
app.use(cors({
  origin: env.CONSOLE_ORIGIN,         // https://console.tempo.dev
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','Mcp-Session-Id'],
  credentials: false,
  maxAge: 86400,
}));
```

In dev: `CONSOLE_ORIGIN=http://localhost:3000`.

### H. DNS + deployment

- Register `worker.tempo.dev` CNAME → `tempo-worker.fly.dev`
  (Cloudflare or whichever DNS provider)
- Add to `apps/worker/fly.toml`:
  - `[[http_service.checks]]` already present from 1b
  - Custom certs via `fly certs create worker.tempo.dev`
- Console's Railway / Vercel env: set `NEXT_PUBLIC_WORKER_URL=
  https://worker.tempo.dev`
- Worker's env: set `CONSOLE_ORIGIN=https://console.tempo.dev`,
  `TOKEN_HASH_PEPPER=<32-byte secret>`,
  `CLERK_SECRET_KEY=<...>` (for `@clerk/backend`)

### I. Skills bundle move

`apps/worker/src/skills/` (new):

- `*.md` — 9 skill files copied from `apps/agent/src/skills/`
- `loader.ts` — same logic; reads from `import.meta.dirname + '/*.md'`
  (Bun + Node 20 both support this)
- `apps/worker/Dockerfile` updated to `COPY apps/worker/src/skills`
  into the standalone build

`tempo_load_skill` MCP tool registered with `inputSchema:
LoadSkillInput` from `@tempo/contracts/mcp`.

### J. R2 fetcher move

`apps/worker/src/lib/r2.ts` (new):

- Lifted from `apps/agent/src/r2-fetcher.ts` (35 LOC)
- Plus the existing `apps/console/lib/r2.ts` (S3 client wrapper +
  `signGetUrl` + `signPutUrl` + `deletePrefix`)
- Worker reads R2 creds from `R2_*` env vars (Fly secrets); slice 1b's
  empty-`attachments` placeholder is finally fixed

`apps/worker/src/server/attachments.ts` calls `signGetUrl` from this
lib when shaping replies/messages.

## Alternatives considered

### A. Skills bundle location

| Option | Tradeoff | Decision |
|---|---|---|
| **Worker filesystem** | Ships with the app; one source of truth; `bun build`'s `.md:text` loader inlines into the bundled JS (same as today's CLI bundle). | **Chosen.** |
| `@tempo/contracts` runtime export | Lets Console reference skills if ever needed; bloats contracts. | Rejected. |
| External CDN | Cache-friendly; adds infra and a network round-trip on `tempo_load_skill`. | Rejected. |
| Per-Workspace DB | Lets per-Workspace customization later; no use case today. | Rejected (judge P5 — one adapter is hypothetical). |

### B. Browser fetch refactor

| Option | Tradeoff | Decision |
|---|---|---|
| **Centralized `apiClient` in `apps/console/lib/api-client.ts`** | Mirrors existing pattern; one place to set baseURL; one place to inject Clerk JWT; consistent error handling. | **Chosen.** |
| Per-component `fetch(`${WORKER_URL}/...`)` | More scattered; harder to find what calls what. | Rejected. |
| TanStack Query query factories | Clean but adds an abstraction layer for ~6 routes. | Rejected (judge P5 — premature). |

### C. Console MCP routes deletion timing

| Option | Tradeoff | Decision |
|---|---|---|
| **Same PR as Worker route add** | Atomic; matches the locked hard-cutover decision; no zombie routes. | **Chosen.** |
| Follow-up PR | Lets Worker soak. But the soak window would still serve broken results (old CLI hits Console; Console reads from same DB; the test would be hollow). | Rejected. |

### D. User-token storage

| Option | Tradeoff | Decision |
|---|---|---|
| **SHA-256 + pepper** | Fast lookup (one indexed query); standard pattern (matches Clerk's API key storage); pepper rotation possible. | **Chosen.** |
| bcrypt / argon2 | Resistant to offline dictionary attacks; tokens are long random strings so this is overkill; slow lookup. | Rejected. |
| Plaintext + AES-at-rest | Same security as SHA-256 but lets us recover the original token (we never need to). | Rejected. |
| KMS-encrypted | Overkill for an opaque token. | Rejected. |

### E. Refresh token strategy

| Option | Tradeoff | Decision |
|---|---|---|
| **Long-lived (30d) + rotate-on-use** | OAuth2 best practice; defends against stolen refresh tokens (the rotation reveals theft). | **Chosen.** |
| Long-lived, multi-use | Simpler; no rotation; weaker security. | Rejected. |
| Short-lived auto-refresh | Higher network burden, no benefit for CLI use. | Rejected. |

### F. OAuth callback port

| Option | Tradeoff | Decision |
|---|---|---|
| **Random port from 49152–65535, advertised in `port` query param** | Avoids "port already in use" failures; standard pattern (gh CLI, etc.). | **Chosen.** |
| Fixed port (e.g. 4567) | Simpler; collides with other tools using the same port. | Rejected. |

## Layer assignment

Per CLAUDE.md rule 19, each new file declares its layer.

**`apps/agent/src/` (CLI side):**

- `cli.ts` — CLI boot (argv parsing, dispatch)
- `commands/init.ts` — CLI command (orchestrates browser open, HTTP listener, exchange, save)
- `commands/connect.ts` — CLI command (orchestrates refresh, temp config write, subprocess spawn, JSONL forward)
- `credentials.ts` — infra (file I/O on `~/.tempo/`)
- `oauth-listener.ts` — infra (ephemeral `node:http` server, only callback handler)
- `stream-pump.ts` — pure transform (JSONL → Worker payloads + HTTP POST)
- `event-mapper.ts` — pure transform (stream-json event shape → typed agent event)
- No business logic; CLI is glue.

**`apps/worker/src/` (server side):**

- `server/plan.ts`, `server/comments.ts`, etc. — domain modules
  (DB + business rules per CLAUDE.md rule 19)
- `mcp/tools/*.ts` — MCP tool handlers (thin: parse args → call
  server module → format response per AttachOutput-like schemas)
- `auth.ts` — middleware (lookup, branch by prefix)
- `routes/browser/*.ts` — thin HTTP handlers (parse + validate via
  `@tempo/contracts` + call server module + format response)
- `routes/cli/*.ts` — same for the new `/api/cli/*` endpoints
- `routes/agent-events/*.ts` — same for the new stream-json ingestion
- `server/cli-auth.ts` — code-mint verification, member_token issuance + refresh + revocation. Genuine domain logic, lives here.

**`packages/contracts/src/workflow.ts`** — pure module (just exports
a constant string). Lifted from Console.

## Deletion test

For each new/moved/added module, the test: "if we deleted this, where
does complexity reappear?"

| Module | If deleted, complexity reappears at... | Verdict |
|---|---|---|
| `apps/agent/src/commands/init.ts` | every place we run OAuth; only one place needs to do it | KEEP |
| `apps/agent/src/commands/connect.ts` | every place we spawn `claude`; only one place needs to do it | KEEP |
| `apps/agent/src/credentials.ts` | inlined into `init.ts` and `connect.ts` separately; tests would duplicate; fs race conditions duplicated | KEEP |
| `apps/agent/src/oauth-listener.ts` | inlined into `init.ts`; one caller; borderline | **MERGE into `init.ts`** — only one caller, no reuse anticipated |
| `apps/agent/src/stream-pump.ts` | inlined into `connect.ts`; the parse loop is non-trivial and worth isolating | KEEP |
| `apps/agent/src/event-mapper.ts` | inlined into `stream-pump.ts`; the mapping is field-by-field and stable | **MERGE into `stream-pump.ts`** unless `stream-pump.ts` grows past ~200 LOC during implementation |
| `apps/worker/src/server/*` (moved from Console) | already proven by being in Console; the move is identity-preserving | KEEP all |
| `apps/worker/src/mcp/tools/*.ts` (9 new files) | inlined into `mcp/server.ts`; each tool's input/output mapping is non-trivial; one-tool-per-file pattern established in 1b | KEEP |
| `apps/worker/src/routes/browser/*.ts` (6 new files) | inlined into `index.ts`; each route's Zod parse + server-module call is tight; one-route-per-file matches Console's pattern | KEEP |
| `apps/worker/src/routes/cli/*.ts` (2 new files for exchange + refresh) | inlined into `index.ts`; OAuth code verification is non-trivial; isolation aids security review | KEEP |
| `apps/worker/src/routes/agent-events/*.ts` | one file, ~80 LOC for the event-ingest endpoint; fine as one file | KEEP |
| `apps/worker/src/server/cli-auth.ts` | inlined into the route handlers; code-mint logic + member_token lifecycle is substantial (~200 LOC) and benefits from isolation | KEEP |
| `apps/worker/src/server/auth-lookup.ts` | inlined into `auth.ts`; the three lookup queries are distinct; isolation aids future caching | KEEP |
| `packages/contracts/src/workflow.ts` | duplicated in two consumers (Console + Worker — but Console is losing the workflow constant entirely; only Worker imports it). **Reconsider:** if only Worker uses it, it should live in Worker, not contracts. | **RECONSIDER** — see Uncertainty 5 |

## One adapter ≠ a seam — explicit check

Per CONTEXT.md §2 and CLAUDE.md, no abstraction is added for a
hypothetical second adapter. Inventory:

- **Bearer middleware** has three real callers in 1c
  (`sk_agent_/sk_user_/Clerk JWT`). Three real adapters. **Real
  seam.**
- **MCP tool handlers** all consume the same `McpServer.tool(...)`
  surface. Real seam (one adapter per tool, ten total post-1c).
- **`@tempo/db`** has two real adapters (Console for spaces +
  workspaces; Worker for everything else). Real seam.
- **`@tempo/contracts`** has two real adapters (browser apiClient +
  Worker route handlers). Real seam.
- **Skills loader**: one caller (`tempo_load_skill` tool). Borderline.
  But the `loader.ts` shape is identical to today's CLI loader, so
  it's a move, not a new abstraction. Keep.

No factories, no DI, no `interface I…/class …Impl` invented.

## Uncertainties

1. **Bun + Node-bundled CLI for OAuth listener.** Today's CLI bundles
   via `bun build` and runs on Node 18+. The OAuth listener uses
   `node:http`, which Bun's bundler will inline. **Verify before
   implementation:** does the bundled binary's `http.createServer` +
   `server.close()` work cleanly on Node 18/20/22?
2. **Clerk JWT verification template.** `@clerk/backend`'s `verifyToken`
   needs the JWT to have org-aware claims (`org_id`, `org_role`). The
   default Clerk session token may not. We'll likely need a custom
   JWT template (`tempo-worker`) defined in Clerk Dashboard that
   includes the org claim. **Verify before implementation:** does the
   custom template work, and does the React SDK's
   `getToken({ template: 'tempo-worker' })` deliver it?
3. **Long-poll behavior on Fly + the `worker.tempo.dev` proxy path.**
   `tempo_poll` holds connections up to 30s. Fly's HTTP proxy idle
   timeout is configurable; need to confirm it's ≥35s. Also confirm
   that the Cloudflare CNAME (if we proxy through Cloudflare) doesn't
   buffer or cut the long-poll. **Verify in CI / staging** before
   announcing the cutover.
4. **Concurrent `tempo-agent connect` invocations** by the same
   Member on the same machine. The credentials file refresh has a
   `proper-lockfile` mutex; verify it actually prevents the
   "two refreshes racing the rotation" hazard.
5. **`WORKFLOW` constant home.** Per the locked decision (slice 1b
   grilling), it lifts to `@tempo/contracts`. The deletion-test row
   above flagged: only Worker imports it now. **Reconsider during
   implementation:** if Console truly drops all references, the
   constant could live in `apps/worker/src/lib/workflow.ts` instead.
   Defer the call to the implementer; flag in the PR.
6. **Clerk webhook on member removal.** If a Member is removed from
   a Workspace mid-session, their `sk_user_*` token still exists and
   is still valid — but `assertMembership(userId, threadId)` will
   start returning 403 for any Thread in that Workspace on its very
   next call. So revocation is implicit and automatic for the
   removed Workspace, while other Workspaces the User is still in
   keep working. No `user_tokens` row deletion is required on
   `organizationMembership.deleted`. The only edge case to consider:
   a long-running MCP session might cache its sticky thread-id; if
   that Thread's Workspace just removed the User, the in-flight
   tools will start failing 403. That's the correct behavior; the
   wrapper should print a clear error and exit cleanly. Flag for Dev
   decision: do we want a Clerk webhook in 1c that proactively
   *terminates* affected MCP sessions (cleaner UX, more code) or
   defer to slice-2 hardening?

## Destructive actions

None in 1c's implementation. The agent makes file edits and one DB
migration. **The Dev runs**:
- `fly deploy --app tempo-worker` (production deploy of Worker)
- DNS update for `worker.tempo.dev`
- `bun run --filter @tempo/db db:migrate` against the Railway DB
  (the `user_tokens` migration)
- `npm publish` of `@gmeher/tempo-agent@1.0.0`
- Announcement to design partners

CLAUDE.md rule 24 is satisfied — the agent does not run any of the
above.

## Dev acknowledgments

Quoted from the grilling session (2026-06-15):

- **Topology direction**: "we will start exeucuting it. adding
  connectors adding VMs, The mcp gateway which both the hosted vm
  agent sdk or the local claude-cli agent can call."
- **Apps structure (Worker home)**: "Separate app: `apps/worker`"
- **MCP topology**: "Unified: Worker hosts all `tempo_*`"
- **Worker shape**: "Full move: MCP-adjacent routes migrate from
  Console to Worker"
- **Connector identity (relevant for slice 3, foreshadowed here)**:
  "Yes — dual-mode, per-Connector declaration"
- **Runtime routing**: "Dynamic per-event"
- **PR shape**: "Split into 1a + 1b + 1c, each judge-gated where
  relevant"
- **CLI shape (this slice's central decision)**: "One binary, current
  name: tempo-agent init, tempo-agent connect <thread-id> and (ii)
  Member-scoped"
- **CLI auth shape (revised mid-grilling)**: "What if we have one user
  token for all workspace ?" → answered "ye". The initial
  Member-scoped (per-Workspace) model was simplified to User-scoped
  after the multi-Workspace UX of having profiles + a `switch`
  command was deemed unnecessary. One `sk_user_*` token covers every
  Workspace the User belongs to; Workspace access is enforced by an
  `assertMembership(userId, threadId)` check on every Thread-scoped
  call. The plan above reflects the revised shape; the original
  `member_tokens` design is superseded.
- **Browser auth**: "Bearer Clerk JWT — browser sends Clerk session
  token (Recommended)"
- **Cutover**: "Hard cutover with coordination (Recommended)"
- **Worker hostname**: "`worker.tempo.dev` — dedicated subdomain
  (Recommended)"
- **Rate limits**: "Defer to slice 3 (Recommended)"

## Verification plan

Before reporting 1c done:

- `bun install` clean
- `bun run typecheck` green across all 5 packages
- `bun run lint` clean on every touched file (Console pre-existing
  lint failures are pre-existing; do not introduce new ones)
- `bun build` produces `apps/worker/dist/index.js` and
  `apps/agent/dist/cli.js`
- `bun run --filter @tempo/db db:migrate` applies the
  `user_tokens` migration against a staging DB
- Manual end-to-end smoke on staging:
  1. `npx tempo-agent init` → completes OAuth flow → writes
     `~/.tempo/credentials.json`
  2. Open the Console at `staging.console.tempo.dev`, create a Thread
     (existing flow), copy the `thd_*` id
  3. `npx tempo-agent connect thd_<id>` → `claude` opens → LLM calls
     `tempo_attach` → Plan reads back
  4. LLM writes a Plan via `tempo_update_plan` → Console SSE shows
     the Plan render
  5. From Console browser, add a Comment → LLM picks it up via
     `tempo_poll` → posts a Reply
  6. Approve → handoff card appears
- Field-by-field JSON diff between staging Worker's `tempo_attach`
  output and a snapshot from pre-1c Console's `/api/sessions/:id/state`
  for the same session (judge note 1 from slice 1b — finally
  unblocked)
- `curl -X OPTIONS https://worker.tempo.dev/api/threads/<id>/comments
  -H "Origin: https://console.tempo.dev"` returns proper CORS
  headers
- `curl https://worker.tempo.dev/health` returns 200 with DB-ping ok
- Old CLI (0.x) → "unknown subcommand" message confirmed

## What 1c explicitly does NOT include

- Mailbox / Hosted Agent SDK loop / VM provisioning (slice 2)
- Gateway middleware / allowlist / approve-gate / Connectors / Nango /
  audit log (slice 3)
- Rate limiting (slice 3, per locked decision)
- Per-Member analytics
- `tempo_create_thread` MCP tool for future-scope local-Thread
  creation (post-1c enhancement)
- LRU caching of auth lookups (slice 2+ hardening)
- Clerk webhook for member-removal token revocation (uncertainty 6;
  defer if Dev approves)
