# Slice 1c-2b — Route migration + Console cutover (breaking)

**Status:** sub-plan, strict subset of the already-approved slice 1c plan
at `plans/slice-1c-routes-cli-migration.md` Sections B–J + cutover. No
new judge gate (subset of an approved plan).

**Predecessors:**
- Slice 1c-1 (auth foundation, commit `37346ea`)
- Slice 1c-2a (CLI rewrite, commit `d75e37e`)

## Problem statement

After 1c-1 + 1c-2a: Worker hosts the unified Bearer middleware (sk_agent_,
sk_user_, Clerk JWT), the auth + agent-event ingestion endpoints, and a
stub `tempo_attach` MCP tool. The new CLI works end-to-end for auth +
attach but the LLM cannot draft Plans because the other 9 `tempo_*` tools
don't exist on Worker yet — they still live in `apps/console/server/**`
behind Console's HTTP routes.

**Slice 1c-2b completes the topology flip.** All 14 server modules move
from Console to Worker, the remaining 9 MCP tools register on Worker MCP,
Console's MCP-adjacent routes are deleted, browser-side writes re-point
to Worker with Bearer Clerk JWT, CORS goes up, and the WORKFLOW + skills
bundle + R2 fetcher lift to their new homes.

After 1c-2b: the LLM can actually plan. End-to-end functional.

## Smallest concrete change

### A. Move 14 server modules

From `apps/console/server/**` → `apps/worker/src/server/**`. These are
the modules the agent-shared tables touch:

| Module | LOC | Notes |
|---|---|---|
| `plan.ts` + `plan/block-html.ts` | 349 + 130 | Plan reads, updates, block-level edits, HTML ↔ ProseMirror conversion |
| `comments.ts` | 167 | Comment CRUD + anchor reconciliation |
| `replies.ts` | 44 | Reply CRUD |
| `discussion.ts` | 98 | Discussion messages |
| `threads.ts` (agent-facing methods only) | ~130 of 256 | Keep in Console: `createThread`, `deleteThread`, `listThreads`, `getConnectToken`, `reopenThread`, `approveThread`. Move: `getThread`, `updateThread`, `threadBelongsToWorkspace`, `latestSessionStatus`, `latestAttachedRepo` |
| `sessions.ts` | 147 | Already partially on Worker (slice 1c-1 stamps `mcp_session_id`); fold in the rest |
| `status.ts` | 42 | Agent event recording (the old `/api/sessions/:id/tool-use` etc. — but those endpoints are deleted; the logic is consumed by the new `/api/agent-events` in Worker) — verify nothing still imports |
| `event-log.ts` | 147 | Append + read + URL stripping. Already partially on Worker (1c-1's stub `appendEvent`); fold in Console's full module |
| `events-stream.ts` | 108 | Long-poll + SSE for browser + agent |
| `attachments.ts` | 141 | R2 init upload + verify + list |
| `actor.ts` | 95 | Workspace + Clerk session resolution. Worker's `auth-lookup.ts` already covers most of this; reconcile / merge |
| `db-queries/plans.ts` | 33 | Read accessor |

**Layer placement** stays the same as Console: each becomes a module
under `apps/worker/src/server/**`. No business logic in route handlers;
routes parse, call the server module, format the response.

### B. Register the 9 remaining `tempo_*` tools

One file per tool under `apps/worker/src/mcp/tools/` (matches the 1b
pattern; `attach.ts` already there):

```
apps/worker/src/mcp/tools/
├── attach.ts                        (already exists — 1b/1c-1)
├── pull-plan.ts                     NEW
├── update-plan.ts                   NEW
├── update-block.ts                  NEW
├── add-blocks.ts                    NEW
├── delete-block.ts                  NEW
├── poll.ts                          NEW (long-poll wrapper)
├── post-reply.ts                    NEW
├── post-discussion-message.ts       NEW
├── set-thread-meta.ts               NEW
└── load-skill.ts                    NEW (reads from worker/src/skills/)
```

Each tool: parse args via the Zod schema from `@tempo/contracts/mcp` →
resolve `thread_id` from the MCP session's sticky mapping (the
`sessions.mcp_session_id` row written on attach) → call the server
module → format AttachOutput-shaped response. Each ≤ 80 LOC.

