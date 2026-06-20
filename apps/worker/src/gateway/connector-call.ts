import { TempoError } from '@tempo/errors';
import { assertConnectorEnabled, insertAuditRow } from '@tempo/server';
import { summarize } from './audit';

// The governance core every connector tool flows through: allowlist gate →
// execute → audit. Deliberately free of the auth / env / db-client import chain
// (it talks to the DB only through @tempo/server) so it unit-tests with
// @tempo/server mocked. Thread + workspace are already resolved upstream
// (resolve.ts) — this layer owns the gate and the provenance record.

export type ConnectorCallContext = { threadId: string; workspaceId: string };

// MCP tool result shape (a tool returns text content). Kept local so the
// gateway doesn't reach into the mcp/ tree.
type ToolResult = { content: { type: 'text'; text: string }[] };

function describeError(err: unknown): { error: string; message: string } {
  if (err instanceof TempoError) return { error: err.code, message: err.message };
  if (err instanceof Error) return { error: 'connector_error', message: err.message };
  return { error: 'connector_error', message: String(err) };
}

// Runs one connector read end-to-end. Asserts the allowlist, times the call,
// executes the thunk, and appends exactly one audit row — on success OR failure,
// so a disabled connector and a rejected write both leave a trail. Connector
// errors are caught and returned as the tool result (never thrown), so a flaky
// upstream surfaces to the Agent as data, not an MCP transport error. The audit
// write itself is best-effort: a logging failure must not sink the read.
export async function runConnectorCall(
  ctx: ConnectorCallContext,
  spec: { connectorId: string; toolName: string; request: unknown },
  fn: (ctx: ConnectorCallContext) => Promise<unknown>,
): Promise<ToolResult> {
  const startedAt = performance.now();
  let response: unknown;
  try {
    await assertConnectorEnabled(ctx.workspaceId, spec.connectorId);
    response = await fn(ctx);
  } catch (err) {
    response = describeError(err);
  }
  const durationMs = Math.round(performance.now() - startedAt);

  await insertAuditRow({
    workspaceId: ctx.workspaceId,
    threadId: ctx.threadId,
    connectorId: spec.connectorId,
    toolName: spec.toolName,
    requestSummary: summarize(spec.request),
    responseSummary: summarize(response),
    durationMs,
  }).catch(() => {});

  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
