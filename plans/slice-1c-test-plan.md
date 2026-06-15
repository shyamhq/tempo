# Slice 1c Test Plan

Validation surface for slice 1c-1 (auth foundation, commit `37346ea`) +
slice 1c-2a (CLI rewrite, commit `d75e37e`).

Two sections: **§A automated checks** are run by the agent — the
results below are the actual outputs captured against the live local
stack on 2026-06-15 19:34 IST. **§B manual checks** require browser
interaction or a real `claude` subprocess and have to be exercised by a
human.

---

## §A — Automated checks (already passing)

These run with no human input and were exercised end-to-end against
the local Docker + Worker + Console stack. Re-run before every commit
or PR.

```sh
bun run typecheck     # → 5/5 packages green
bun run lint          # → 0 errors on touched files
bun run --filter @tempo/worker build       # → 2.73 MB index.js
bun run --filter @gmeher/tempo-agent build # → 0.71 MB cli.js
```

### CLI binary smoke

| Command | Expected | Actual |
|---|---|---|
| `node apps/agent/dist/cli.js` | `unknown subcommand ""` + usage + exit 2 | ✓ |
| `node apps/agent/dist/cli.js badcmd` | `unknown subcommand "badcmd"` + usage + exit 2 | ✓ |
| `node apps/agent/dist/cli.js connect` | `usage: tempo-agent connect <thread-id>` + exit 2 | ✓ |

### Worker /health (DB-ping included)

```sh
curl -s http://localhost:3001/health
# → {"ok":true,"version":"0.2.0","db":true}
```

### Worker auth gating

All requests below MUST return `401`:

| Bearer presented | Status |
|---|---|
| no `Authorization` header | 401 ✓ |
| `Authorization: Basic foo` | 401 ✓ |
| `Authorization: Bearer foo_invalid` (wrong prefix) | 401 ✓ |
| `Authorization: Bearer sk_user_<gibberish>` (unknown token hash) | 401 ✓ |
| `POST /mcp` without any Bearer | 401 ✓ |

### DB schema invariants

Run any time to confirm slice 1c-1's migration applied correctly:

```sh
PGPASSWORD=postgres psql -h localhost -U postgres -d tempo -c "\dt"
# → events, sessions, threads, user_tokens, workspaces all present

PGPASSWORD=postgres psql -h localhost -U postgres -d tempo -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'sessions' AND indexname LIKE '%mcp%';"
# → idx_sessions_mcp_session_id (UNIQUE, partial WHERE mcp_session_id IS NOT NULL)

PGPASSWORD=postgres psql -h localhost -U postgres -d tempo -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'user_tokens' AND indexname = 'user_tokens_lookup';"
# → user_tokens_lookup (btree on token_hash WHERE revoked_at IS NULL)
```

### `user_tokens` row hash lengths (after OAuth init)

```sh
PGPASSWORD=postgres psql -h localhost -U postgres -d tempo -c \
  "SELECT LENGTH(token_hash) AS hash_len, LENGTH(refresh_token_hash) AS refresh_len, expires_at > NOW() AS not_expired, revoked_at IS NULL AS not_revoked FROM user_tokens ORDER BY created_at DESC LIMIT 1;"
# → hash_len = 64 (sha256 hex), refresh_len = 64, both flags 't'
```

### Sticky session row after first `tempo_attach`

```sh
PGPASSWORD=postgres psql -h localhost -U postgres -d tempo -c \
  "SELECT mcp_session_id IS NOT NULL AS has_mcp, status FROM sessions WHERE mcp_session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;"
# → has_mcp = 't', status = 'connected'
```

### Activity event shape sanity

After running `tempo-agent connect <thread-id>` for the first time and
letting the LLM make at least one tool call:

```sh
PGPASSWORD=postgres psql -h localhost -U postgres -d tempo -c \
  "SELECT kind, jsonb_object_keys(payload_json) FROM events WHERE kind LIKE 'agent_%' GROUP BY kind, jsonb_object_keys ORDER BY kind, jsonb_object_keys;"
```

Expected keys per kind:

