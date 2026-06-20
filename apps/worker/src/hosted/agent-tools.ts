// Shared agent-turn helpers used by BOTH hosted runtimes — the in-Sandbox
// runner.ts (emits via /agent-events HTTP) and the in-process conversation.ts
// (emits via appendEvent). Keeping the model factory, the web tools, and the
// onStepFinish → event projection in one place stops the two runtimes from
// drifting apart.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { tavilyExtract, tavilySearch } from '@tavily/ai-sdk';
import type { LanguageModel, StepResult, ToolSet } from 'ai';

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

// The agent events one completed step projects to. Same shape on both runtimes;
// the only difference is the sink (HTTP POST vs direct appendEvent), supplied as
// the `emit` callback.
export type StepEvent =
  | { kind: 'agent_narration'; text: string }
  | { kind: 'agent_tool_use'; tool: string; summary: string };

// Project one completed streamText step into agent events, in order: reasoning
// (extended-thinking) → narration text → one tool_use per tool call. `reasoning`
// and `toolCalls` come typed off StepResult, so no casts are needed.
export async function emitStepEvents(
  step: Pick<StepResult<ToolSet>, 'text' | 'reasoningText' | 'toolCalls'>,
  emit: (event: StepEvent) => Promise<void> | void,
): Promise<void> {
  if (step.reasoningText) {
    await emit({ kind: 'agent_narration', text: `[thinking] ${step.reasoningText}` });
  }
  if (step.text) {
    await emit({ kind: 'agent_narration', text: step.text });
  }
  for (const call of step.toolCalls) {
    const summary = JSON.stringify(call.input ?? {}).slice(0, 200);
    await emit({ kind: 'agent_tool_use', tool: call.toolName, summary });
  }
}
