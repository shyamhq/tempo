import { beforeEach, describe, expect, test } from 'bun:test';
import { installTempoServerMock } from '../_mocks/tempo-server';
import { sampleCtx, toolJson } from '../_utils';

// Mock @tempo/server first, then load the gateway core so its imports bind to
// the mock (the core is deliberately free of the auth/env/db chain).
const server = installTempoServerMock();
const { runConnectorCall, assertConnectorEnabled } = await import(
  '../../src/gateway/connector-call'
);
const { ConnectorNotEnabledError } = await import('../../src/gateway/errors');

beforeEach(() => server.reset());

describe('assertConnectorEnabled', () => {
  test('resolves when the connector is enabled', async () => {
    server.setEnabled(true);
    await expect(assertConnectorEnabled('ws_test', 'github')).resolves.toBeUndefined();
  });

  test('throws ConnectorNotEnabledError when disabled or missing', async () => {
    server.setEnabled(false);
    await expect(assertConnectorEnabled('ws_test', 'github')).rejects.toBeInstanceOf(
      ConnectorNotEnabledError,
    );
  });
});

describe('runConnectorCall', () => {
  test('enabled: runs the thunk, returns its JSON, audits success with a duration', async () => {
    server.setEnabled(true);
    const result = await runConnectorCall(
      sampleCtx,
      { connectorId: 'github', toolName: 'tempo_github_get_issue', request: { number: 1 } },
      async () => ({ title: 'a real issue' }),
    );

    expect(toolJson(result)).toEqual({ title: 'a real issue' });
    expect(server.auditRows).toHaveLength(1);
    expect(server.auditRows[0]).toMatchObject({
      workspaceId: 'ws_test',
      threadId: 'thr_test',
      connectorId: 'github',
      toolName: 'tempo_github_get_issue',
    });
    expect(typeof server.auditRows[0]?.durationMs).toBe('number');
    // The request + response are summarised into the audit row — a regression
    // that dropped either summary would leave the trail without provenance.
    expect(server.auditRows[0]?.requestSummary).toBe('{"number":1}');
    expect(server.auditRows[0]?.responseSummary).toBe('{"title":"a real issue"}');
  });

  test('a thrown TempoError is reported by its code (not the generic connector_error)', async () => {
    server.setEnabled(true);
    const { ConnectorNotEnabledError } = await import('../../src/gateway/errors');
    const result = await runConnectorCall(
      sampleCtx,
      { connectorId: 'linear', toolName: 'tempo_use_integration', request: {} },
      async () => {
        throw new ConnectorNotEnabledError('linear');
      },
    );
    expect(toolJson(result)).toMatchObject({ error: 'connector_not_enabled' });
  });

  test('disabled: never calls the thunk, returns + audits the gate error', async () => {
    server.setEnabled(false);
    let called = false;
    const result = await runConnectorCall(
      sampleCtx,
      { connectorId: 'github', toolName: 'tempo_github_list_repos', request: {} },
      async () => {
        called = true;
        return { repos: [] };
      },
    );

    expect(called).toBe(false);
    expect(toolJson(result)).toMatchObject({ error: 'connector_not_enabled' });
    expect(server.auditRows).toHaveLength(1);
    expect(String(server.auditRows[0]?.responseSummary)).toContain('connector_not_enabled');
  });

  test('thunk throws: error is captured as data (not rethrown) and audited', async () => {
    server.setEnabled(true);
    const result = await runConnectorCall(
      sampleCtx,
      { connectorId: 'linear', toolName: 'tempo_use_integration', request: { app: 'linear' } },
      async () => {
        throw new Error('upstream 500');
      },
    );

    expect(toolJson(result)).toMatchObject({ error: 'connector_error', message: 'upstream 500' });
    expect(server.auditRows).toHaveLength(1);
  });

  test('a failing audit write does not sink the read', async () => {
    server.setEnabled(true);
    server.failAudit();
    const result = await runConnectorCall(
      sampleCtx,
      { connectorId: 'github', toolName: 'tempo_github_get_issue', request: {} },
      async () => ({ ok: true }),
    );
    expect(toolJson(result)).toEqual({ ok: true });
  });
});
