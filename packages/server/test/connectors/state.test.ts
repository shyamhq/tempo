// The GitHub-connect CSRF defence: a state token an attacker cannot forge.
// These cases ARE the security contract — forge / tamper / expiry must all fail.
import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

// The signer reads CLI_AUTH_SECRET from the env; seed it before importing.
process.env.CLI_AUTH_SECRET ??= 'test-cli-secret-0000000000000000000000';

const { signConnectorState, verifyConnectorState } = await import('../../src/connectors/state');

beforeEach(() => setSystemTime()); // reset to the real clock between cases

describe('connector state signing', () => {
  test('round-trips the workspace id', () => {
    const token = signConnectorState('wsc_abc');
    expect(verifyConnectorState(token)).toBe('wsc_abc');
  });

  test('rejects a tampered workspace id (signature no longer matches)', () => {
    const token = signConnectorState('wsc_victim');
    const forged = token.replace('wsc_victim', 'wsc_attacker');
    expect(verifyConnectorState(forged)).toBeNull();
  });

  test('rejects a tampered signature', () => {
    const [ws, exp] = signConnectorState('wsc_abc').split('.');
    expect(verifyConnectorState(`${ws}.${exp}.deadbeefdeadbeef`)).toBeNull();
  });

  test('rejects a token an attacker hand-crafts without the secret', () => {
    // Knows the workspace id, picks a future expiry, guesses the signature.
    const future = Date.now() + 60_000;
    expect(verifyConnectorState(`wsc_abc.${future}.${'0'.repeat(64)}`)).toBeNull();
  });

  test('rejects malformed tokens', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'wsc_abc.notanumber.sig']) {
      expect(verifyConnectorState(bad)).toBeNull();
    }
  });

  test('rejects an expired token (replay window closed)', () => {
    setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signConnectorState('wsc_abc');
    setSystemTime(new Date('2026-01-01T00:16:00Z')); // > 15-min TTL
    expect(verifyConnectorState(token)).toBeNull();
  });

  test('accepts a token still inside its TTL', () => {
    setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signConnectorState('wsc_abc');
    setSystemTime(new Date('2026-01-01T00:14:00Z')); // < 15-min TTL
    expect(verifyConnectorState(token)).toBe('wsc_abc');
  });
});
