# Slice 3 — Connectors (Linear/GitHub/Pipedream) — SOURCE OF TRUTH

> This is the plan the Dev handed me. If I ever drift, re-read this. The
> **Build plan & decisions** section at the bottom records where my
> implementation deliberately deviates from the original (and why).

---

## Problem

The Agent plans blind. It can read and write the Plan, hold a conversation, and explore the repo on disk — but it has no visibility into the team's existing work. When a Dev says "there's a related Linear issue," the Agent has to take their word for it. It can't search issues, check PR status, or understand project structure. Devs compensate by manually copying context into the Thread, which is slow and incomplete.

## Outcome

The Agent reads from Linear and GitHub during planning. Plans reference real issues, cite PR status, and reflect project structure — without the Dev manually providing context. Workspace admins connect services once; every Thread benefits.

## Success criteria

* A Dev opens a Thread, asks "find related Linear issues for [topic]," and the Agent returns search results within the same Turn.
* The Agent cites real issue keys (e.g. PROJ-123) in the Plan, linked to their source.
* A Workspace admin connects Linear and GitHub from Settings → Integrations in under 2 minutes each.
* A Dev in a Thread where Linear is not workspace-enabled sees zero Linear tools — the Agent cannot access the service.
* Every connector read is recorded in the audit log with workspace, thread, connector, tool, and timestamp.
* The Tier 2 dispatcher (`tempo_use_integration`) lets the Agent search Sentry, Notion, or any Pipedream-supported service without per-connector engineering from us.

## Scope

**In scope**

* Two-tier connector architecture: Tier 1 (GitHub App REST wrappers — the only own-app connector) and Tier 2 (Pipedream dispatcher for everything else, including Linear).
* 5 read-only Tier 1 GitHub tools + 1 Tier 2 dispatcher tool (`tempo_use_integration`).
* Gateway governance: workspace-level allowlist + audit logging.
* Linear reads via the Tier 2 dispatcher — no own OAuth app, no hand-written GraphQL wrappers.
* GitHub read tools — the only Tier 1 connector, using own App installation token.
* Pipedream integration: Connect Link for admin OAuth flow, MCP server for Tier 2 tool dispatch.
* Console UI: Workspace Settings → Integrations (connect/disconnect, status).
* Contract additions: Zod schemas for 6 new tools (5 GitHub + 1 dispatcher).

**Out of scope (this slice)**

* Write tools. Approve-gate. Per-Thread allowlist override. Per-Member rate limiting. Self-hosted Nango. Per-user credential scoping (all workspace-scoped).

## Auth model

All connections are **workspace-scoped**. One connection per provider per Workspace. `external_user_id = workspace_id` for every Pipedream call. The LLM is never a policy/identity decision point — authorization is per-user at the UI boundary (admin connects + enables), credentials are org-level.

## Connection table

| # | Connector | Path | Own OAuth? | Acts as | Who connects |
|---|---|---|---|---|---|
| 1 | GitHub | Own GitHub App | Yes | the App (bot) | Org owner installs |
| 2 | Linear | Pipedream | No | the App | Workspace admin |
| 3 | Jira | Pipedream | No | service user | Admin |
| 4 | Sentry | Pipedream | No | the integration | Org admin |
| 5 | Notion | Pipedream | No | the integration (bot) | Admin |
| 6 | Slack | Pipedream | No | the bot (xoxb) | Admin |
| 7 | Vercel | Pipedream | No | the integration | Team admin |
| 8 | Figma | Pipedream | No | service user | Admin |

## Token storage

* **GitHub:** `installation_id` in `workspace_connectors`. App private key in env/secrets. Installation tokens minted JIT (~1hr TTL), never persisted.
* **All Pipedream connectors:** Tokens in Pipedream's vault. `workspace_connectors` records enablement + `pipedream_account_id` + `connected_at`.

## Tool inventory

**Tier 1 — GitHub (5 read tools):**
* `tempo_github_search_issues(query, repo?)`
* `tempo_github_get_issue(owner, repo, number)`
* `tempo_github_get_pull_request(owner, repo, number)`
* `tempo_github_list_pull_requests(owner, repo, state?)`
* `tempo_github_list_repos()`

