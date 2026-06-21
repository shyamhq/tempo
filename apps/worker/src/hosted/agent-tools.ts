// Shared agent-turn helpers used by BOTH hosted runtimes — the in-Sandbox
// runner.ts (sink = /agent-stream HTTP) and the in-process conversation.ts (sink
// = ingestChunks directly). The model factory, web tools, and chunk pump live
// here so the two runtimes can't drift apart.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { tavilyExtract, tavilySearch } from '@tavily/ai-sdk';
import type { LanguageModel, ToolSet, UIMessageChunk } from 'ai';

// Kimi (Moonshot's OpenAI-compatible endpoint). One model, hardcoded — switching
// the variant is a one-line edit; switching providers means wrapping this in
// createProviderRegistry, which is a 5-line add the day a second provider lands.
export const MODEL_ID = 'kimi-k2.6';

// Pure factory — runtimes source env differently (Sandbox: process.env; Worker:
// validated env), so it never reads process.env here, staying bundle-safe.
export function buildModel(args: { apiKey: string; baseURL: string }): LanguageModel {
  const moonshot = createOpenAICompatible({
    name: 'moonshot',
    apiKey: args.apiKey,
    baseURL: args.baseURL,
    includeUsage: true,
  });
  return moonshot(MODEL_ID);
}

// Provider-agnostic web search + page fetch via Tavily (auth from TAVILY_API_KEY).
// Replaces Anthropic's server-side web tools, which were locked to Anthropic
// models. `tavilyExtract` is the page reader — clean LLM-ready text, not raw HTML.
export function webTools(): ToolSet {
  return {
    web_search: tavilySearch({ maxResults: 5 }),
    web_fetch: tavilyExtract(),
  };
}

// Drive a turn's UIMessageChunk stream to a sink in small ordered batches (live,
// not buffer-and-flush). Awaiting each batch serializes posts and backpressures
// the model to the sink's pace. The caller owns the turn id and the finalize.
const CHUNK_BATCH = 16;
export async function pumpChunks(
  uiStream: AsyncIterable<UIMessageChunk>,
  ingest: (chunks: UIMessageChunk[]) => Promise<void>,
  // Called as each chunk arrives — lets the caller track stream liveness (the
  // conversation runtime's stall watchdog resets its timer on every chunk).
  onProgress?: () => void,
): Promise<void> {
  let batch: UIMessageChunk[] = [];
  for await (const chunk of uiStream) {
    onProgress?.();
    batch.push(chunk);
    if (batch.length >= CHUNK_BATCH) {
      const full = batch;
      batch = [];
      await ingest(full);
    }
  }
  if (batch.length > 0) await ingest(batch);
}
