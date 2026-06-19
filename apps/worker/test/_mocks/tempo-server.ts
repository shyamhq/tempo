import { mock } from 'bun:test';

// One shared @tempo/server mock for every worker gateway test. `mock.module` is
// a global side effect, and bun caches the first registration for a given
// specifier — so re-registering per test file with different shapes makes a
// later file's SUT link against an earlier file's (incomplete) mock. Instead we
// register ONCE here with module-level instances covering the whole surface the
// gateway uses, and every test controls the SAME instances via the returned
// handle. installTempoServerMock() is idempotent: it returns that shared handle.

let enabled = true;
let auditFails = false;
const auditRows: Record<string, unknown>[] = [];

const isConnectorEnabled = mock(async () => enabled);
const insertAuditRow = mock(async (row: Record<string, unknown>) => {
  if (auditFails) throw new Error('audit write failed');
  auditRows.push(row);
});
const getActionPolicy = mock(async (): Promise<'read' | 'write' | 'unknown'> => 'unknown');

let registered = false;

export type ServerMock = {
  setEnabled(value: boolean): void;
  failAudit(value?: boolean): void;
  reset(): void;
  auditRows: Record<string, unknown>[];
  isConnectorEnabled: ReturnType<typeof mock>;
  insertAuditRow: ReturnType<typeof mock>;
  getActionPolicy: ReturnType<typeof mock>;
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
  },
  auditRows,
  isConnectorEnabled,
  insertAuditRow,
  getActionPolicy,
};

export function installTempoServerMock(): ServerMock {
  if (!registered) {
    registered = true;
    mock.module('@tempo/server', () => ({
      isConnectorEnabled,
      insertAuditRow,
      getActionPolicy,
    }));
  }
  return handle;
}
