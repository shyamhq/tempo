// resolveThreadWorkspace is the connector tools' entry gate. Two behaviours
// matter for security/diagnostics: the `internal` server-to-server caller must
// never reach a connector, and a real backend error must NOT be masked as
// "thread_id_required". Mock ../auth + @tempo/server so this stays a unit test.
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ForbiddenError } from '@tempo/errors';
import type { Caller } from '../../src/auth';
import { installTempoServerMock } from '../_mocks/tempo-server';

// Shared @tempo/server mock (provides bumpAgentLastSeen); ../auth is mocked
// locally so we control authorizeThread.
installTempoServerMock();
const authorizeThread = mock(async (_caller: Caller, _threadId: string) => 'ws_resolved');
mock.module('../../src/auth', () => ({ authorizeThread }));

const { resolveThreadWorkspace } = await import('../../src/gateway/resolve');

const cli = { kind: 'cli', userId: 'u1' } satisfies Caller;

beforeEach(() => authorizeThread.mockClear());

describe('resolveThreadWorkspace', () => {
  test('resolves thread + workspace for an authorized caller', async () => {
    const ctx = await resolveThreadWorkspace(cli, 'thr_1');
    expect(ctx).toEqual({ threadId: 'thr_1', workspaceId: 'ws_resolved' });
  });

  test('rejects the internal caller outright — never reaches authorizeThread', async () => {
    const ctx = await resolveThreadWorkspace({ kind: 'internal' } satisfies Caller, 'thr_1');
    expect(ctx).toBeNull();
    expect(authorizeThread).not.toHaveBeenCalled();
  });

  test('returns null when no thread id is supplied', async () => {
    expect(await resolveThreadWorkspace(cli, undefined)).toBeNull();
  });

  test('an authorization denial (ForbiddenError) resolves to null', async () => {
    authorizeThread.mockImplementationOnce(async () => {
      throw new ForbiddenError('not_member');
    });
    expect(await resolveThreadWorkspace(cli, 'thr_1')).toBeNull();
  });

  test('a non-authorization error propagates (not masked as thread_id_required)', async () => {
    authorizeThread.mockImplementationOnce(async () => {
      throw new Error('db connection lost');
    });
    await expect(resolveThreadWorkspace(cli, 'thr_1')).rejects.toThrow('db connection lost');
  });

  test('hosted caller uses its JWT-bound thread id, ignoring the header', async () => {
    const hosted = {
      kind: 'hosted',
      threadId: 'thr_jwt',
      workspaceId: 'ws_jwt',
      sessionId: 's1',
    } satisfies Caller;
    const ctx = await resolveThreadWorkspace(hosted, 'thr_header_should_be_ignored');
    expect(ctx).toEqual({ threadId: 'thr_jwt', workspaceId: 'ws_resolved' });
    expect(authorizeThread).toHaveBeenCalledWith(hosted, 'thr_jwt');
  });
});
