import { mock } from 'bun:test';

// One shared @tempo/db/client fake for every worker test that exercises a module
// touching the DB directly (the wake-handler select, the provisioner's
// insert/update). Like _mocks/tempo-server.ts, `mock.module` is GLOBAL and bun
// caches the FIRST registration for a specifier — so we register ONCE here and
// every test controls the SAME chainable instances via a typed handle.
//
// drizzle-orm + schema stay REAL; the fake ignores the query-builder args they
// produce. `select().from().where().limit()` resolves to `rows` (set per test);
// `insert().values()` and `update().set().where()` are recorder mocks so a test
// can assert call ordering (e.g. reap-before-INSERT) or the row written.

let rows: Record<string, unknown>[] = [];

// Terminal of the select chain. Every intermediate link returns the same chain
// object; `.limit()` resolves the seeded rows.
const insertValues = mock(async (_row: unknown): Promise<void> => {});
const updateWhere = mock(async (_clause: unknown): Promise<void> => {});

const selectChain: Record<string, unknown> = {};
for (const m of ['from', 'where', 'orderBy']) selectChain[m] = () => selectChain;
selectChain.limit = async () => rows;

const db = {
  select: () => selectChain,
  insert: () => ({ values: insertValues }),
  update: () => ({ set: () => ({ where: updateWhere }) }),
};

let registered = false;

export type DbMock = {
  setRows(value: Record<string, unknown>[]): void;
  reset(): void;
  insertValues: ReturnType<typeof mock>;
  updateWhere: ReturnType<typeof mock>;
};

const handle: DbMock = {
  setRows: (value) => {
    rows = value;
  },
  reset: () => {
    rows = [];
    insertValues.mockClear();
    insertValues.mockImplementation(async () => {});
    updateWhere.mockClear();
    updateWhere.mockImplementation(async () => {});
  },
  insertValues,
  updateWhere,
};

function register(): void {
  if (registered) return;
  registered = true;
  mock.module('@tempo/db/client', () => ({ db }));
}

export function installTempoDbMock(): DbMock {
  register();
  return handle;
}
