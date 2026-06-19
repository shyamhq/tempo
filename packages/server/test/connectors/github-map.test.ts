import { describe, expect, test } from 'bun:test';
import {
  mapIssue,
  mapPullRequest,
  mapRepo,
  mapSearchResult,
} from '../../src/connectors/github-map';

// Representative raw GitHub issue payload — contains the full set of fields
// the mapper touches. Other fields are deliberately absent to prove the mapper
// doesn't break on sparse payloads.
const rawIssue = {
  number: 42,
  title: 'Fix memory leak in event loop',
  state: 'open',
  html_url: 'https://github.com/acme/tempo/issues/42',
  labels: [{ name: 'bug' }, { name: 'priority: high' }],
  assignees: [{ login: 'alice' }, { login: 'bob' }],
  user: { login: 'carol' },
  body: 'Short description.',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
} as const;

describe('mapIssue', () => {
  test('projects planner-relevant fields from a full payload', () => {
    const result = mapIssue(rawIssue);
    expect(result).toEqual({
      number: 42,
      title: 'Fix memory leak in event loop',
      state: 'open',
      html_url: 'https://github.com/acme/tempo/issues/42',
      labels: [{ name: 'bug' }, { name: 'priority: high' }],
      assignees: [{ login: 'alice' }, { login: 'bob' }],
      user: { login: 'carol' },
      body: 'Short description.',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    });
  });

  test('handles null/absent optional fields gracefully', () => {
    const sparse = {
      number: 1,
      title: 'Sparse',
      state: 'closed',
      html_url: 'https://github.com/acme/repo/issues/1',
      body: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    const result = mapIssue(sparse);
    expect(result.labels).toEqual([]);
    expect(result.assignees).toEqual([]);
    expect(result.user).toBeNull();
    expect(result.body).toBeNull();
  });

  test('truncates body text that exceeds 2000 characters', () => {
    const longBody = 'x'.repeat(3_000);
    const result = mapIssue({ ...rawIssue, body: longBody });
    // Truncated output must be no longer than limit + ellipsis character.
    expect(result.body).not.toBeNull();
    expect((result.body ?? '').length).toBeLessThanOrEqual(2_001);
    expect(result.body).toMatch(/…$/);
  });

  test('strips label entries that have no name', () => {
    const result = mapIssue({
      ...rawIssue,
      labels: [{ name: 'valid' }, { name: null }, {}],
    });
    expect(result.labels).toEqual([{ name: 'valid' }]);
  });

  test('maps bare string labels (real Octokit search-result shape) and drops empty ones', () => {
    // Octokit returns labels as bare strings in some search results — the branch
    // the source explicitly handles. Pin it so a refactor can't silently drop it.
    const result = mapIssue({ ...rawIssue, labels: ['bug', '', 'priority: high'] });
    expect(result.labels).toEqual([{ name: 'bug' }, { name: 'priority: high' }]);
  });

  test('maps a mix of string and object labels', () => {
    const result = mapIssue({ ...rawIssue, labels: ['bug', { name: 'wontfix' }, { name: null }] });
    expect(result.labels).toEqual([{ name: 'bug' }, { name: 'wontfix' }]);
  });

  test('body of exactly the limit is kept; one over is truncated with an ellipsis', () => {
    const exact = 'x'.repeat(2_000);
    expect(mapIssue({ ...rawIssue, body: exact }).body).toBe(exact);
    const over = mapIssue({ ...rawIssue, body: 'x'.repeat(2_001) }).body ?? '';
    expect(over.length).toBe(2_001); // 2000 chars + the ellipsis
    expect(over.endsWith('…')).toBe(true);
  });
});

describe('mapPullRequest', () => {
  const rawPr = {
    ...rawIssue,
    draft: false,
    merged: true,
    mergeable_state: 'clean',
    base: { ref: 'main' },
    head: { ref: 'fix/memory-leak' },
  };

  test('includes all issue fields plus PR-specific fields', () => {
    const result = mapPullRequest(rawPr);
    expect(result.number).toBe(42);
    expect(result.draft).toBe(false);
    expect(result.merged).toBe(true);
    expect(result.mergeable_state).toBe('clean');
    expect(result.base_ref).toBe('main');
    expect(result.head_ref).toBe('fix/memory-leak');
  });

  test('defaults draft and merged to false when absent', () => {
    const result = mapPullRequest({
      ...rawPr,
      draft: null,
      merged: null,
      mergeable_state: null,
    });
    expect(result.draft).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.mergeable_state).toBeNull();
  });
});

describe('mapRepo', () => {
  const rawRepo = {
    full_name: 'acme/tempo',
    private: true,
    html_url: 'https://github.com/acme/tempo',
    description: 'Planning tool for engineers',
    default_branch: 'main',
  };

  test('projects all repo fields', () => {
    expect(mapRepo(rawRepo)).toEqual({
      full_name: 'acme/tempo',
      private: true,
      html_url: 'https://github.com/acme/tempo',
      description: 'Planning tool for engineers',
      default_branch: 'main',
    });
  });

  test('coerces absent description to null', () => {
    const result = mapRepo({ ...rawRepo, description: undefined });
    expect(result.description).toBeNull();
  });
});

describe('mapSearchResult', () => {
  test('maps total_count and projects each item', () => {
    const result = mapSearchResult({
      total_count: 2,
      items: [rawIssue, { ...rawIssue, number: 43, title: 'Second issue' }],
    });
    expect(result.total_count).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.number).toBe(42);
    expect(result.items[1]?.number).toBe(43);
  });

  test('returns an empty items array when search yields no results', () => {
    const result = mapSearchResult({ total_count: 0, items: [] });
    expect(result.total_count).toBe(0);
    expect(result.items).toEqual([]);
  });
});
