// Shared agent-turn helpers used by BOTH hosted runtimes — the in-Sandbox
// runner.ts (emits via /agent-events HTTP) and the in-process conversation.ts
// (emits via appendEvent). Keeping the web-tool version logic and the
// onStepFinish → event projection in one place stops the two runtimes from
// drifting apart.

import type { createAnthropic } from '@ai-sdk/anthropic';
import type { StepResult, ToolSet } from 'ai';

// Web search + web fetch — Anthropic-hosted server tools. Version is picked by
// model capability:
//   Sonnet 4.6+ / Opus 4.6+ → 20260209 versions with *dynamic filtering*
//     (Claude writes code to filter results, cutting tokens). Per
//     platform.claude.com/docs/.../web-search-tool and .../web-fetch-tool these
//     are the only models supported by the new versions.
//   Everything else (Haiku) → previous 20250305 / 20250910 versions, no dynamic
//     filtering but broad model support.
export function webToolsForModel(
  anthropic: ReturnType<typeof createAnthropic>,
  modelId: string,
): ToolSet {
  const dynamicFiltering =
    modelId.startsWith('claude-sonnet-') || modelId.startsWith('claude-opus-');
  const webSearch = dynamicFiltering
    ? anthropic.tools.webSearch_20260209({ maxUses: 5 })
    : anthropic.tools.webSearch_20250305({ maxUses: 5 });
  const webFetch = dynamicFiltering
    ? anthropic.tools.webFetch_20260209({ maxUses: 5 })
    : anthropic.tools.webFetch_20250910({ maxUses: 5 });
  return { webSearch, webFetch };
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
