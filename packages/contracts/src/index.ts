// Types only — the runtime `validateTempoMessages` lives behind the
// `@tempo/contracts/agent-message` subpath so the CLI never pulls the `ai`
// runtime through this barrel (see agent-message.ts header).
export type {
  AgentChunkFrame,
  TempoUIMessage,
  UIMessage,
  UIMessageChunk,
  UIMessagePart,
} from './agent-message';
// Runtime-safe (no `ai` runtime) — usable from the CLI and the Console client.
export { isEmptyAgentResponse, stripEmptyAgentText } from './agent-text';
export * from './events';
export * from './primitives';
