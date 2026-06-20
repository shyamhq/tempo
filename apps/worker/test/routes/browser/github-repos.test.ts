import { beforeEach, describe, expect, test } from 'bun:test';
import { installTempoDbMock } from '../../_mocks/tempo-db';
import { installTempoServerMock } from '../../_mocks/tempo-server';

// The repo picker moved from a Console route to this Worker route so the GitHub
// App private key stays on the Worker. The handler is browser-only, resolves the
// workspace from the caller's active Clerk org (via lookupWorkspaceByClerkOrg →
// the mocked db), and degrades to an empty list on any failure. db.setRows feeds
// the workspace lookup; the @tempo/server mock supplies githubListRepos.

const db = installTempoDbMock();
const server = installTempoServerMock();

const { githubReposHandler } = await import('../../../src/routes/browser/github-repos');

type Caller = { kind: string; orgId?: string | null };
function makeReq(caller: Caller) {
  return { caller } as unknown as Parameters<typeof githubReposHandler>[0];
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
const noop = (() => {}) as unknown as Parameters<typeof githubReposHandler>[2];

beforeEach(() => {
  db.reset();
  server.reset();
});

describe('githubReposHandler', () => {
  test('rejects a non-browser caller', async () => {
    const res = makeRes();
    await githubReposHandler(makeReq({ kind: 'cli' }), res as never, noop);
    expect(res.statusCode).toBe(403);
    expect(server.githubListRepos).not.toHaveBeenCalled();
  });

  test('no active org → empty list, never hits GitHub', async () => {
    const res = makeRes();
    await githubReposHandler(makeReq({ kind: 'browser', orgId: null }), res as never, noop);
    expect(res.body).toEqual({ repos: [] });
    expect(server.githubListRepos).not.toHaveBeenCalled();
  });

  test('org with no provisioned workspace → empty list', async () => {
    db.setRows([]); // lookupWorkspaceByClerkOrg finds nothing
    const res = makeRes();
    await githubReposHandler(makeReq({ kind: 'browser', orgId: 'org_x' }), res as never, noop);
    expect(res.body).toEqual({ repos: [] });
    expect(server.githubListRepos).not.toHaveBeenCalled();
  });

  test('resolves workspace from the org and lists its repos', async () => {
    db.setRows([{ id: 'ws_1' }]);
    server.githubListRepos.mockResolvedValueOnce([
      { full_name: 'acme/api', private: true, description: null, default_branch: 'main' },
    ]);
    const res = makeRes();
    await githubReposHandler(makeReq({ kind: 'browser', orgId: 'org_x' }), res as never, noop);
    expect(server.githubListRepos).toHaveBeenCalledWith('ws_1');
    expect(res.body).toEqual({
      repos: [{ full_name: 'acme/api', private: true, description: null, default_branch: 'main' }],
    });
  });

  test('a GitHub error degrades to an empty list', async () => {
    db.setRows([{ id: 'ws_1' }]);
    server.githubListRepos.mockRejectedValueOnce(new Error('github down'));
    const res = makeRes();
    await githubReposHandler(makeReq({ kind: 'browser', orgId: 'org_x' }), res as never, noop);
    expect(res.body).toEqual({ repos: [] });
  });
});