**Tier 2 — Dispatcher:**
* `tempo_use_integration(app, action, params)` — read-only enforced via curated action-type allowlist (`search|get|list|find|read|fetch`). Write actions rejected at Worker.

## DB schema

`workspace_connectors`: id PK, workspace_id FK, connector_id, enabled (default false), tier, config (JSON), connected_at, connected_by. UNIQUE(workspace_id, connector_id).

`audit_log`: id PK, workspace_id FK, thread_id FK, connector_id, tool_name, request_summary, response_summary, duration_ms, created_at. Append-only. Index (workspace_id, created_at).

## Steps (original)

* **3.1** DB schema + contracts (6 tool schemas + McpTool enum entries).
* **3.2** Pipedream client module (token exchange, proxy, MCP dispatch).
* **3.3** Gateway governance (`assertConnectorEnabled`, `writeAuditRow`).
* **3.4** GitHub App + 5 read tools.
* **3.5** Tier 2 dispatcher + read-only allowlist.
* **3.6** Console Integrations UI + status/disconnect routes.

## Risks

* Pipedream in the data path (outage → non-GitHub reads fail; acceptable, context enrichment not critical path).
* Workspace-scoped blast radius (least-privilege service accounts; per-workspace enablement; audit log).
* Read-only enforcement is heuristic (action-name patterns; per-app overrides for edge cases).

**Open question (resolved below):** Tier 2 dispatcher app list — static (recommended) vs dynamic. → static, from enabled `workspace_connectors`.

---

# Build plan & decisions (my execution — deviations noted)

Library-first, standard shapes, no band-aids. Deviations from the original file
architecture, each a deliberate "standard code" call:

1. **Connector registry → `@tempo/contracts/connectors`, not `apps/worker/connectors/registry.ts`.**
   The 8-connector metadata (id, label, tier) is needed by BOTH the Worker and
   the Console UI. One source of truth in the shared package. Console maps
   id→lucide icon locally. (Deletes the worker registry file from the plan.)

2. **GitHub + Pipedream clients live in `@tempo/server/connectors/*`, not in the worker app.**
   Both the Console (admin connect/disconnect routes) and the Worker (Agent read
   path) need them. `@tempo/server` is the shared side-effect/query layer. Worker
   tools and Console routes both import the same client.

3. **Connector management routes (status/connect/disconnect/enable) live in the Console**
   (`app/api/connectors/*`), gated by Clerk `auth()` org-admin — the SAME pattern
   as `app/api/workspace/route.ts` (members/invitations). Avoids inventing a
   browser-admin auth path on the Worker. Worker keeps ONLY the MCP tools + gateway.
   Trade-off: PIPEDREAM_*/GITHUB_* secrets live in both Console and Worker env.
   Accepted — Console already holds CLERK/DATABASE/R2 secrets.

4. **DB migration via `drizzle-kit generate`, never hand-written SQL.**
   Schema tables already exist in `schema.ts`; generate produces SQL + snapshot +
   journal atomically. Hand-writing would desync drizzle's meta. Then `db:migrate`.

5. **New connector env vars are `.optional()` in worker `env.ts`.**
   Connectors are additive; required vars would break every existing dev/prod env.
   Each client asserts presence at use-time with a clear error.

6. **Governance (read-safe action allowlist + audit truncation) lives in the Worker `gateway/`,**
   not in the pipedream client. The pipedream client is a dumb transport; policy
   is governed + tested in the gateway. One `runConnectorCall(...)` helper wraps
   assert→time→execute→audit for all 6 tools (real 6-caller dedup, not a seam).

## Testing foundation (Dev-added requirement)

* **Library: `bun test`** (native to the repo's Bun runtime, zero new deps, Jest-like
  API + `mock.module`). Chosen over vitest/jest: nothing to add, fastest path.
* **Location: `apps/worker/test/` mirroring `apps/worker/src/`.** Never inline with src.
  Shared `test/_utils/` (fixtures, fake caller) + `test/_mocks/` (mock `@tempo/server`
  queries + connector clients) so individual tests don't re-roll mocks.
