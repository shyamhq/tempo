// Server logic for hosted-conversation-before-VM (Task T3a):
//   1. postMessage repo-diff — `repos` is Dev-only, enforced server-side exactly
//      as `questions` is Agent-only. Dev set/change/clear updates threads.repos
//      AND emits `repo_linked`; an unchanged set emits nothing; the Agent author
//      never touches repos.
//   2. reapStaleVmRun — the load-bearing invariant: its WHERE carries the
//      freshness predicate (ended_at IS NULL AND heartbeat stale), never a bare
//      `ended_at IS NULL` sweep that would kill a sibling container's live VM.
//
// Both share ONE @tempo/db/client fake. bun's mock.module is GLOBAL across files
// (see apps/worker/test/_mocks/tempo-server.ts), so two files each registering
// '@tempo/db/client' with different shapes would clobber each other — hence one
// file, one fake covering both `transaction` (postMessage) and `update`
// (reap/touch). drizzle-orm + schema are kept REAL; the fake tx/update ignore
// the query-builder args they produce.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// --- captured side effects ---------------------------------------------------
let seededRepos: string[] = [];
let updatedRepos: string[] | null = null; // postMessage's threads.repos UPDATE
let lastSet: Record<string, unknown> | null = null; // reap/touch update().set()
let lastWhere: SQL | null = null; // reap/touch update().where()
const appended: { kind: string; repos?: string[] }[] = [];

// Chainable fake query builder for the postMessage transaction. Terminal
// `.limit()` serves the seeded thread row; nested update().set().where() records
// the repos write.
function makeTx() {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy']) chain[m] = () => chain;
  chain.limit = async () => [{ id: 'thr_1', repos: seededRepos }];
  return {
    select: () => chain,
    update: () => ({
      set: (patch: { repos?: string[] }) => ({
        where: async () => {
          if (patch.repos !== undefined) updatedRepos = patch.repos;
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  };
}

mock.module('@tempo/db/client', () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
    // mailbox reapStaleVmRun / touchVmRun: capture set-payload + where-clause.
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        lastSet = patch;
        return {
          where: async (clause: SQL) => {
            lastWhere = clause;
          },
        };
      },
    }),
  },
}));
mock.module('../src/attachments', () => ({
  verifyAttachmentsInR2: async () => [],
  insertAttachmentRows: async () => undefined,
  listAttachmentsForParents: async () => new Map(),
}));
mock.module('../src/event-log', () => ({
  appendEvent: async (_threadId: string, payload: { kind: string; repos?: string[] }) => {
    appended.push(payload);
  },
}));

const { postMessage } = await import('../src/discussion');
const { reapStaleVmRun, touchVmRun, HOSTED_HEARTBEAT_STALE_MS } = await import('../src/mailbox');

const DEV = 'user_dev';
const AGENT = null;

beforeEach(() => {
  seededRepos = [];
  updatedRepos = null;
  lastSet = null;
  lastWhere = null;
  appended.length = 0;
});

const repoLinked = () => appended.filter((e) => e.kind === 'repo_linked');
const renderWhere = () => new PgDialect().sqlToQuery(lastWhere as SQL).sql;

// --- 1. postMessage repos (Dev-only) -----------------------------------------

describe('postMessage repos (Dev-only)', () => {
  test('Dev sets repos on a Thread with none → updates column + emits repo_linked', async () => {
    seededRepos = [];
    await postMessage('thr_1', DEV, {
      text: 'work on these',
      attachments: [],
      repos: ['acme/api', 'acme/web'],
    });
    expect(updatedRepos).toEqual(['acme/api', 'acme/web']);
    expect(repoLinked()).toEqual([{ kind: 'repo_linked', repos: ['acme/api', 'acme/web'] }]);
  });

  test('Dev changes the repo set → updates + emits the new full list', async () => {
    seededRepos = ['acme/api'];
    await postMessage('thr_1', DEV, { text: 'swap', attachments: [], repos: ['acme/web'] });
    expect(updatedRepos).toEqual(['acme/web']);
    expect(repoLinked()).toEqual([{ kind: 'repo_linked', repos: ['acme/web'] }]);
  });

  test('Dev clears repos → updates column to [] + emits repo_linked with []', async () => {
    seededRepos = ['acme/api'];
    await postMessage('thr_1', DEV, { text: 'no repo', attachments: [], repos: [] });
    expect(updatedRepos).toEqual([]);
    expect(repoLinked()).toEqual([{ kind: 'repo_linked', repos: [] }]);
  });

  test('Dev re-sends the same set (reordered) → no update, no repo_linked', async () => {
    seededRepos = ['acme/api', 'acme/web'];
    await postMessage('thr_1', DEV, {
      text: 'msg',
      attachments: [],
      repos: ['acme/web', 'acme/api'],
    });
    expect(updatedRepos).toBeNull();
    expect(repoLinked()).toEqual([]);
  });

  test('Dev omits repos → no update, no repo_linked', async () => {
    seededRepos = ['acme/api'];
    await postMessage('thr_1', DEV, { text: 'plain', attachments: [] });
    expect(updatedRepos).toBeNull();
    expect(repoLinked()).toEqual([]);
  });

  test('Agent author → body.repos ignored entirely (no update, no repo_linked)', async () => {
    seededRepos = [];
    await postMessage('thr_1', AGENT, {
      text: 'agent reply',
      attachments: [],
      repos: ['agent/wants', 'this/repo'],
    });
    expect(updatedRepos).toBeNull();
    expect(repoLinked()).toEqual([]);
  });
});

// --- 2. heartbeat-aware liveness ---------------------------------------------

describe('HOSTED_HEARTBEAT_STALE_MS', () => {
  test('is ~2x the 10-min E2B idle window (20 min)', () => {
    expect(HOSTED_HEARTBEAT_STALE_MS).toBe(20 * 60 * 1000);
  });
});

describe('reapStaleVmRun', () => {
  test("closes the row with ended_at + exit_reason 'orphaned_stale'", async () => {
    await reapStaleVmRun('thr_1');
    expect(lastSet).toMatchObject({ exit_reason: 'orphaned_stale' });
    expect(lastSet).toHaveProperty('ended_at');
  });

  test('WHERE carries the freshness predicate — NOT a bare ended_at IS NULL sweep', async () => {
    await reapStaleVmRun('thr_1');
    const sql = renderWhere();
    // The corpse guard: open row AND a lapsed heartbeat. Both must be present —
    // dropping the staleness half re-creates the sibling-killing boot sweep.
    expect(sql).toContain('"ended_at" is null');
    expect(sql).toContain('last_seen_at');
    expect(sql).toContain('started_at'); // coalesce fallback for a null heartbeat
    expect(sql).toMatch(/<\s*now\(\)/); // stale = older than now() - threshold
    expect(sql).toContain(' and '); // an AND of the open-row and staleness tests
  });
});

describe('touchVmRun', () => {
  test('bumps last_seen_at on the open row', async () => {
    await touchVmRun('thr_1');
    expect(lastSet).toHaveProperty('last_seen_at');
    const sql = renderWhere();
    expect(sql).toContain('"ended_at" is null');
    expect(sql).toContain('"thread_id"');
  });
});
