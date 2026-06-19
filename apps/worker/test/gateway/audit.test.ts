import { describe, expect, test } from 'bun:test';
import { summarize } from '../../src/gateway/audit';

// summarize runs on the audit path on every connector call, so it must be a
// total function — capping size and never throwing on awkward input.
describe('summarize', () => {
  test('short strings pass through unchanged', () => {
    expect(summarize('hello')).toBe('hello');
  });

  test('objects are JSON-stringified', () => {
    expect(summarize({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  test('truncates over the cap and marks it with an ellipsis', () => {
    const out = summarize('x'.repeat(600));
    expect(out.length).toBe(501); // 500 chars + the ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  test('respects a custom max', () => {
    expect(summarize('abcdef', 3)).toBe('abc…');
  });

  test('a string exactly at the cap is not truncated', () => {
    const exact = 'x'.repeat(500);
    expect(summarize(exact)).toBe(exact);
    expect(summarize(exact).endsWith('…')).toBe(false);
  });

  test('one character over the cap is truncated', () => {
    const out = summarize('x'.repeat(501));
    expect(out.length).toBe(501); // 500 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  test('null serializes to the string "null" (not the undefined branch)', () => {
    expect(summarize(null)).toBe('null');
  });

  test('undefined becomes the string "undefined" rather than throwing', () => {
    expect(summarize(undefined)).toBe('undefined');
  });

  test('numbers and booleans serialize', () => {
    expect(summarize(123)).toBe('123');
    expect(summarize(true)).toBe('true');
  });

  test('circular references do not throw', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => summarize(o)).not.toThrow();
  });

  test('BigInt (unserializable by JSON) does not throw', () => {
    expect(() => summarize({ n: 10n })).not.toThrow();
  });
});
