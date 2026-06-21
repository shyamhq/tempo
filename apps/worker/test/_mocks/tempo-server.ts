import { mock } from 'bun:test';
import { TempoError } from '@tempo/errors';

// Stand-in for @tempo/server's ConnectorNotEnabledError. We can't import the
// real class here (it lives in the module we're mocking), so we reconstruct its
// public contract (code + status). This class is ALSO the mock's
// `ConnectorNotEnabledError` export, so `instanceof` checks in tests that import
// it from @tempo/server match what the mocked gate throws.
class ConnectorNotEnabledError extends TempoError {
  constructor(connectorId: string) {
    super('connector_not_enabled', 403, `connector "${connectorId}" is not enabled`);
  }
}

// One shared @tempo/server mock for every worker test. `mock.module` is a global
// side effect, and bun caches the FIRST registration for a given specifier — so
// re-registering per test file with different shapes makes a later file's SUT
// link against an earlier file's (incomplete) mock. We therefore register ONCE
// here with module-level instances covering the whole surface the worker tests
// use (gateway connector calls + the in-process conversation runtime), and every
// test controls the SAME instances via a typed handle. install*() is idempotent:
// it returns that shared handle.

// --- Gateway surface -------------------------------------------------------
let enabled = true;
let auditFails = false;
const auditRows: Record<string, unknown>[] = [];

const isConnectorEnabled = mock(async () => enabled);
const insertAuditRow = mock(async (row: Record<string, unknown>) => {
  if (auditFails) throw new Error('audit write failed');
  auditRows.push(row);
});
const getActionPolicy = mock(async (): Promise<'read' | 'write' | 'unknown'> => 'unknown');

// --- Conversation runtime surface -----------------------------------------
// The in-process turn's lock + re-drain coordination plus the @tempo/server fns
// it links against. Defaults are no-op/empty so a test only overrides what it
// asserts on. `acquireTurnLock` defaults to acquired; `getEventsSinceLastTurn`
// defaults to a single drain then empty (overridden per test).
const acquireTurnLock = mock(async (_threadId: string, _nonce: string): Promise<boolean> => true);
const releaseTurnLock = mock(async (_threadId: string, _nonce: string): Promise<void> => {});
const getEventsSinceLastTurn = mock(async (_threadId: string): Promise<unknown[]> => []);
const getThread = mock(
  async (_threadId: string): Promise<{ workspace_id: string } | null> => ({
    workspace_id: 'ws_test',
  }),
);
const getTurnHydration = mock(async (_threadId: string): Promise<unknown> => null);
const appendEvent = mock(async (_threadId: string, _payload: unknown): Promise<void> => {});
const ingestChunks = mock(async (): Promise<void> => {});
const finalizeTurn = mock(async (): Promise<void> => {});
const postMessage = mock(async (): Promise<{ id: string }> => ({ id: 'msg_test' }));
const getPlanBlocks = mock(async (): Promise<unknown> => ({ blocks: [] }));
const updatePlan = mock(async (): Promise<unknown> => ({ ids: [] }));
const addBlocks = mock(async (): Promise<unknown> => ({ ids: [] }));
const updateBlock = mock(async (): Promise<void> => {});
const deleteBlock = mock(async (): Promise<void> => {});
// Faithful to the real gate: throws when disabled so runConnectorCall's
// disabled path surfaces `connector_not_enabled` unchanged.
const assertConnectorEnabled = mock(async (_workspaceId: string, connectorId: string) => {
  if (!enabled) throw new ConnectorNotEnabledError(connectorId);
});
const githubListRepos = mock(async (): Promise<unknown[]> => []);

// --- VM provisioning surface ----------------------------------------------
// The @tempo/server fns the supervisor + provisioner link against. Recorders so
// the provision test can assert reap-before-INSERT ordering and the supervisor
// test can assert the install-token mint.
let vmRunCounter = 0;
const newVmRunId = mock(() => `vmr_test_${++vmRunCounter}`);
const reapStaleVmRun = mock(async (_threadId: string): Promise<void> => {});
const touchVmRun = mock(async (_threadId: string): Promise<void> => {});
const endVmRunsForThread = mock(async (_threadId: string, _reason: string): Promise<void> => {});
const failVmRun = mock(async (_threadId: string, _reason: string): Promise<void> => {});
const publishVmSignal = mock(async (_threadId: string, _vm: unknown): Promise<void> => {});
const getInstallationToken = mock(
  async (_workspaceId: string): Promise<{ token: string; expiresAt: string }> => ({
    token: 'ghs_test_token',
    expiresAt: '2099-01-01T00:00:00Z',
  }),
);

