# Plan: migrate the hosted agent off Anthropic to Kimi (provider-agnostic)

## Problem / goal

The hosted agent runs on Anthropic (Haiku) — expensive, and weak at the
"reply via a tool, not plain text" discipline. Move to **Kimi K2.6** (cheaper,
stronger tool-follower) via the OpenAI-compatible provider, and strip the
Anthropic-specific coupling so the model is a config value.

## Verified facts (from code + library docs, June 2026)

- **Two live runtimes, both Anthropic-welded:**
  - `hosted/conversation.ts` — in-process, repo-less threads.
  - `hosted/runner.ts` — E2B sandbox (bundled to `runner.js`), repo threads.
  - Routed by `routes/hosted/wake.ts` on `threads.repos.length`.
- **Shared factories** (change once, both benefit):
  - `hosted/helicone.ts` → `buildAnthropicProvider` (the only `createAnthropic`).
  - `hosted/agent-tools.ts` → `webToolsForModel` (Anthropic server web tools) +
    `emitStepEvents` (provider-agnostic — keep).
- Both runtimes rebuild the provider **per turn** purely for Helicone session-path
  tagging. Dropping Helicone lets the model be built **once**.
- Libraries (versions peer-match `ai@^6`):
  - `@ai-sdk/openai-compatible@2.x`: `createOpenAICompatible({ name, baseURL,
    apiKey, includeUsage })` → `provider(modelId)`; supports streaming + tools.
  - `@tavily/ai-sdk@0.5.0` (peer `ai ^5||^6`): exports `tavilySearch(config)` +
    `tavilyExtract()` as AI-SDK-native tools; auth via `TAVILY_API_KEY`.
  - `createProviderRegistry`/`customProvider` exist in `ai` — **not used** (one
    provider; see Decision C).
- Moonshot: base `https://api.moonshot.ai/v1`, current model `kimi-k2.6`
  (the `kimi-k2-*-preview` ids were discontinued 2026-05-25).
- Reliability: direct Moonshot `kimi-k2.6` emits proper `tool_calls` (the
  JSON-as-text failure was the old `kimi-k2` via OpenRouter, not this path).
- Tests don't inspect model/provider/tools (`conversation.test.ts` stubs
  `streamText`; `runner.test.ts` only tests clone helpers) — nothing breaks, but
  no coverage either.

## Decisions (locked)

- **A. Direct Moonshot** via `@ai-sdk/openai-compatible`. Helicone dropped for the
  cutover (re-add later via an OpenAI-compatible passthrough or a gateway if the
  observability is missed).
- **B. Tavily** for search + fetch (`@tavily/ai-sdk`) — one dep, two ready tools,
  zero hand-rolling. `tavilyExtract` is the web-page reader (clean LLM-ready text,
  not curl-soup).
- **C. No provider registry.** One provider → a bare `createOpenAICompatible` +
  `provider(modelId)` is the minimal shape. A registry is a 5-line add *when* a
  second provider actually arrives — not before.

## The change — delete first, redo what survives

### Delete
- `hosted/helicone.ts` (whole file) + the per-turn provider rebuild in both
  runtimes. Provider is built once now.
- `webToolsForModel` (Anthropic server tools) and its `@ai-sdk/anthropic` type dep.
- `providerOptions.anthropic.cacheControl` in `runner.ts` + `conversation.ts`
  (Kimi auto-caches by prefix).
- The dollar cost math in `runner.ts` (Haiku-specific). Keep token counts.
- `@ai-sdk/anthropic` from `apps/worker/package.json` + `e2b/hosted-package.json`
  (nothing imports it after this).

### Redo (canonical library mechanisms — no hand-rolled glue)
- **New `hosted/model.ts`** (replaces `helicone.ts`): build the shared model once.
  ```ts
  import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
  const moonshot = createOpenAICompatible({
    name: 'moonshot',
    baseURL: req('MOONSHOT_BASE_URL'),
    apiKey: req('MOONSHOT_API_KEY'),
    includeUsage: true,
  });
  export const modelId = process.env.HOSTED_AGENT_MODEL ?? 'kimi-k2.6';
  export const model = moonshot(modelId);
  // Upgrade path: wrap in createProviderRegistry when a 2nd provider lands.
  ```
