import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ForbiddenError } from '@tempo/errors';
import { installTempoDbMock } from '../../_mocks/tempo-db';

// The repos gate in the wake handler (docs/plans/hosted-conversation-before-vm.md):
//   threads.repos non-empty → spawnHosted (provision a VM)
//   threads.repos empty      → runConversationTurn (in-process, fire-and-forget)
// We mock the two runtime entry points so we assert WHICH path the handler picks
// from the thread row, and that the empty path responds without awaiting the
// turn. @tempo/db/client is the shared fake; its select serves the thread row.

const db = installTempoDbMock();

// Stub the auth barrel so loading the handler doesn't drag the real Clerk/db
// auth chain in. `mock.module` is GLOBAL — register the SAME complete surface
// every other ../auth mock uses (authorizeThread + ForbiddenError) so load order
// can't leave a consumer missing an export.
const authorizeThread = mock(async () => 'ws_resolved');
mock.module('../../../src/auth', () => ({ authorizeThread, ForbiddenError }));

const spawnHosted = mock(
  async (_opts: { threadId: string; workspaceId: string }) =>
    ({ status: 'spawned', vm_run_id: 'vmr_1', sandbox_id: 'sbx_1' }) as const,
);
mock.module('../../../src/hosted/supervisor', () => ({ spawnHosted }));

// Resolves on a microtask so a test can assert it was kicked off without the
// handler blocking on it.
const runConversationTurn = mock(async (_threadId: string): Promise<void> => {});
mock.module('../../../src/hosted/conversation', () => ({ runConversationTurn }));

const { wakeHostedHandler } = await import('../../../src/routes/hosted/wake');

type Caller = { kind: string };
function makeReq(id: string, caller: Caller) {
  return { params: { id }, caller } as unknown as Parameters<typeof wakeHostedHandler>[0];
}
function makeRes() {
  const r = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return r;
}
const noop = (() => {}) as unknown as Parameters<typeof wakeHostedHandler>[2];

const THREAD = 'thr_01234567890123456789ABCDEF';

beforeEach(() => {
  db.reset();
  spawnHosted.mockClear();
  runConversationTurn.mockClear();
});

describe('wakeHostedHandler — repos gate', () => {
  test('repos non-empty → spawnHosted, never the in-process turn', async () => {
    db.setRows([{ workspaceId: 'ws_1', agentType: 'hosted', repos: ['acme/api'] }]);
    const res = makeRes();

    await wakeHostedHandler(makeReq(THREAD, { kind: 'browser' }), res as never, noop);

    expect(spawnHosted).toHaveBeenCalledTimes(1);
    expect(spawnHosted.mock.calls[0]?.[0]).toEqual({ threadId: THREAD, workspaceId: 'ws_1' });
    expect(runConversationTurn).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ status: 'spawned' });
  });

  test('repos empty → runConversationTurn (fire-and-forget), never spawnHosted', async () => {
    db.setRows([{ workspaceId: 'ws_1', agentType: 'hosted', repos: [] }]);
    const res = makeRes();

    await wakeHostedHandler(makeReq(THREAD, { kind: 'internal' }), res as never, noop);

    expect(runConversationTurn).toHaveBeenCalledTimes(1);
    expect(runConversationTurn.mock.calls[0]?.[0]).toBe(THREAD);
    expect(spawnHosted).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ status: 'conversation' });
  });

  test('the empty path responds without awaiting the turn', async () => {
    // A turn that never resolves must not hang the HTTP response.
    runConversationTurn.mockImplementationOnce(() => new Promise<void>(() => {}));
    db.setRows([{ workspaceId: 'ws_1', agentType: 'hosted', repos: [] }]);
    const res = makeRes();

    await wakeHostedHandler(makeReq(THREAD, { kind: 'browser' }), res as never, noop);

    expect(res.body).toMatchObject({ status: 'conversation' });
    expect(runConversationTurn).toHaveBeenCalledTimes(1);
  });

  test('a non-hosted thread is rejected before either runtime', async () => {
    db.setRows([{ workspaceId: 'ws_1', agentType: 'local', repos: [] }]);
    const res = makeRes();

    await wakeHostedHandler(makeReq(THREAD, { kind: 'browser' }), res as never, noop);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'agent_type_mismatch' });
    expect(spawnHosted).not.toHaveBeenCalled();
    expect(runConversationTurn).not.toHaveBeenCalled();
  });

  test('a missing thread 404s before either runtime', async () => {
    db.setRows([]);
    const res = makeRes();

    await wakeHostedHandler(makeReq(THREAD, { kind: 'browser' }), res as never, noop);

    expect(res.statusCode).toBe(404);
    expect(spawnHosted).not.toHaveBeenCalled();
    expect(runConversationTurn).not.toHaveBeenCalled();
  });
});