* **Scope: the new connector module's real business logic** — not shallow line coverage:
  - `isReadSafeAction` — search/get/list/find/read/fetch pass; create/update/delete/
    `get_and_update_record` rejected; case-insensitive; per-app overrides (e.g. Notion
    `query_database`).
  - audit `summarize` truncation (length cap, non-serializable input).
  - `assertConnectorEnabled` — throws when disabled/missing, passes when enabled (mocked query).
  - `runConnectorCall` — asserts→executes→audits with duration+summaries; rejects when disabled.
  - dispatcher tool — rejects non-read action BEFORE dispatch; passes read action.
* `bun test` wired as `test` script in worker package.json; `test/` excluded from build.

## Execution stages

* **Stage 1 (me, must compile):** contracts (registry + McpTool enum + connector-mgmt http
  schemas), drizzle migration 0012 + apply, `@tempo/server/connectors` query layer + client
  *interfaces*, worker `env.ts` optional vars, worker `gateway/` helper + resolver, test
  scaffolding (`test/_utils`, `test/_mocks`, package.json `test` script). Add deps
  (`octokit`, `@pipedream/sdk`) to `@tempo/server`.
* **Stage 2 (parallel agents, Sonnet, isolated file ownership):**
  - Agent G: `@tempo/server/connectors/github.ts` + 5 worker `mcp/tools/github-*.ts` (+ tests).
  - Agent P: `@tempo/server/connectors/pipedream.ts` + worker `mcp/tools/use-integration.ts` (+ tests).
  - Agent C: Console `integrations.tsx` + `app/api/connectors/*` routes + api-client + hook.
* **Stage 3 (me):** wire `server.ts` (register 6 tools), typecheck/lint/build green, run
  `code-simplifier` + `code-reviewer` (Sonnet), address findings. Do NOT commit (Dev commits).

## Status log
* [x] Exploration complete — patterns mapped (auth, tools, queries, console, migrations).
* [x] 3.1 done: schema tables, ids, 6 contract input schemas, McpTool enum +6, connector HTTP schemas, registry.
* [x] Migration 0012 generated + applied. Fixed latent meta bug: `meta/0011_snapshot.json` was missing (0011 was hand-authored) — reconstructed it from 0010 + the 0011 delta so drizzle-kit generate works again.
* [!] DRIZZLE GOTCHA: `0011_multi_user_authors` has a future-dated `when` (1782070000000) in `_journal.json` AND in every deployed DB's `__drizzle_migrations`. The migrator orders by `when`, so any new migration MUST use `when` > 1782070000000 or it is silently skipped. 0012 set to 1782070000001. Future migrations: bump above this or re-date 0011 everywhere (DB + journal) to remove the trap.
* [x] Stage 1 — contracts, migration 0012, queries, env, gateway, test harness. All green.
* [x] Stage 2 — 3 parallel agents: GitHub client+5 tools (octokit App), Pipedream client+dispatcher (@pipedream/sdk v3 PipedreamClient.actions.run — NOT createBackendClient), Console UI+routes. All green.
* [x] Stage 3 — wired server.ts (6 tools), full green: typecheck 7/7, build 3/3, tests 42 (22 worker gateway + 20 server). lint: slice clean (1 pre-existing unused-import warning in http.ts).
* [x] Review (code-simplifier + code-reviewer, Sonnet). 0 critical, 4 high, 4 med, 4 low + 6 simplifier.

