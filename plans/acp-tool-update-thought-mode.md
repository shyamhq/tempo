# ACP: surface tool_call_update + agent_thought_chunk + current_mode_update

**Status:** revised after judge round 1 (5 blocking findings addressed)
**Scope:** add three event kinds end-to-end (contract → Agent → Worker → Console) + verify-then-fix one upstream-validator workaround

## Problem

`apps/agent/src/acp/notifications.ts` drops three useful ACP `sessionUpdate` variants today:

- `tool_call_update` — running/completed/failed states for tool calls. The Console chip stays "pending"-looking forever; the Dev can't tell when a tool finished.
- `agent_thought_chunk` — Extended Thinking output. The Dev sees silence while Claude is mid-decision.
- `current_mode_update` — mode transitions (e.g. Plan mode). Useful as a small system row.

We also confirmed the ACP SDK rejects malformed `tool_call_update` notifications from the Claude adapter (`acp.js:563` logs `"Error handling notification" … -32602 Invalid params`). Our handler is never invoked for those — we must intercept before SDK validation, **but only after we have a captured real payload** to know what shape to coerce into.

## Smallest concrete change

### Contracts — two files, lockstep

**`packages/contracts/src/events.ts`** (the persisted event union):

```ts
export const AgentToolUseEvent = eventBase.extend({
  kind: z.literal('agent_tool_use'),
  tool: z.string().max(64),
  summary: z.string().max(200),
  tool_call_id: z.string().max(128).optional(), // NEW — correlates updates back to this chip
});

export const AgentToolUseUpdateEvent = eventBase.extend({   // NEW
  kind: z.literal('agent_tool_use_update'),
  tool_call_id: z.string().max(128),
  status: z.enum(['in_progress', 'completed', 'failed']),
});

export const AgentThoughtEvent = eventBase.extend({          // NEW
  kind: z.literal('agent_thought'),
  text: z.string().min(1).max(8000),
});

export const AgentModeChangedEvent = eventBase.extend({       // NEW
  kind: z.literal('agent_mode_changed'),
  mode_id: z.string().max(64),
});
```

Plus add the three new schemas to `Event = z.discriminatedUnion('kind', [...])` (`events.ts:125`) and the three new strings to `EventKind = z.enum([...])` (`events.ts:148`).

**`packages/contracts/src/http.ts`** (the CLI → Worker upload shape — `AgentEventRequest`): mirror the same four shapes (existing `agent_tool_use` extended, three new variants).

**`packages/contracts/src/trails.ts`** — extend `TrailStep['tool']`:

```ts
z.object({
  kind: z.literal('tool'),
  id: EventId,
  ts: IsoTimestamp,
  tool: z.string(),
  summary: z.string(),
  tool_call_id: z.string().nullable(), // NEW
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).nullable(), // NEW
}),
```