**Thread ID resolution per call**: Worker's MCP session map (from
`mcp/transport.ts`) needs to track `thread_id` after attach. Add a
helper `getThreadIdForMcpSession(mcpSessionId)` that reads the
`sessions` row and returns `thread_id`. The other 9 tools use this
instead of taking `thread_id` as an arg — matching the original
contract where these tools had `inputSchema: {}`.

### C. Console-side cleanup

Delete from `apps/console`:

- All 17 MCP-adjacent route handlers under `app/api/` — specifically the
  routes the CLI used to call (plan, comments, replies, discussion,
  sessions/state, sessions/tool-use, sessions/narration, etc.)
- All 14 server modules listed in A (after moving)
- `apps/console/server/workflow.ts` (constant lifts to contracts)
- The "Copy connect token" UI affordance (the `tmp_*` artifact is gone)

Add:

- Nothing new — Console becomes a pure UI + Workspace admin layer.

### D. Browser fetch refactor

`apps/console/lib/api-client.ts` becomes the single browser → Worker
client. It:

- Reads `process.env.NEXT_PUBLIC_WORKER_URL` (build-time inlined)
- Calls `useAuth().getToken({ template: 'tempo-worker' })` to fetch the
  Clerk JWT at call-time (cache the promise for the duration of the
  call to avoid duplicate Clerk roundtrips)
- POSTs with `Authorization: Bearer <jwt>` and `Content-Type:
  application/json`
- Surfaces network + HTTP errors via typed exceptions

Every place in `apps/console/components/**` and `apps/console/app/**`
that does `fetch('/api/threads/...')` for the 17 migrated routes goes
through `apiClient`.

**SSE for browser activity feed**: `EventSource` does NOT support
custom headers. Three options — pick during implementation:

1. **`fetch` + ReadableStream** with custom Bearer header. Modern, works
   everywhere, but no built-in reconnection. Use
   `@microsoft/fetch-event-source` (small library, ~3KB) for
   reconnection + retry.
2. **URL-embedded token**: `?access_token=...`. Simple but logs the
   token to access logs and proxies. NOT recommended.
3. **Cookie-based** with Clerk's session cookie. Requires
   `Access-Control-Allow-Credentials: true` and matching origin / domain.
   Works in prod (`*.tempo.dev`) but messy for local dev (different
   ports). Defer to slice 2+ if hosting on subdomains.

**Recommendation**: option 1 with `@microsoft/fetch-event-source`. Add
via `bun add` to console.

### E. Contract changes

- `packages/contracts/src/workflow.ts` (new) — exports `WORKFLOW`
  constant (the 31-line string from `apps/console/server/workflow.ts`)
- `packages/contracts/src/mcp.ts` — verify each of the 10 tool input
  schemas. The other 9 tools likely already exist there; if any need
  adjustments (e.g. adding `thread_id` back to the wire), flag.
- `packages/contracts/src/http.ts` — for any browser-facing routes that
  need explicit Zod schemas (currently they're implicit in Console's
  route handlers; reify them so the apiClient can validate responses).

Update Worker's `mcp/tools/attach.ts` to import `WORKFLOW` from
`@tempo/contracts/workflow` and delete the local `workflow-stub.ts`.

### F. Skills bundle move

`apps/worker/src/skills/` (new):

- Copy 9 `.md` skill files from `apps/agent/src/skills/`
- `loader.ts` — same logic as the CLI's old loader; reads from
  `import.meta.dirname + '/*.md'`
- Hook into the new `mcp/tools/load-skill.ts` tool

`apps/worker/Dockerfile` updated to `COPY apps/worker/src/skills` into
the standalone build.

After this, delete the TODO comment + the inert skills bundle in
`apps/agent/src/`.

### G. R2 fetcher move

`apps/worker/src/lib/r2.ts` (new):

- Lift from `apps/agent/src/r2-fetcher.ts` (35 LOC)
- Plus Console's `apps/console/lib/r2.ts` (S3 client wrapper, signGetUrl,
  signPutUrl, deletePrefix)
- Worker reads R2 creds from `R2_*` env vars

`apps/worker/src/server/attachments.ts` uses `signGetUrl` when shaping
replies/messages — this replaces the 1c-1 placeholder where
`attachments: []` was returned empty.

