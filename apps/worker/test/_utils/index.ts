// Shared test helpers. Keep this small — fixtures and tiny accessors only.
import type { ConnectorCallContext } from '../../src/gateway/connector-call';

export const sampleCtx: ConnectorCallContext = {
  threadId: 'thr_test',
  workspaceId: 'ws_test',
};

// Parse the JSON a connector tool result carries in its single text block.
export function toolJson(result: { content: { type: string; text: string }[] }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null');
}