- **`agent-tools.ts`**: replace `webToolsForModel(anthropic, id)` with a
  provider-free `webTools()`:
  ```ts
  import { tavilySearch, tavilyExtract } from '@tavily/ai-sdk';
  export function webTools(): ToolSet {
    return { web_search: tavilySearch({ maxResults: 5 }), web_fetch: tavilyExtract() };
  }
  ```
  `emitStepEvents` unchanged.
- **`runner.ts` / `conversation.ts`**: import `{ model }` + `webTools`;
  `streamText({ model, tools: { ...tools, ...webTools() }, ... })`; drop the
  `anthropic` param threading, the per-turn provider, and the cache option.

### Config / infra
- `src/env.ts`: drop `ANTHROPIC_API_KEY` (`sk-ant-` validator) + `HELICONE_API_KEY`;
  add `MOONSHOT_API_KEY` (min 1), `MOONSHOT_BASE_URL` (url, default
  `https://api.moonshot.ai/v1`), `TAVILY_API_KEY` (min 1).
- `src/vm/provision.ts`: inject `MOONSHOT_API_KEY` / `MOONSHOT_BASE_URL` /
  `TAVILY_API_KEY` into the sandbox; drop `ANTHROPIC_API_KEY` + `HELICONE_API_KEY`.
  Egress allowlist: drop `api.anthropic.com` + `anthropic.helicone.ai`, add
  `api.moonshot.ai` + `api.tavily.com`.
- `e2b/hosted-package.json`: add `@ai-sdk/openai-compatible`, `@tavily/ai-sdk`;
  remove `@ai-sdk/anthropic`.
- `scripts/build-hosted-runner.ts`: add `--external='@tavily/*'` (matches the
  existing `@ai-sdk/*` external pattern; installed in the sandbox, not bundled).
- `apps/worker/package.json`: add `@ai-sdk/openai-compatible`, `@tavily/ai-sdk`;
  remove `@ai-sdk/anthropic`.

### Layer placement
- `hosted/model.ts` — provider/model (replaces `helicone.ts`).
- `hosted/agent-tools.ts` — `webTools()` + `emitStepEvents`.
- `runner.ts`/`conversation.ts` — turn loops, simplified (build-once).
- `env.ts`/`provision.ts`/`e2b`/build script — config + infra.

## API keys (Dev is procuring)
- `MOONSHOT_API_KEY` + `MOONSHOT_BASE_URL` (`https://api.moonshot.ai/v1`).
- `TAVILY_API_KEY` (free tier 1k/mo).
- Keep `ANTHROPIC_API_KEY` in the secret store during cutover (rollback via revert).

## Verification (the make-or-break gate)
1. **Tool-calling — blocking.** One real turn: Kimi must emit proper `tool_calls`
   and post via `tempo_post_discussion_message` (not JSON-as-text).
2. Web search + `tavilyExtract` fire and return on a Kimi turn.
3. `typecheck` + `lint` clean; existing tests still pass.

## Alternatives considered
- Anthropic-search-for-Kimi: impossible (server tool, provider-locked) + most
  expensive search. Rejected.
- LiteLLM proxy: a Python sidecar for an interface the AI SDK already provides;
  buggy Anthropic-search→Kimi path. Rejected.
- Provider registry now: speculative for one provider. Deferred to when a second
  provider lands.

## Uncertainties (verify at implementation)
- AI SDK v6 `totalUsage` field names for cached tokens on openai-compatible
  (log `inputTokens`/`outputTokens`/`cachedInputTokens` with `?? 0`).
- Kimi K2.6 multi-turn tool-call history replay with thinking (known minor
  `reasoning_content` quirk; we only project it to narration, so non-blocking).
- Exact Tavily API egress host (`api.tavily.com`) — confirm at impl.

## Deletion test
Deleting this migration in 6 months: the agent would still be welded to one paid
provider, web tools Anthropic-locked, provider rebuilt every turn. The change is
net-negative lines and makes the model a config string. Passes.

## Rollback
Revert the commit (one provider, no registry → no env-flip rollback). Anthropic
key stays in the secret store so a revert boots straight back.
