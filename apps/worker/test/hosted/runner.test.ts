import { describe, expect, test } from 'bun:test';
import {
  hasRepoLinked,
  parseRepos,
  type RepoEntry,
  sanitizeCloneError,
} from '../../src/hosted/clone';

// Unit tests for the two pure helpers extracted from runner.ts.
// No I/O, no env vars, no mocks needed — these are data-in/data-out functions.

const TOKEN = 'ghs_test_token_abc';

// ---------------------------------------------------------------------------
// parseRepos
// ---------------------------------------------------------------------------

describe('parseRepos', () => {
  test('returns empty array when TEMPO_REPOS is absent', () => {
    expect(parseRepos(undefined, TOKEN)).toEqual([]);
  });

  test('returns empty array when ghToken is absent', () => {
    expect(parseRepos('["acme/api"]', undefined)).toEqual([]);
  });

  test('returns empty array when TEMPO_REPOS is an empty JSON array', () => {
    expect(parseRepos('[]', TOKEN)).toEqual([]);
  });

  test('returns empty array on malformed JSON', () => {
    expect(parseRepos('not-json', TOKEN)).toEqual([]);
  });

  test('returns empty array when JSON is not an array', () => {
    expect(parseRepos('"acme/api"', TOKEN)).toEqual([]);
    expect(parseRepos('{"repo":"acme/api"}', TOKEN)).toEqual([]);
  });

  test('skips non-string array elements', () => {
    expect(parseRepos('[42, null, true]', TOKEN)).toEqual([]);
  });

  test('skips strings without a slash separator', () => {
    expect(parseRepos('["noslash"]', TOKEN)).toEqual([]);
  });

  test('skips strings where the slash is first or last character', () => {
    // leading slash: owner is empty string
    expect(parseRepos('["/name"]', TOKEN)).toEqual([]);
    // trailing slash: name is empty string
    expect(parseRepos('["owner/"]', TOKEN)).toEqual([]);
  });

  test('parses a single valid repo into the expected shape', () => {
    const entries = parseRepos('["acme/api"]', TOKEN);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as RepoEntry;
    expect(entry.owner).toBe('acme');
    expect(entry.name).toBe('api');
    expect(entry.dir).toBe('/workspace/acme__api');
    expect(entry.cloneUrl).toBe(`https://x-access-token:${TOKEN}@github.com/acme/api.git`);
  });

  test('parses multiple repos and produces one entry per repo', () => {
    const entries = parseRepos('["acme/api","acme/web"]', TOKEN);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(['api', 'web']);
    expect(entries.map((e) => e.dir)).toEqual(['/workspace/acme__api', '/workspace/acme__web']);
  });

  test('dir is owner-scoped, so same-named repos under different owners do not collide', () => {
    const entries = parseRepos('["acme/api","globex/api"]', TOKEN);
    expect(entries.map((e) => e.dir)).toEqual(['/workspace/acme__api', '/workspace/globex__api']);
    // The two dirs are distinct even though the repo name is identical.
    expect(new Set(entries.map((e) => e.dir)).size).toBe(2);
  });

  test('dir keeps the full owner__name path (not just the last segment)', () => {
    const [entry] = parseRepos('["org/my-service"]', TOKEN) as RepoEntry[];
    expect(entry.dir).toBe('/workspace/org__my-service');
  });

  test('cloneUrl embeds the token verbatim for all repos', () => {
    const entries = parseRepos('["a/b","c/d"]', 'tok123');
    for (const e of entries) {
      expect(e.cloneUrl).toContain('x-access-token:tok123@');
    }
  });

  test('skips invalid items mixed with valid ones', () => {
    const entries = parseRepos('[42, "bad", "acme/api", null, ""]', TOKEN);
    expect(entries).toHaveLength(1);
    expect((entries[0] as RepoEntry).name).toBe('api');
  });
});

// ---------------------------------------------------------------------------
// hasRepoLinked
// ---------------------------------------------------------------------------

// Minimal valid TempoEvent-shaped objects (the kind field is all hasRepoLinked
// needs; the rest of the shape is irrelevant to this predicate).
const evt = (kind: string) => ({ kind, id: 'evt_test', created_at: '2026-06-20T00:00:00.000Z' });

describe('hasRepoLinked', () => {
  test('returns false for an empty events array', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test fixture
    expect(hasRepoLinked([] as any)).toBe(false);
  });

  test('returns false when no repo_linked event is present', () => {
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      hasRepoLinked([evt('comment_added'), evt('discussion_message_posted')] as any),
    ).toBe(false);
  });

  test('returns true when a repo_linked event is present', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test fixture
    expect(hasRepoLinked([evt('repo_linked')] as any)).toBe(true);
  });

  test('returns true when repo_linked is mixed with other event kinds', () => {
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      hasRepoLinked([evt('comment_added'), evt('repo_linked'), evt('reply_added')] as any),
    ).toBe(true);
  });

  test('returns false for agent-only events', () => {
    expect(
      hasRepoLinked(
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        [evt('agent_narration'), evt('agent_turn_ended'), evt('vm_progress')] as any,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeCloneError — the install token must NEVER survive into a reason that
// reaches a log line, an event payload, the DB, or the browser.
// ---------------------------------------------------------------------------

describe('sanitizeCloneError', () => {
  test('strips the token from a credential-bearing clone URL', () => {
    const raw =
      "fatal: could not read from 'https://x-access-token:ghs_SECRET_TOKEN_123@github.com/acme/api.git'";
    const sanitized = sanitizeCloneError(raw);
    expect(sanitized).not.toContain('ghs_SECRET_TOKEN_123');
    expect(sanitized).not.toContain('x-access-token');
    expect(sanitized).toContain('https://github.com/acme/api.git');
  });

  test('strips the token from every occurrence in a multi-repo message', () => {
    const raw =
      'clone https://x-access-token:tokA@github.com/a/b.git and https://x-access-token:tokB@github.com/c/d.git failed';
    const sanitized = sanitizeCloneError(raw);
    expect(sanitized).not.toContain('tokA');
    expect(sanitized).not.toContain('tokB');
    expect(sanitized).not.toContain('x-access-token');
  });

  test('leaves a message with no credential URL untouched', () => {
    const raw = 'fatal: repository not found';
    expect(sanitizeCloneError(raw)).toBe(raw);
  });

  test('strips an empty-token URL (the @ form with no secret)', () => {
    expect(sanitizeCloneError('https://x-access-token:@github.com/a/b.git')).toBe(
      'https://github.com/a/b.git',
    );
  });
});
