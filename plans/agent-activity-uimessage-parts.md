# Blueprint: Unify Agent Activity on AI SDK `UIMessage.parts[]`

**Status:** Reviewed (algorithm/first-principles pass, Opus) → APPROVE-WITH-CHANGES, changes folded in. 5 steps.
**Repo:** `/Users/shyam/Projects/personal/tempo` (main checkout — all paths below are from here).
**SDK:** `ai@6.0.206` (already a dep in `apps/worker`). Verified present: `toUIMessageStream`, `readUIMessageStream`, `validateUIMessages`, `DynamicToolUIPart`, `UIMessageChunk`.

**Objective:** Replace the bespoke `agent_*` event taxonomy with the standard AI SDK v6 `UIMessage.parts[]` representation — produced by BOTH runtimes (hosted = AI SDK native, local CLI = ACP→parts), persisted as JSON, streamed live, rendered with Vercel AI Elements — so reasoning + tool calls (input **and** output + live status) show in real time and survive a refresh.

**Why (first principles):** "Show reasoning + tool calls live, keep them on reload" is the universal chatbot requirement, solved by one battle-tested shape (`UIMessage.parts`). Our taxonomy is a lossy reinvention (drops tool output/status/sources; "feels stuck" is the symptom). Adopt the standard once; stop redoing.

**Runtime keystone:** hosted already runs `streamText` → emits parts natively via `toUIMessageStream()`. CLI maps ACP → the same parts. Both converge; only the producing edge differs.

---