After this, delete the TODO + the inert `r2-fetcher.ts` in
`apps/agent/src/`.

### H. CORS middleware

`apps/worker/src/index.ts` adds CORS via the `cors` npm package (via
`bun add`):

```ts
app.use(cors({
  origin: env.CONSOLE_ORIGIN,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','Mcp-Session-Id'],
  credentials: false,  // Bearer-only; no cookies cross-origin
  maxAge: 86400,
}));
```

Env var: `CONSOLE_ORIGIN` — `http://localhost:3000` in dev,
`https://console.tempo.dev` in prod.

### I. DNS configuration

- Update `apps/worker/fly.toml` to expect `worker.tempo.dev` (cert via
  `fly certs create worker.tempo.dev` — Dev runs this manually)
- Update `apps/console/.env.example` with `NEXT_PUBLIC_WORKER_URL=
  https://worker.tempo.dev`
- Update `apps/worker/.env.example` with `CONSOLE_ORIGIN=
  https://console.tempo.dev`
- Cloudflare CNAME record: `worker → tempo-worker.fly.dev` (manual Dev
  step, NOT something the implementer touches)

### J. Update `plans/agent-harness.md` §2

Per the judge's reminder 1 from the original slice 1c review: the parent
doc says `tempo-agent init` writes a "checked-in" `.mcp.json`. Slice 1c
actually writes an *ephemeral* `/tmp/tempo-<pid>.json` per session
(because the file carries the live Bearer token). Update §2 to clarify:

> `tempo-agent init` does no repo file writes — it runs an OAuth login
> and saves the User-scoped token to `~/.tempo/credentials.json`.
> `tempo-agent connect <thread-id>` writes an ephemeral
> `/tmp/tempo-<pid>.json` MCP config carrying the Bearer token and
> spawns the user's own `claude` binary against it; the temp file is
> unlinked when the wrapper exits.

### K. Delete inert files from `apps/agent/src/`

After F + G complete, the following are no longer used by the CLI:

- `apps/agent/src/skills/**` — moved to Worker in F
- `apps/agent/src/r2-fetcher.ts` — moved to Worker in G
- `apps/agent/src/env.ts` — drop `TEMPO_ATTACHMENT_ORIGIN` (was only used
  by r2-fetcher) and `TEMPO_CONSOLE_URL` (was only used in old paths)

Verify with `grep -r "from './skills" apps/agent/src/` etc. — should
return zero hits before deleting.

## Alternatives considered

### A. SSE auth mechanism

Picked option 1 (`fetch` + `@microsoft/fetch-event-source` with Bearer
header). Tradeoffs:

- (1) **fetch+stream**: works everywhere, library handles reconnect,
  no token-in-URL hazard. Cost: one small dep.
- (2) **URL token**: simple but tokens leak to logs.
- (3) **Cookie**: requires `*.tempo.dev` parent-domain cookie + CORS
  `credentials: 'include'`. Different ports in local dev means cookies
  don't flow. Defer.

### B. Browser fetch shape

- `apiClient` in `apps/console/lib/api-client.ts` already exists
  for some routes — extend it. Cleanest.
- Alternative: per-component `fetch(`${WORKER_URL}/...`)` — scattered.
  Rejected.
- TanStack Query factories — extra abstraction; defer to a separate
  refactor if it becomes painful.

### C. Console route deletion timing

- Same PR as Worker route adds. Atomic. Matches hard-cutover decision.

## Layer assignment

- `apps/worker/src/server/*` (lifted) — domain modules. Same shape
  Console had.
- `apps/worker/src/mcp/tools/*` (9 new files) — MCP tool handlers.
  Thin: parse → resolve thread_id from sticky session → call server →
  format response.
- `apps/worker/src/routes/browser/*` (new) — thin HTTP handlers for
  browser writes. Parse Zod request → call server module → format.
  6 files matching the 6 browser-facing routes.
- `apps/worker/src/routes/events/*` (new) — SSE + long-poll endpoints.
- `apps/worker/src/lib/r2.ts` (new) — infra.
- `apps/worker/src/skills/` (new) — content (markdown bundles).

## Deletion test

- `mcp/tools/*.ts` (9 new files): each carries unique Zod parse +
  business-module call + response shaping. ≥ 30 LOC each, well-earned.