### Review fixes APPLIED
- HIGH-1 tier bypass: `tempo_use_integration.app` now `Tier2ConnectorId` enum (github + unknown apps rejected at the contract). +`action.max(128)`.
- HIGH-3: `upsertConnector` no longer re-enables on reconnect (preserves admin's disable). connected_at via `sql\`now()\``.
- HIGH-4: Pipedream connect token now sets `successRedirectUri` (Console threads `<origin>/api/connectors/:id/callback`).
- MEDIUM-1: GitHub callback validates `installation_id` is a positive int; client guard hardened.
- MEDIUM-4: migration 0013 — `audit_log` + `workspace_connectors` FKs → ON DELETE CASCADE (thread/workspace deletion no longer blocks).
- LOW-4: `dispatchIntegration` throws (audited) when enabled-but-no-account, instead of a doomed call.
- Simplifier P1: deleted dead `connectorTier`. P5: dropped no-op `ConnectorOkResponse.parse({ok:true})`.

### Review findings KEPT (deliberate, overriding the reviewer)
- Simplifier P2 (inline `assertConnectorEnabled`): kept as a named, directly-tested security gate — explicitness > 2 saved lines.
- Simplifier P3 (`_resetPipedreamClient` test export): the pipedream test needs it for lazy-singleton isolation; commented test-only.
- Simplifier P4 (collapse 5 github tool files into a factory): kept one-file-per-tool to match the existing 10 tool files' convention.
- Simplifier P6 (2 DB round-trips on dispatch): premature optimization vs a network call; not worth the 6-caller signature change.

### Independent doc-verified review (round 2) — 3 reviewers (Context7 + web)
Library usage verified CURRENT/idiomatic (octokit App, @pipedream/sdk v3 PipedreamClient/actions.run/tokens.create/authProvisionId, Next.js, Clerk, drizzle, zod, bun:test — all cited against docs). Fixes applied:
- **H1 (CSRF):** GitHub OAuth `state` is now a signed, expiring HMAC token (`@tempo/server/connectors/state.ts`, domain-separated off `CLI_AUTH_SECRET`) — verified in connect + callback. Forged/foreign state rejected. +7 unit tests.
- **H2 (open-redirect/SSRF):** `successRedirectUri` + callback redirect now use server `env.CONSOLE_URL`, not the request `Host` header.
- **H3 (privilege):** `resolveThreadWorkspace` rejects the `internal` server-to-server caller outright — it can no longer reach any workspace's connectors. +test.
- **M3 (diagnostics):** gateway now catches only `ForbiddenError` → null; real backend errors propagate instead of masquerading as `thread_id_required`. +test.
- **read-safe bypass:** added `sync/push/run/trigger/execute/publish/...` to the write-verb set — `get_and_sync_records` and friends now rejected. +tests.
- **Standards/hardening:** `z.url()` (v4), `number.int().positive()` for issue/PR numbers, pipedream comment corrected.
- **Test depth (reviewer B):** added the missing-coverage cases — bare-string GitHub labels, exact truncation boundaries (500/501, 2000/2001), audit request/response summaries, TempoError code path, Pipedream auth-prop-collision (caller can't inject authProvisionId), successRedirectUri forwarding, dispatch return value. **Tests now 69 (36 worker + 33 server).**

### Spotted but NOT fixed (follow-ups for the Dev)
- **HIGH-2 (CSRF nonce):** GitHub install `state` is the plain workspace_id (callback checks `state===auth.workspace_id` + admin). Adequate baseline, but a signed short-lived nonce is stronger. Deferred: needs a signing secret + the GitHub App dashboard callback URL, and is untestable until the App is configured.
- **MEDIUM-2:** `setConnectorEnabled` silently no-ops if the row is absent (UI only shows the toggle when connected; reachable via race/direct API). Could `.returning()` → 404.
- **MEDIUM-3:** `resolveThreadWorkspace` catches all `authorizeThread` errors → null (can't distinguish deny from DB error). Matches the existing `resolveThreadIdForCaller` house pattern — left consistent.
- **LOW-3:** the 500-char audit cap is app-enforced only (single call site); could be a DB `varchar(500)`.
- **Pre-existing (NOT this slice):** `bun run lint` already fails on `packages/server/src/{comments,threads}.ts` (format) + `apps/worker/src/hosted/supervisor.ts` (unused import) on HEAD; and `http.ts` has a pre-existing unused `AgentTodo/Event` import (warning). Left untouched per the no-drive-by rule.
- **Connect flows are NOT E2E-tested** — GitHub App install + Pipedream Connect both need live provider/dashboard config that doesn't exist in this environment. Logic follows documented patterns; verify when configured.
- **DEPLOY NOTE:** migrations 0012/0013 use `when` 1782070000001/2 to sort above the future-dated 0011. Console env needs the same PIPEDREAM_*/GITHUB_* vars as the Worker.