## What the review changed (vs first draft)
1. **Delete the hand-rolled server accumulator** → reuse the SDK's `readUIMessageStream` for chunk→message assembly (server persist + browser live). Biggest deletion; avoids the exact reinvention we're killing.
2. **`toUIMessageStream({ sendSources: true })`** — defaults to **false**; without it, web-search/fetch citations are silently dropped (re-introducing lossiness). Add a `source-url` test + an **abort/interrupt** test (the runner's wake-mid-turn abort is load-bearing).
3. **Drop the `data-plan` custom part.** AI Elements `<Task>` is prop-driven (binds to no part type); the Plan doc is already canonical. Render `<Task>` from the existing Plan/todos. `TempoUIMessage` collapses toward the plain SDK `UIMessage`.
4. **Persist terminally** (final assembled message only); keep XADD per delta for live (no per-token Postgres writes).
5. **Renderer handles BOTH `dynamic-tool` and `tool-*`** — MCP fs/tempo tools → `dynamic-tool`; local `Bash`/`Grep` (static `inputSchema`) → `tool-*`. `<Tool>` accepts both.
6. **Batch CLI→Worker chunk POSTs** (`UIMessageChunk[]` per flush boundary) — the CLI reaches the Worker only over HTTP.
7. **S4 (filter) folded into S0** — `shouldDeliverToAgent` already returns false for non-wake/cancel kinds, so a new `agent_chunk` frame is filtered from agents by default; only widen the union type.

---

## Target architecture

```
 PRODUCERS (edge differs)                         SHARED (one path)
 hosted: streamText().toUIMessageStream(          Worker POST /agent-stream
   { sendSources:true }) ──UIMessageChunk[]──►      ├─ XADD agent_chunk frame (live, per delta)
 cli: ACP session/update ─► mapper ─► chunks ─►     └─ on turn end: readUIMessageStream → final UIMessage → persist parts_json
                                                   Browser:
                                                     live  = readUIMessageStream(SSE agent_chunk) → UIMessage
                                                     load  = GET persisted parts
                                                     render= parts.map(switch): <Reasoning>/<Tool>/<Sources>/<Response>; <Task> from Plan
```

- **One type:** plain AI SDK v6 `UIMessage` (re-exported from `@tempo/contracts`; no custom data parts). Wire validation via `validateUIMessages`.
- **Parts:** `text` · `reasoning` (state streaming|done) · `dynamic-tool` + `tool-*` (toolCallId, state input-available→output-available|output-error, input, output/errorText) · `source-url`. Plan/todos are NOT a part — rendered from the canonical Plan via `<Task>`.
- **Live = chunk stream**; **persist = terminal** assembled message.
- **Build alongside** the `agent_*` path; flip UI to parts; delete `agent_*` last. App stays green throughout.

## Dependency graph & parallelism
```
S0 contract+frame ──► S1 persist+ingest (readUIMessageStream) ──► S2 hosted ─┐
                                                                S3 cli ───────┼─► S4 console (AI Elements) ──► S5 delete agent_*
S2 ∥ S3  (disjoint files: apps/worker/src/hosted/runner.ts vs apps/agent/src/acp/{notifications,session}.ts; share only S0)
```
| Step | Title | Depends | Parallel | Model |
|---|---|---|---|---|
| S0 | Parts contract + `agent_chunk` frame + filter widening | — | — | strongest |
| S1 | `agent_messages` persist + Worker ingest via `readUIMessageStream` | S0 | — | default |
| S2 | Hosted producer → `toUIMessageStream({sendSources:true})` | S1 | S3 | default |
| S3 | CLI producer → ACP→chunk mapper | S1 | S2 | strongest |
| S4 | Console render via AI Elements | S1 (+S2/S3 to exercise) | — | default |
| S5 | Delete `agent_*` taxonomy + old trail | S2,S3,S4 | — | default |

---

## S0 — Parts contract + `agent_chunk` frame + filter  *(strongest; blocks all)*

**Context brief:** `@tempo/contracts` (`packages/contracts/src/`) holds the Zod `Event` union (`events.ts`), re-exported via `index.ts` (`export * from './events'`). `shouldWake`/`shouldDeliverToAgent` live in `events.ts:181-196`; the latter returns `false` for any non-wake/non-cancel kind. Ephemeral SSE frames exist already (`PresenceSignal`, `events.ts:104-111`) — not persisted, same stream. `parseStreamEvent` (`packages/server/src/redis.ts:77-88`) JSON-parses without schema validation.

**Tasks:**
- New `packages/contracts/src/agent-message.ts`: `import type { UIMessage, UIMessagePart, UIMessageChunk } from 'ai';` and re-export. Export `TempoUIMessage = UIMessage` (no custom data parts; keep generic so both `dynamic-tool` and `tool-*` render). Export a `validateTempoMessages` thin wrapper over `validateUIMessages`.
- Define the ephemeral wire frame `AgentChunkFrame = { kind: 'agent_chunk'; turn: string; chunk: UIMessageChunk }` (mirror `PresenceSignal`). NOT an `Event` union member; NOT persisted as a row.
- Widen the `sseStream` filter param + `shouldDeliverToAgent` signature to accept `AgentChunkFrame`; confirm it returns `false` for `agent_chunk` (default branch already does — add a test, no new branch).
- `index.ts` re-export.

**Verify:** contracts `bun run typecheck`; unit test round-trips a sample `TempoUIMessage` (text+reasoning+dynamic-tool+tool-*+source-url) through `JSON.stringify`/parse + `validateTempoMessages`; assert `shouldDeliverToAgent({kind:'agent_chunk'})===false`.

**Exit:** exports compile; sample validates; frame shape documented in file header. Nothing wired.
**Rollback:** additive file; revert.

---

## S1 — Persistence + Worker ingest (`readUIMessageStream`)  *(default)*

**Context brief:** DB schema `packages/db/src/schema.ts` (Drizzle); migrations in `packages/db/drizzle/` with the `_journal.json` `when` trap (new migration must bump `when` above 0014's `1782070000000` — memory `project_drizzle_migration_timestamp_trap`). Run: `bun --env-file=apps/console/.env.local run packages/db/src/migrate.ts`. Agents post activity over HTTP to the Worker (`/api/agent-events`); the CLI cannot reach Redis directly. SSE relay: `packages/server/src/events-stream.ts` `sseStream`, XADD via `redis.ts`.

**Tasks:**
- Migration: `agent_messages` `{ id, thread_id (fk), turn_seq, role default 'assistant', parts_json jsonb, status 'streaming'|'final', created_at, updated_at }`. One row per turn.
- `packages/server/src/agent-messages.ts`: `startTurn(threadId)→{id,turn}`; `ingestChunks(id, chunks: UIMessageChunk[])` → XADD one `agent_chunk` frame per chunk (live); **buffer chunks in-memory/stream**; `finalizeTurn(id, chunks)` → feed the full chunk sequence through `readUIMessageStream` (the SDK accumulator — do NOT hand-roll), take the final `UIMessage`, write `parts_json`, set `status:'final'`. `listAgentMessages(threadId)`.
- Worker ingest route `POST /api/threads/:id/agent-stream` accepting `UIMessageChunk[]` (batched). Auth = existing agent caller guard.
- Add persisted agent messages to turn-1 hydration (`getTurnHydration`/`/access`) so re-attached UI/agent see prior turns.
- **Persistence is terminal** — per-delta = XADD only; Postgres write once at `finalizeTurn`.

**Verify:** migration applies (journal `when` bumped); unit test: feed a chunk sequence to `readUIMessageStream`, assert final `parts_json` (reasoning + dynamic-tool input→output + source-url); server `bun run typecheck`.
**Exit:** a producer can POST batched chunks → live `agent_chunk` frames + one persisted assembled message. `agent_*` path intact.
**Rollback:** additive table + route; drop/revert.

---

## S2 — Hosted producer → `toUIMessageStream`  *(default; ∥ S3)*

**Context brief:** `apps/worker/src/hosted/runner.ts` runs `streamText({...})` per wake-turn (~239); currently maps `onStepFinish` → `postAgentEvent({kind:'agent_*'})` with a `[thinking]` hack (~263-287). **Abort is load-bearing:** a wake mid-turn aborts (`runner.ts:256-300,382`); `onAbort` pushes completed-step history and the code explicitly must NOT await `result.response` after abort. Tools: MCP fs/tempo via `@ai-sdk/mcp` (`schemas:'automatic'` → `dynamicTool` → `dynamic-tool` parts); local `Bash`/`Grep` are `tool({inputSchema})` → static `tool-*`; web search/fetch are provider-defined.

**Tasks:**
- Replace the `onStepFinish` mapping: drive the turn by iterating `result.toUIMessageStream({ sendSources: true })`, batching `UIMessageChunk`s to the S1 ingest route; on stream end call `finalizeTurn`.
- **Preserve abort semantics**: iterating the UI stream must terminate cleanly on the wake-abort; keep `onAbort`'s completed-step persistence; do not await `result.response` after abort.
- Delete `agent_narration`/`agent_tool_use`/`[thinking]` emission.

**Verify:** stub model (`simulateReadableStream`) turn → assert persisted `parts_json` has `reasoning`, a `dynamic-tool` (MCP) with input+output, a `tool-*` (Bash), AND a `source-url` (proves `sendSources:true`). **Abort test:** wake mid-turn → stream terminates, completed parts persisted, no throw. Hosted tests pass.
**Exit:** hosted turns persist + stream standard parts (incl. sources), abort-safe.
**Rollback:** revert runner.ts.

---

## S3 — CLI producer → ACP→chunk mapper  *(strongest; ∥ S2)*

**Context brief:** `apps/agent/src/acp/notifications.ts` `NotificationMapper.handle()` maps ACP `sessionUpdate` → `agent_*` (pure, unit-tested); `session.ts` posts via `postLifecycleEvent`. CLI reaches Worker over HTTP only. Mapping (verified):

| ACP update | UIMessageChunk(s) |
|---|---|
| `agent_message_chunk` | `text-start`/`text-delta`/`text-end` |
| `agent_thought_chunk` | `reasoning-start`/`-delta`/`-end` |
| `tool_call` (rawInput, kind) | `tool-input-start` + `tool-input-available` `{toolCallId, toolName, input, dynamic:true}` |
| `tool_call_update` completed | `tool-output-available` `{toolCallId, output: content/rawOutput}` |
| `tool_call_update` failed | `tool-output-error` `{toolCallId, errorText}` |
| `tool_call` kind=fetch/search w/ URL results | `source-url` chunk per URL |
| `plan` entries | (no chunk — Plan is canonical; rendered by `<Task>`) |
| `current_mode_update`, `available_commands_update` | drop |

**Tasks:**
- Rewrite `NotificationMapper` to emit plain `UIMessageChunk` objects (NOT `createUIMessageStream` — CLI needs no stream plumbing) keyed by `toolCallId`.
- `session.ts` batches chunks to the S1 ingest route instead of `postLifecycleEvent({kind:'agent_*'})`; `agent_turn_ended` → `finalizeTurn`.
- Delete the `agent_*` mapping; re-point or drop the `thinking:`/`narration:`/`tool:` logger lines.

**Verify:** unit-test `NotificationMapper` — feed ACP updates, assert emitted chunks; assert one tool round-trips input→output under a single `toolCallId`.
**Exit:** CLI turns persist + stream identical chunks to hosted.
**Rollback:** revert notifications.ts + session.ts.

---

## S4 — Console render via AI Elements  *(default)*

**Context brief:** activity UI `apps/console/components/thread/agent-trails.tsx` (live via `use-thread-events.ts` `applyLiveActivity`) + persisted `/api/threads/[id]/trails` (`trails.ts` `deriveTrails`). Next.js + zustand (`apps/console/store/*`). AI Elements = shadcn copy-in components (we own them; deps: `streamdown`).

**Tasks:**
- `shadcn add` AI Elements `Reasoning`, `Tool`, `Sources`, `Task`, `Message/Response`.
- Live: feed `agent_chunk` SSE frames into `readUIMessageStream` → in-progress `UIMessage` in a zustand store.
- Load: `GET /api/threads/:id/agent-messages` (or fold into thread fetch) → persisted parts.
- Render `parts.map(switch(part.type))`: `text→<Response>`, `reasoning→<Reasoning isStreaming={state==='streaming'}>`, `dynamic-tool` AND `tool-*` → `<Tool>` (input+output+state), `source-url→<Sources>`. Render `<Task>` from the canonical Plan/todos (not a part).
- Replace `agent-trails.tsx` render; keep the panel shell. Feature-flag until verified.

**Verify:** local/Playwright — start a turn: reasoning streams live, a tool shows input then output, refresh keeps them. Console lint + typecheck.
**Exit:** live + reloaded activity render via AI Elements from parts; "feels stuck" gone.
**Rollback:** keep old trail behind the flag.

---

## S5 — Delete `agent_*` taxonomy + old trail  *(default; last, irreversible)*

**Tasks:**
- Remove `AgentNarrationEvent`/`AgentThoughtEvent`/`AgentToolUseEvent`/`AgentToolFailedEvent`/`AgentTodosUpdatedEvent`/`AgentModeChangedEvent` (+ `EventKind` entries) from `events.ts`. Keep `agent_turn_ended` only if a consumer still needs the signal; else replace with turn finalize.
- Delete `trails.ts`/`deriveTrails`, `/api/threads/[id]/trails`, old `agent-trails.tsx` logic, `applyLiveActivity` agent_* cases.
- Grep-verify zero references; fix any `shouldWake`/`shouldDeliverToAgent` refs.

**Verify:** repo-wide grep per deleted kind = 0; full typecheck + lint + tests across contracts/server/worker/agent/console.
**Exit:** one representation remains.
**Rollback:** do only after S4 verified in-app.

---

## Invariants (after EVERY step)
- All touched packages typecheck + lint + tests green.
- Thread domain events (comments, replies, plan edits) untouched and working.
- Agent SSE filtering (wake+cancel only for agents; `agent_chunk` excluded) holds.
- No new CLI runtime dep beyond `ai` types unless justified.

## Anti-patterns (do NOT)
- Hand-mirror the SDK part union in Zod — re-export + `validateUIMessages`.
- Hand-roll the chunk→message accumulator — use `readUIMessageStream`.
- Per-delta Postgres writes — persist terminally; XADD per delta.
- A second SSE transport — reuse the thread stream with an `agent_chunk` frame.
- Coalesce-and-flush-at-end (the "feels stuck" bug) — stream deltas live.
- Fork hosted vs CLI downstream — identical chunks; only the producer edge differs.
- A `data-plan` part — `<Task>` renders from the canonical Plan.

## Resolved (was open)
- MCP tools → `dynamic-tool` (`@ai-sdk/mcp` `dynamicTool` under `schemas:'automatic'`); Bash/Grep → static `tool-*`. Renderer handles both.
- Per-turn `UIMessage` (not one rolling message) — matches the wake/abort turn model.
- Server accumulator = `readUIMessageStream`, not custom.
