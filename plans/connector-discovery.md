# Plan — Tier-2 connector action discovery (kill slug-guessing)

## Problem

The Agent has no way to learn which Pipedream actions exist for a connected app,
so it *guesses* component slugs and `tempo_use_integration` dispatches the guess.
In one test run that produced 8 of 23 calls as Pipedream 404s ("component not
found"), plus a verb-heuristic gate (`read-safe.ts`, ~103 lines + 41 tests) that
exists only because slugs were treated as unknowable.

They are not unknowable. `client.actions.list({ app })` enumerates the **whole
catalog** for an app (input is the app slug only, which we always have) — every
`key`, its `readOnlyHint`, and its name. The Worker **already makes this call**
in `loadActionReadOnlyMap` (`packages/server/src/connectors/pipedream.ts:130`),
caches it per-app for 24h, then discards every key — keeping only the hint. So
the existence data is already in memory; we never expose it and never gate on it.

Concrete failure (call #9, `notion-search-pages`): gate looks up the guessed key
→ absent from the hint map → returns `null` → falls through to the verb heuristic
→ `"search"` leads → "looks read-safe" → **passes** → dispatched → Pipedream 404.
The cached catalog knew the key didn't exist; the gate ignored existence.

## Smallest concrete change

Stop discarding the catalog. Use the one `actions.list({ app })` fetch (already
wired, already cached) for **two** reads, and delete the heuristic it makes
redundant.

1. **Enrich the cache** (`pipedream.ts`). Replace `loadActionReadOnlyMap`
   (returns `Record<key, boolean|null>`) with `loadActionCatalog` returning
   `Record<key, { key; name; readOnlyHint: boolean | null; configurableProps? }>`.
   Same `actions.list({ app })` call, same cache key `pd:actions:${app}`, same
   24h TTL — one fetch now serves existence + read/write + discovery.

2. **Discovery reader** (`pipedream.ts`). `listReadActions(app)` reads the cached
   catalog, filters to `readOnlyHint === true`, returns `{ key, name,
   configurableProps? }[]`. (Writes and unannotated actions are filtered out — the
   Agent can only run reads, so it only sees reads.)

3. **Gate on existence, not verb** (`gateway/action-policy.ts`). Replace
   `isActionReadOnly` with `getActionPolicy(app, key): 'read' | 'write' | 'unknown'`
   read from the same catalog. `assertReadOnlyAction`:
   `read → allow; write → WriteActionRejectedError; unknown → UnknownActionError`
   (message: "call tempo_list_integration_actions to see valid actions"). A
   guessed key is now rejected **locally** instead of dispatched to a 404.

4. **Delete `gateway/read-safe.ts`** (~103 lines: `READ_VERBS`, the 50-entry
   `WRITE_VERBS`, `READ_OVERRIDES`, the tokenizer) **and its test suite (41
   tests)**. Its entire reason to exist — unknowable free-form slugs — is gone.

5. **New MCP tool** `tempo_list_integration_actions` (`apps/worker/src/mcp/tools/
   list-integration-actions.ts`): thin — parse → `resolveThreadWorkspace` → call
   the server discovery reader → format. New contract
   `ListIntegrationActionsInput = { app: Tier2ConnectorId }` +
   permissive `...Output` + enum entry in `packages/contracts/src/mcp.ts`. Trim
   the `tempo_use_integration` description (drop the hand-maintained slug-format
   prose; point at the discovery tool) and the stale `isReadSafeAction` comment.

Net: ~−150 lines + −41 tests; one tool + one contract added; one `actions.list`
call now does the work of three things.

## Alternatives considered

- **Mount Pipedream's hosted remote MCP server** (`remote.mcp.pipedream.net/v3`,
  per-app via `x-pd-app-slug`). Deletes the dispatcher + gate + dispatch path
  outright — strictly more deletion. **Rejected:** it bypasses Tempo's governance
  seam (audit log, workspace allowlist, read-only enforcement), which is the whole
  reason tier-2 routes through the Worker. Preserving governance would mean an
  MCP-proxy inside the Worker re-wrapping every dynamic tool call — *more* new
  surface than a discovery reader, plus a real architecture pivot. The governance
  is a requirement, not leftover scaffolding, so the dispatcher keeps earning its
  place; we make it discovery-backed instead of replacing it.
- **Keep the verb heuristic as a fallback for unannotated actions.** Rejected as
  the default: it is the most fragile, highest-maintenance piece (grew 20→50 verbs
  in one session) and a guessed verb is what lets nonexistent keys through to
  404s. The honest replacement for "unclassifiable" is "invisible + rejected", not
  "guess from the name". (Escape hatch noted under Uncertainties.)
- **Add discovery but leave the gate as-is.** Rejected: leaves the heuristic and
  the existence gap in place — discovery would reduce guessing but a stale/typo'd
  key would still pass the verb check and 404. Gating on existence is the robust
  half; doing only discovery is a band-aid.

## Uncertainties

- **`readOnlyHint` annotation coverage.** If Pipedream leaves many real read
  actions unannotated for an app we care about, deleting the heuristic makes those
  reads invisible (filtered from discovery) and `unknown`-rejected by the gate.
  Escape hatch if a real read goes missing: a tiny per-app key allowlist (a leaner
  `READ_OVERRIDES` keyed by exact key, not verb). **YAGNI until observed** — ship
  the clean deletion, add the allowlist only when a concrete read is missing.
- **Does `actions.list` include `configurableProps` in the list item, or only
  `key`/`name`/`version`?** If props are not in the list payload, discovery still
  returns `key + name` (kills the 404s); prop schemas would be a lazy per-action
  `components.retrieve` only if we later want them to also fix the schema-shaped
  400s. **Verify against `@pipedream/sdk` v3 types before implementing**; the
  first slice does not depend on props being present.
- The Pipedream `notion-query-database` 400s (component sends `null` for
  `filter`/`sorts`) are an upstream **component bug**, orthogonal to discovery.
  Not in scope; do not patch around it.

## Layer assignment

| New/changed | Layer | Why |
|---|---|---|
| `ListIntegrationActionsInput/Output`, enum entry | contracts | wire shape the Agent/Worker exchange |
| `loadActionCatalog`, `listReadActions`, `getActionPolicy` | `packages/server/src/connectors` | SDK access + cache; DB/connector logic |
| `assertReadOnlyAction` (rewrite) | `apps/worker/src/gateway` | governance gate |
| `tempo_list_integration_actions` tool | `apps/worker/src/mcp/tools` | thin: parse → resolve → call server → format |

## Deletion test

- `tempo_list_integration_actions` / `listReadActions` — delete → Agent guesses
  slugs again → 404 storm returns. Real weight (discovery is the fix). **Keeps.**
- `loadActionCatalog` / `getActionPolicy` — consolidation of an existing fetch +
  cache into one source serving two readers; deleting them re-scatters the
  `actions.list` call and the existence/hint logic. **Keeps.**
- New contract — standard I/O contract every MCP tool carries. **Keeps.**
- `read-safe.ts` — *fails* the deletion test (its complexity vanishes once
  existence is known), which is why it is being **deleted**.

## Destructive actions

None. No DB migration, no schema change, no `git push`/deploy/publish. Pure
worker/server/contracts code; net-deletion.
