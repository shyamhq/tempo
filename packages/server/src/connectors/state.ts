import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, short-lived state for the GitHub App install round-trip. The plain
// workspace id was forgeable: an attacker who learned a victim's workspace id
// could craft a callback (with their own installation_id) and have it accepted
// for the victim's workspace. A signature only we can produce closes that — the
// attacker can't mint a valid state without CLI_AUTH_SECRET. Expiry adds replay
// protection. The key is shared with the CLI flow but domain-separated below, so
// a state token can never be replayed as a CLI token or vice versa.

const DOMAIN = 'tempo-connector-state:v1';
const TTL_MS = 15 * 60 * 1000;

function secret(): string {
  const s = process.env.CLI_AUTH_SECRET;
  if (!s) throw new Error('CLI_AUTH_SECRET is not configured');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(`${DOMAIN}:${payload}`).digest('hex');
}

export function signConnectorState(workspaceId: string): string {
  const payload = `${workspaceId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the workspace id iff the token is well-formed, unexpired, and its
// signature verifies (constant-time); null otherwise.
export function verifyConnectorState(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [workspaceId, expiryRaw, sig] = parts;
  if (!workspaceId || !expiryRaw || !sig) return null;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;

  const expected = sign(`${workspaceId}.${expiryRaw}`);
  const got = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;

  return workspaceId;
}
