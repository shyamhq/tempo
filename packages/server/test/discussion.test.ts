import { describe, expect, test } from 'bun:test';
import { sameRepos } from '../src/discussion';

// sameRepos decides whether a Dev-sent repo list differs from the Thread's
// current list — a difference re-emits `repo_linked` (which wakes the Agent), so
// a false "same" silently drops a real change and a false "different" wakes for
// nothing. The Dev sends the full list each time, so comparison is set-based
// and order-independent.
describe('sameRepos', () => {
  test('empty vs empty is the same', () => {
    expect(sameRepos([], [])).toBe(true);
  });

  test('identical lists are the same', () => {
    expect(sameRepos(['a/b', 'c/d'], ['a/b', 'c/d'])).toBe(true);
  });

  test('reorder of the same repos is the same (order-independent)', () => {
    expect(sameRepos(['a/b', 'c/d'], ['c/d', 'a/b'])).toBe(true);
  });

  test('an added repo is a change', () => {
    expect(sameRepos(['a/b'], ['a/b', 'c/d'])).toBe(false);
  });

  test('a removed repo is a change', () => {
    expect(sameRepos(['a/b', 'c/d'], ['a/b'])).toBe(false);
  });

  test('swapping one repo for another is a change', () => {
    expect(sameRepos(['a/b'], ['c/d'])).toBe(false);
  });

  // Regression: a list with a duplicate must not register as the same as a
  // distinct two-repo list just because the array lengths match.
  test('["x","x"] is NOT the same as ["x","y"] (no length-match false positive)', () => {
    expect(sameRepos(['a/b', 'a/b'], ['a/b', 'c/d'])).toBe(false);
  });

  test('["x","x"] IS the same as ["x"] (duplicates collapse to one set)', () => {
    expect(sameRepos(['a/b', 'a/b'], ['a/b'])).toBe(true);
  });
});
