// Agent activity is the AI SDK `UIMessage`/`parts[]` — re-exported, never mirrored
// in Zod. `validateTempoMessages` is kept off the package barrel (index.ts
// re-exports the types only) so the published CLI doesn't gain the `ai` runtime
// through it.

import type { UIMessage, UIMessageChunk } from 'ai';
import { validateUIMessages } from 'ai';

export type { UIMessage, UIMessageChunk, UIMessagePart } from 'ai';

export type TempoUIMessage = UIMessage;

// Ephemeral SSE-only frame (sibling of PresenceSignal/VmSignal): one per chunk on
// a live turn. `turn` is the agent_messages row id. Never persisted, never sent
// to agents.
export type AgentChunkFrame = {
  kind: 'agent_chunk';
  turn: string;
  chunk: UIMessageChunk;
};

// No tools/schemas passed: validates message + part structure, assumes tool
// input/output valid (tool schemas are runtime-specific, not contract-wide).
export async function validateTempoMessages(messages: unknown): Promise<TempoUIMessage[]> {
  return validateUIMessages({ messages });
}