| kind | required keys in `payload_json` |
|---|---|
| `agent_tool_use` | `id`, `created_at`, `kind`, `tool`, `summary` |
| `agent_narration` | `id`, `created_at`, `kind`, `text` |
| `agent_todos_updated` | `id`, `created_at`, `kind`, `todos` |
| `agent_turn_ended` | `id`, `created_at`, `kind` |

---

## §B — Manual checks (require human + browser + claude binary)

Run these once per major change to the auth or wrapper. Group order
matches risk: A items are critical, B items are nice-to-have, C items
are expected-to-fail demonstrations.

### Prereqs

1. Local stack running: `docker compose up`, `bun run --filter @tempo/console dev` (port 3000), `bun run --filter @tempo/worker dev` (port 3001).
2. Migrations applied: `bun run --filter @tempo/db db:migrate`.
3. Env vars set in `apps/console/.env.local` AND `apps/worker/.env` — `CLI_AUTH_SECRET` must match byte-for-byte; `TOKEN_HASH_PEPPER` Worker-only; `CLERK_SECRET_KEY` matches Clerk app.
4. You're signed into Console with Clerk in your default browser.
5. CLI binary built: `bun run --filter @gmeher/tempo-agent build`.

### A. Critical auth + connect surface

#### A1. OAuth happy path

```sh
node apps/agent/dist/cli.js init
```

- Browser opens to `localhost:3000/cli/authorize?…`
- Page renders your email + workspace name (sourced from your Clerk session)
- Click **Allow**
- Terminal prints `✓ Authenticated as <email>. Run \`tempo-agent connect <thread-id>\` to start planning.`

Verify the credential file:

```sh
ls -l ~/.tempo/credentials.json   # mode -rw-------
jq '. | {version, user_id, email, worker_url, has_token: (.token != null), expires_at}' \
  ~/.tempo/credentials.json
```

#### A2. OAuth Deny path

Repeat A1 but click **Deny**.

- Terminal: `tempo init failed: user denied authorization` / exit 1
- `~/.tempo/credentials.json` is NOT modified (any pre-existing file stays untouched).

#### A3. OAuth timeout

Run `tempo-agent init`, then close the browser tab without clicking
anything. Within 5 minutes:

- Terminal: `tempo init failed: browser flow timed out after 5min` / exit 1

#### A4. State mismatch (replay protection)

Run `tempo-agent init`, copy the `callback?code=…&state=…` URL from
the browser's address bar (do NOT click Allow yet). Open a new tab,
tamper with the `state` value, hit the URL. Click Allow on the
original tab next.

- The tampered request → connection-reset (CLI listener rejects state
  mismatch).
- Original-tab Allow → CLI prints `tempo init failed: state mismatch
  (possible replay)`.

#### A5. End-to-end connect with a real Thread

Create a Thread in Console, copy the `thr_…` from the URL.

```sh
node apps/agent/dist/cli.js connect thr_<your-id>
```

- Terminal prints `Connecting to <workspace>'s Thread "<title>"...`
- `claude` opens in the same terminal
- Activity feed in Console shows tool calls, narration, todos updating
  in near-real-time

The LLM will eventually try one of the not-yet-registered tools
(`tempo_pull_plan`, `tempo_update_plan`, etc.) and report "tool not
found" gracefully. That's expected for 1c-2a — the LLM should reason
about it and either suggest options or summarize what it discovered.
The wrapper should exit cleanly after the `result` event.

#### A6. SIGINT (Ctrl-C) cleanup

While A5 is running, hit Ctrl-C.

- `claude` killed within 5 seconds
- `ls /tmp/tempo-*.json` returns nothing (temp file unlinked)
- `ps aux | grep -i claude` returns no claude processes

#### A7. Token refresh path

Force a token to expire in 30 seconds:

```sh
jq '.expires_at = "'$(date -u -v+30S '+%Y-%m-%dT%H:%M:%S.000Z')'"' \
  ~/.tempo/credentials.json > /tmp/c.json && mv /tmp/c.json ~/.tempo/credentials.json
```

Wait 30+ seconds, then `node apps/agent/dist/cli.js connect thr_<id>`.

- CLI calls `/api/cli/refresh` before preflight (you'll see Worker logs
  show `POST /api/cli/refresh 200`).
- `~/.tempo/credentials.json` is rewritten with a new `issued_at`,
  `token`, `refresh_token`, `expires_at`.
