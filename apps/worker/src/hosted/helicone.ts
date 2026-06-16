import { createAnthropic } from '@ai-sdk/anthropic';

// Single point of integration with Helicone. If the proxy key is missing we
// return a plain Anthropic provider with no observability layer. Sessions
// per Helicone docs: one Helicone-Session-Id = one Tempo Thread (we reuse
// the threadId — it's already a unique ULID). Helicone-Session-Path is a
// `/` hierarchy: we use `/turn/<n>` so each Turn shows as a sub-trace under
// the Thread in the Helicone UI.

type ProviderArgs = {
  anthropicKey: string;
  heliconeKey?: string;
  threadId: string;
  workspaceId: string;
  sessionPath: string;
};

export function buildAnthropicProvider(args: ProviderArgs) {
  if (!args.heliconeKey) {
    return createAnthropic({ apiKey: args.anthropicKey });
  }
  return createAnthropic({
    apiKey: args.anthropicKey,
    baseURL: 'https://anthropic.helicone.ai/v1',
    headers: {
      'Helicone-Auth': `Bearer ${args.heliconeKey}`,
      'Helicone-Session-Id': args.threadId,
      'Helicone-Session-Name': 'Tempo Planning Thread',
      'Helicone-Session-Path': args.sessionPath,
      'Helicone-Property-Workspace-Id': args.workspaceId,
    },
  });
}

export function turnPath(turnNumber: number): string {
  return `/turn/${turnNumber}`;
}