And update `deriveTrails` (`trails.ts:60`): add a case for `agent_tool_use_update` that finds the matching `'tool'` step in `cur.steps` by `tool_call_id` and mutates its `status` in place. The initial `agent_tool_use` writes `status: 'pending'` (or null when `tool_call_id` is absent — backward compat). Add a no-op case (or rely on the existing switch's fall-through) for `agent_thought` and `agent_mode_changed` — those are timeline events, not trail steps.

Actually `agent_thought` IS a trail step. Add a fourth `TrailStep` variant:

```ts
z.object({
  kind: z.literal('thought'),
  id: EventId,
  ts: IsoTimestamp,
  text: z.string(),
}),
```

And the matching `deriveTrails` case appends it like `narration`. `agent_mode_changed` is NOT a trail step — it's a timeline-level system row, surfaced only via `use-thread-events.ts` live activity.

**`WAKE_KINDS` non-decision (`events.ts:180`):** the three new kinds DO NOT join `WAKE_KINDS`. They are Agent-originated echoes — adding them would cause ping-pong wake loops like the `reply_added` author filter already prevents. `shouldWake` already returns `false` for kinds outside the set, so additive-only behavior is preserved; explicit comment in the plan + the code so the next reviewer doesn't add them "for symmetry."

### Agent (`apps/agent/src/acp/`)

- **`notifications.ts`** — second `TextBuffer` for thoughts. Replace `default: return []` with explicit cases:
  - `agent_thought_chunk` → buffer.append; flush at boundaries as `agent_thought` event.
  - `tool_call_update` → map `status` ACP enum → our 3-state enum (`'pending' | 'in_progress'` → `'in_progress'`; `'completed'` → `'completed'`; `'failed'` → `'failed'`). If `status` is absent (per ACP schema, optional), skip — no event. Emit `agent_tool_use_update { tool_call_id, status }`.
  - `current_mode_update` → emit `agent_mode_changed { mode_id: u.currentModeId }`.
- **`tolerant-stream.ts`** (new, ~30 LOC) — guarded by **Step 1 below**. Wraps the readable side of the stdio stream, splits NDJSON, finds `tool_call_update` lines, normalizes `rawOutput` and `content` to ACP-conformant shapes per the captured payload. Idempotent. Marked with `// ponytail: delete when @zed-industries/claude-code-acp normalizes MCP tool results upstream` plus the GitHub issue URL.
- **`session.ts`** — pass stdout through `tolerantStream` before `ndJsonStream`. Also: emit a `tool_call_id` on every `agent_tool_use` event (read from the `tool_call` notification's `toolCallId`).

### Worker / Server

No direct file changes — `Event` validation in `packages/server/**` already runs against the contracts union. Once `events.ts` ships the new kinds, append-time validation accepts them automatically. The persisted `events` table is `jsonb`, no schema migration.

### Console (`apps/console`)

- **`apps/console/components/thread/agent-trails.tsx`** — owns trail-derived rendering. New visuals:
  - Tool chip reads `status` from the (now updated-in-place) `TrailStep['tool']`. New visual states: `pending` (no spinner — just the tool name), `in_progress` (pulse/spinner), `completed` (check icon), `failed` (red x). Existing fallback for steps without `status` (legacy events): unchanged appearance.
  - Thought step → new collapsible "Thinking…" block with markdown body. Collapsed by default with a "Thinking · 3 chunks" header.
- **`apps/console/hooks/use-thread-events.ts`** — owns live-activity fan-out. Two surfaces:
  - `LiveActivity` already aggregates streaming `agent_*` events into the in-flight trail; extend it to include `agent_thought` (treated as in-flight narration) and apply `agent_tool_use_update` mutations to the in-flight tool steps the same way `deriveTrails` does on already-persisted history (the two paths must agree).
  - `agent_mode_changed` → small system row in the timeline ("Agent entered <mode>"). Not a trail step.

## Implementation order

1. **Capture real `tool_call_update` payload.** Run `tempo-agent connect <thread>` against a thread that triggers `tempo_pull_plan`, with `TEMPO_LOG_MODE=verbose` AND a one-off patch that logs the raw stdout line BEFORE handing to the SDK. Capture the actual shape of `rawOutput` and `content`. Paste it into this plan section before any code below it ships.
2. **Contracts** — `events.ts`, `http.ts`, `trails.ts` updates. Workspace typecheck must pass.
3. **Agent** — `notifications.ts` cases, `session.ts` `tool_call_id` plumbing, `tolerant-stream.ts` built against the Step-1 payload.
4. **Console** — `agent-trails.tsx` rendering, `use-thread-events.ts` live mutation.
5. **Smoke test** — repeat the connect against the same thread; confirm thought blocks render, tool chips transition, mode-changed rows appear.

If Step 1 reveals the malformation is too varied (e.g. shape differs per MCP tool), split `tolerant-stream.ts` and the `tool_call_update` event-mapping into a follow-up plan; ship `agent_thought` + `agent_mode_changed` standalone in this round.

## Alternatives considered

### A) Tool-update event shape: extend existing vs new kind

1. **Extend `agent_tool_use`** with optional `status`. One kind; updates and starts share a shape with mostly-null fields per row; Console groups by `tool_call_id`.
2. **New `agent_tool_use_update` kind.** Start carries `tool`+`summary`+`tool_call_id`; update carries `status`+`tool_call_id`. Two kinds, semantic split, `deriveTrails` mutates the existing `'tool'` step in place by id.

**Pick 2.** Start and update are semantically different; sharing a shape forces nullable-field gymnastics. Two kinds reads cleaner in the event log; trail derivation finds and mutates the start step (judge-approved per round-1 note "in-place mutation by id").

### B) SDK validation workaround for tool_call_update

1. **Wait for upstream fix.** Zero work, indefinite timeline. `tool_call_update` never lands until they ship.
2. **Intercept stream before SDK validation** with `tolerant-stream.ts`. One layer at the ACP boundary, gracefully degrades when upstream fixes. **Gated on captured payload (Implementation Step 1).**
3. **Bypass SDK entirely for this variant** (tee + custom parser). Two parsing paths to maintain.

**Pick 2 with the capture gate.** Single intercept point, ponytail-commented with the upgrade path. The capture step is non-negotiable per judge P3/P5 — we don't ship a workaround against a shape we haven't seen.

### C) Thinking event shape: separate kind vs flag

1. **`agent_thought` distinct kind** + new `TrailStep['thought']` variant.
2. **`agent_narration` with `thought: true`** flag.

**Pick 1.** Distinct UX (collapsible block vs prose bubble), distinct rendering. Flagging is a Console concern leaking into the contract.

## Uncertainties

- **Step-1 capture is load-bearing.** The exact malformed shape from `claude-code-acp` is not yet observed (judge P5). Plan is unimplementable past the capture step until that's done.
- Whether non-MCP tools (`Read`, `Grep`, etc.) also produce malformed `tool_call_update`. If they do, the reshape is wider than just MCP-result normalization. Capture step settles this in one run.
- `tool_call_update.status` is optional in the ACP schema. Real traffic frequency of missing-status updates determines whether we ever emit zero-info updates.
- Are there mode IDs beyond `"default"` and `"plan"` that warrant special Console copy? Likely no, but worth a quick check during smoke.

## Deletion test

| New thing | What reappears if deleted in 6 months |
|---|---|
| `agent_thought` event kind + `TrailStep['thought']` | Nothing — Console loses Thinking visibility, code shrinks. Passes. |
| `agent_tool_use_update` event kind + status mutation in `deriveTrails` | Nothing — chips revert to fire-and-forget. Passes. |
| `agent_mode_changed` event kind | Nothing — mode transitions go invisible. Passes. |
| `tool_call_id` on `agent_tool_use` + `TrailStep['tool']` | Nothing — chips can't be correlated to updates, but updates are also gone. Passes alongside the new kinds. |
| `tolerant-stream.ts` shim | If upstream still ships malformed updates, `tool_call_update` events vanish again. Conditional pass — comment names upgrade path (GitHub issue link + "delete when adapter normalizes MCP results"). |

## Layer assignment

| New code | Layer | File |
|---|---|---|
| Event-kind Zod schemas (persisted) | contracts | `packages/contracts/src/events.ts` |
| Event-kind Zod schemas (wire) | contracts | `packages/contracts/src/http.ts` |
| TrailStep additions + deriveTrails mutation | contracts | `packages/contracts/src/trails.ts` |
| ACP notification mapping | agent/acp | `apps/agent/src/acp/notifications.ts` |
| Stream tolerance shim | agent/acp | `apps/agent/src/acp/tolerant-stream.ts` (new) |
| `tool_call_id` plumbing through to `agent_tool_use` | agent/acp | `apps/agent/src/acp/session.ts` + `notifications.ts` |
| Thought block + chip-status rendering | console | `apps/console/components/thread/agent-trails.tsx` |
| Live-activity mutation + mode row | console | `apps/console/hooks/use-thread-events.ts` |

## Out of scope

- **Hosted runner emission.** `apps/worker/src/hosted/runner.ts` does not emit `agent_tool_use_update` or `agent_thought` today and isn't changing in this plan. The contract additions are backward compatible — hosted just keeps emitting the existing `agent_tool_use` events without `tool_call_id`, and chips render in the legacy fallback appearance. Adding hosted emission is a follow-up.
- Surfacing `user_message_chunk` or `available_commands_update` — no Tempo UI for them, no use case.
- Filing/fixing the upstream `claude-code-acp` MCP-result-normalization bug as part of this work (separate GitHub issue; the shim's ponytail comment links to it).
- Adding Zod validation to inbound ACP notifications on our side (research showed low ROI given pinned SDK version).
- Thinking-panel UX details (collapsed-by-default vs hover-to-expand) — the contract + emission are independent of the rendering choice and ship without that decision.

## Dev acknowledgments

None required — no rule-24 destructive actions.