- Connect proceeds normally.

#### A8. Refresh token single-use

Save the old refresh token before A7, then attempt to use it after a
successful refresh:

```sh
# Before A7's refresh fires:
OLD_REFRESH=$(jq -r .refresh_token ~/.tempo/credentials.json)

# Force a refresh via A7's expiry trick + `connect`. Then:
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$OLD_REFRESH\"}" \
  http://localhost:3001/api/cli/refresh | jq
```

- Expected: `{ "error": "unauthorized" }`. The atomic-revoke-and-issue
  transaction in `refreshUserToken` revoked the old row when it minted
  the new one.

### B. Edge cases worth confirming once

#### B1. Browser-side Plan editing still works

Open the Thread in Console UI, edit the Plan text in the Tiptap
editor, save. The change should persist (still hits Console's existing
routes — the route migration is 1c-2b).

#### B2. Cross-workspace rejection (only if you're in multiple workspaces)

In Workspace A, create a Thread `thr_A`. In Workspace B (which you're
NOT a member of), get a thread id `thr_B` from a teammate. Then with
your authenticated CLI:

```sh
node apps/agent/dist/cli.js connect thr_B
# → "tempo connect failed: not a member of this workspace"
```

#### B3. Tampered token

```sh
cp ~/.tempo/credentials.json /tmp/saved.json
jq '.token = "sk_user_invalid_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"' \
  ~/.tempo/credentials.json > /tmp/c.json && mv /tmp/c.json ~/.tempo/credentials.json
node apps/agent/dist/cli.js connect thr_<id>
# → "tempo connect failed: token rejected by worker (HTTP 401)"
mv /tmp/saved.json ~/.tempo/credentials.json   # restore
```

#### B4. Missing credentials file

```sh
mv ~/.tempo/credentials.json /tmp/saved.json
node apps/agent/dist/cli.js connect thr_<id>
# → friendly error, points at `tempo-agent init`
mv /tmp/saved.json ~/.tempo/credentials.json
```

#### B5. Wrong Thread ID format (passes a `tmp_` token by mistake)

```sh
node apps/agent/dist/cli.js connect tmp_kaJk…
# → "not a member of this workspace" (Worker conflates not-found + not-member, by design)
```

### C. Expected-to-fail (these are slice 1c-2b's job)

#### C1. LLM tries Plan-write tools and reports tool-not-found

Inside an A5 session, watch the agent's stream-json output. The LLM
will probe `tempo_attach` (works), then likely call
`ListMcpResourcesTool` (a claude built-in) to discover what's
available, then either:

- Try a missing tempo_* tool and report "the tool isn't available"
- Or short-circuit and tell you it can't draft a plan without the
  remaining tools

Either way → wrapper should exit cleanly after the `result` event.

#### C2. Browser writes don't yet hit Worker

Open browser devtools while editing the Plan in Console. Requests go
to `localhost:3000/api/threads/...` (Console), NOT
`localhost:3001/api/...` (Worker). That's slice 1c-2b's repoint job.

#### C3. CORS isn't configured on Worker yet

```sh
curl -s -i -X OPTIONS -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  http://localhost:3001/api/agent-events | head -8
```

You'll see no `Access-Control-Allow-Origin` header — Worker doesn't
mount the `cors` middleware until 1c-2b. Expected.

---

## What's NOT yet testable

These ship in 1c-2b and have no validation surface today:

- `tempo_pull_plan` / `tempo_update_plan` / `tempo_update_block` /
  `tempo_add_blocks` / `tempo_delete_block` / `tempo_poll` /
  `tempo_post_reply` / `tempo_post_discussion_message` /
  `tempo_set_thread_meta` / `tempo_load_skill` on Worker MCP
- Browser → Worker for Plan/Comment/Discussion writes (lib/api-client.ts
  refactor + Bearer Clerk JWT path)
- Worker.tempo.dev DNS + CORS for production
- Worker-side skills bundle (`tempo_load_skill` returns server-side)
- Worker-side R2 attachment signing
- The full LLM planning loop (read Plan → propose draft → write via
  `tempo_update_plan` → respond to Comments via `tempo_post_reply`)