let registered = false;

export type ServerMock = {
  setEnabled(value: boolean): void;
  failAudit(value?: boolean): void;
  reset(): void;
  auditRows: Record<string, unknown>[];
  isConnectorEnabled: ReturnType<typeof mock>;
  insertAuditRow: ReturnType<typeof mock>;
  getActionPolicy: ReturnType<typeof mock>;
  githubListRepos: ReturnType<typeof mock>;
  // Conversation runtime handles.
  acquireTurnLock: ReturnType<typeof mock>;
  releaseTurnLock: ReturnType<typeof mock>;
  getEventsSinceLastTurn: ReturnType<typeof mock>;
  getThread: ReturnType<typeof mock>;
  getTurnHydration: ReturnType<typeof mock>;
  appendEvent: ReturnType<typeof mock>;
  ingestChunks: ReturnType<typeof mock>;
  finalizeTurn: ReturnType<typeof mock>;
  // VM provisioning handles.
  newVmRunId: ReturnType<typeof mock>;
  reapStaleVmRun: ReturnType<typeof mock>;
  touchVmRun: ReturnType<typeof mock>;
  endVmRunsForThread: ReturnType<typeof mock>;
  failVmRun: ReturnType<typeof mock>;
  publishVmSignal: ReturnType<typeof mock>;
  getInstallationToken: ReturnType<typeof mock>;
};

const handle: ServerMock = {
  setEnabled: (value) => {
    enabled = value;
  },
  failAudit: (value = true) => {
    auditFails = value;
  },
  reset: () => {
    enabled = true;
    auditFails = false;
    auditRows.length = 0;
    isConnectorEnabled.mockClear();
    insertAuditRow.mockClear();
    getActionPolicy.mockReset();
    for (const m of [
      acquireTurnLock,
      releaseTurnLock,
      getEventsSinceLastTurn,
      getThread,
      getTurnHydration,
      appendEvent,
      ingestChunks,
      finalizeTurn,
      postMessage,
      getPlanBlocks,
      updatePlan,
      addBlocks,
      updateBlock,
      deleteBlock,
      assertConnectorEnabled,
      githubListRepos,
      newVmRunId,
      reapStaleVmRun,
      touchVmRun,
      endVmRunsForThread,
      failVmRun,
      publishVmSignal,
      getInstallationToken,
    ]) {
      m.mockClear();
    }
  },
  auditRows,
  isConnectorEnabled,
  insertAuditRow,
  getActionPolicy,
  githubListRepos,
  acquireTurnLock,
  releaseTurnLock,
  getEventsSinceLastTurn,
  getThread,
  getTurnHydration,
  appendEvent,
  ingestChunks,
  finalizeTurn,
  newVmRunId,
  reapStaleVmRun,
  touchVmRun,
  endVmRunsForThread,
  failVmRun,
  publishVmSignal,
  getInstallationToken,
};

function register(): void {
  if (registered) return;
  registered = true;
  mock.module('@tempo/server', () => ({
    isConnectorEnabled,
    insertAuditRow,
    getActionPolicy,
    acquireTurnLock,
    releaseTurnLock,
    getEventsSinceLastTurn,
    getThread,
    getTurnHydration,
    appendEvent,
    ingestChunks,
    finalizeTurn,
    postMessage,
    getPlanBlocks,
    updatePlan,
    addBlocks,
    updateBlock,
    deleteBlock,
    assertConnectorEnabled,
    ConnectorNotEnabledError,
    githubListRepos,
    newVmRunId,
    reapStaleVmRun,
    touchVmRun,
    endVmRunsForThread,
    failVmRun,
    publishVmSignal,
    getInstallationToken,
  }));
}

export function installTempoServerMock(): ServerMock {
  register();
  return handle;
}