- `server/*` modules (14 lifted): proven by Console using them.
- `routes/browser/*.ts` (6 new files): one per route, matches Console's
  pattern.
- `lib/r2.ts`: single caller (attachments.ts in 1c-2b, more in slice
  2). Earns its file.
- `skills/loader.ts`: reads markdown + caches. Single caller in 1c-2b
  (`tempo_load_skill`). Borderline but matches old CLI pattern.

## Uncertainties

1. **`@microsoft/fetch-event-source` reconnection semantics under
   network blip**: need to confirm it re-establishes with the Bearer
   header and doesn't drop events at the seam. Verify in dev before
   shipping.
2. **Clerk JWT template `tempo-worker`**: must be configured in Clerk
   Dashboard with `org_id` claim included. If absent, browser →
   Worker calls 401 silently. Document for the Dev as a prerequisite
   step; the code can assume the template exists.
3. **`actor.ts` reconciliation**: Console's `actor.ts` (~95 LOC) and
   Worker's `auth-lookup.ts` (from 1c-1) both resolve workspace +
   member identity. Pick one canonical home — probably extend
   `auth-lookup.ts` to absorb anything Console's `actor.ts` did that
   isn't covered, and delete `actor.ts`.
4. **Long-poll behavior on Fly proxy**: `tempo_poll` holds connections
   up to 30s. Fly's HTTP proxy idle timeout needs to be ≥ 35s for prod.
   Verify after deploy.
5. **`/api/threads/:id/events` browser SSE auth**: pick option (1) per
   the recommendation above. If reconnect under Clerk-JWT-refresh is
   flaky, fall back to cookie auth as a slice-2 hardening.

## Destructive actions

None in the implementation. Dev manually:

- `fly deploy --app tempo-worker` (prod deploy of new Worker bundle)
- `fly certs create worker.tempo.dev` (TLS cert provisioning)
- DNS CNAME at Cloudflare (`worker.tempo.dev → tempo-worker.fly.dev`)
- `npm publish @gmeher/tempo-agent@1.0.0` (publish the new CLI)
- Announcement to design partners (hard cutover for any active users of
  the old `tempo-agent connect <token>` flow)

CLAUDE.md rule 24 satisfied — agent does none of the above.

## Verification

- `bun install` clean
- `bun run typecheck` green across all 5 packages
- `bun run lint` clean on every touched file (Console pre-existing
  failures are pre-existing; do not introduce new ones)
- `bun run --filter @tempo/worker build` green
- `bun run --filter @tempo/console build` green
- `bun --cwd packages/db run db:generate` → "No schema changes"
  (no new migration expected in 1c-2b)
- Manual E2E smoke (Dev runs):
  1. Console + Worker dev started; CLI built; OAuth done (already)
  2. `tempo-agent connect thr_<id>` — claude opens, attaches, LLM can
     now call `tempo_pull_plan`, `tempo_update_plan`, etc. without
     "tool not found"
  3. LLM drafts a Plan via `tempo_update_plan` — Plan body appears in
     Console UI editor (via SSE)
  4. Add a Comment in Console editor → LLM picks it up via
     `tempo_poll` → posts a Reply with `tempo_post_reply`
  5. Approve in Console UI — Thread freezes, handoff card appears
  6. Field-by-field JSON diff between Worker's `tempo_attach` response
     today vs. yesterday (pre-1c-2b) — should be identical
- CORS preflight check:
  ```sh
  curl -i -X OPTIONS -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Authorization" \
    http://localhost:3001/api/threads/thr_x/comments
  ```
  → 204 with `Access-Control-Allow-Origin: http://localhost:3000`
- Old CLI version check:
  ```sh
  npm view @gmeher/tempo-agent versions | tail -3
  ```
  Confirms `1.0.0` will be the next published version when Dev runs
  `npm publish`.

## What 1c-2b does NOT include

- Hosted runtime (slice 2)
- Mailbox queue (slice 2)
- Connector gateway / allowlist / approve-gate (slice 3)
- Per-Connector grants / Nango (slice 3)
- Per-Member rate limiting (slice 3)
- LRU caching of `assertMembership` calls (defer until profiling shows
  it's needed)
