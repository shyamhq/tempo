import type { UIMessage } from 'ai';

// Providers fill an empty assistant turn's `content` with a "(Empty response:
// {...})" placeholder instead of leaving it blank — Claude Code does it for the
// local CLI, Moonshot/Kimi for the hosted runtime. It isn't agent prose, so we
// treat it as empty everywhere it could surface (live render + persistence).
//
// Lives here (not agent-message.ts) so it stays free of the `ai` runtime: the
// UIMessage import is type-only, so the CLI and Console client can import it.
export function isEmptyAgentResponse(text: string): boolean {
  return text.trimStart().startsWith('(Empty response');
}

export function stripEmptyAgentText<T extends UIMessage>(message: T): T {
  return {
    ...message,
    parts: message.parts.filter((p) => !(p.type === 'text' && isEmptyAgentResponse(p.text))),
  };
}
