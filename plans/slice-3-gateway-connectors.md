# Slice 3 — Gateway + first Connector + allowlist + approve-gate (rough stub)

**Status:** rough stub for cross-slice coherence. Full plan + `judge`
gate land when slice 3 starts.

## Scope (one paragraph)

Make Worker's MCP endpoint actually *governed* — the **Gateway**
responsibility from `agent-harness.md` §5. Every connector-tool call
flows through: allowlist check (per-Thread enabled Connectors) →
approve-gate (writes denied until Plan approved, enforced via the SDK's
`canUseTool` hook + dynamic tool registration) → token resolution from
Nango (each Connector declared Workspace-scoped, Member-scoped, or
hybrid) → execute the third-party call **from Worker** (not from the
VM, not via Nango's proxy — data path stays in our VPC) → provenance
stamp on results → redaction before results stream to Console → audit
log row written immutably. Stand up self-hosted **Nango** in our VPC.
Ship the first Connector (Ring 1) — likely GitHub or Linear, decided
at slice-3 start. Console gains a Workspace-admin **Integrations**
section (already partially scaffolded in `apps/console/components/
workspace/sections/`) for Connector enablement, plus a per-Thread
Allowlist UI.

## Directories `apps/worker/src/` gains

```
apps/worker/src/
├── (existing from 1b + 1c + 2)
├── gateway/
│   ├── allowlist.ts              per-Thread enabled-Connectors check
│   ├── approve-gate.ts           denies connector-write tools when
│   │                             plan.status !== 'approved'
│   ├── permission-hook.ts        SDK canUseTool hook that wires
│   │                             allowlist + approve-gate into the
│   │                             Hosted loop. For Local, enforcement
│   │                             is at tool registration time.
│   ├── provenance.ts             stamp results with source anchor
│   ├── redact.ts                 strip secrets/tokens before results
│   │                             leave Worker.
│   └── audit.ts                  immutable row per governed call.
├── connectors/
│   ├── registry.ts               declares each Connector's auth mode
│   │                             (workspace / per-Member / hybrid) +
│   │                             which tools are read vs write.
│   ├── grants.ts                 resolve Grant from Nango given
│   │                             (connector, workspace, member, mode).
│   ├── github/                   first Ring 1 candidate
│   │   ├── tools.ts              tempo_search_github_*, tempo_fetch_*
│   │   ├── client.ts             GitHub REST/MCP wrapper
│   │   └── meta.ts               auth mode declaration, scopes, etc.
│   └── linear/                   alternate Ring 1 candidate
│       ├── tools.ts
│       ├── client.ts
│       └── meta.ts
└── nango/
    ├── client.ts                 self-hosted Nango HTTP client
    └── deploy/                   docker-compose + secrets bootstrap
                                  for the self-hosted instance.
```

## Database additions (`packages/db/src/schema.ts`)

- `connector_allowlist` — `(workspace_id, thread_id, connector_id,
  enabled, updated_at, updated_by)`. Effective allowlist is workspace
  defaults overridden per Thread.
- `connector_workspace_defaults` — `(workspace_id, connector_id,
  enabled)`. Admin-controlled.
- `audit_log` — `(id, workspace_id, thread_id, member_id, connector_id,
  tool_name, request_summary, response_summary, redacted, created_at)`.
  Immutable.
- (Nango runs its own schema in its own database.)

## Contract additions

- `@tempo/contracts/mcp` — new `tempo_*` tools per Connector. Their
  shapes are stable from day one; renaming later is a breaking change.
- New HTTP routes:
  - Workspace admin: list/enable/disable Connectors at Workspace level.
  - Thread participant: list/enable/disable Connectors at Thread level.
  - Per-Member: start an OAuth dance for a Member-scoped Connector.
- New event kinds: `connector_called`, `connector_call_denied_by_gate`,
  `connector_grant_added`, `connector_grant_revoked`.

## Console UI additions

- **Workspace Settings → Integrations** (scaffolded already in `apps/
  console/components/workspace/sections/integrations.tsx` as a coming-
  soon stub). Slice 3 fills it in.
- **Thread header → Allowlist toggle** (small popover). Or it lives in
  the Discussion panel's left rail.
- **Per-Member OAuth flow** — Console renders Connect-Linear /
  Connect-GitHub buttons; the OAuth dance goes through Nango (per-
  Member Grant) and Worker stores the resulting `connectionId`.

## Forward-compat constraints on slices 1b + 1c + 2

- `gateway/`, `connectors/`, `nango/` are new siblings. 1b/1c/2 must
  not collide.
- The MCP tool registration in 1c is what `gateway/permission-hook.ts`
  wraps in slice 3. Each tool in 1c gets a classification (read vs
  write; needs-allowlist or not) — preserve that metadata in the tool
  definition so slice 3 doesn't have to retro-classify.
- The Hosted SDK loop's `canUseTool` hook (slice 2) is where the
  approve-gate plugs in. Slice 2 should wire `canUseTool` even if it
  always returns `allow` — slice 3 adds the real decision logic.
- The audit log's row format should accommodate non-Gateway calls too
  (Plan writes, conversation tools) so the audit table is the single
  governance artifact even if the Gateway middleware only fires for
  Connector calls.

## Judge gate

Required (new product surface — Nango, OAuth, Connector tools,
governance pipeline, billing-and-security-affecting). Full plan when
slice 3 starts.
