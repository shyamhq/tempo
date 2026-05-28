import { createHash, randomBytes } from 'node:crypto';

export function mintConnectToken(): { token: string; hash: string } {
  // 24 random bytes = 32 url-safe base64 chars (no padding).
  const token = `tmp_${randomBytes(24).toString('base64url')}`;
  return { token, hash: hashConnectToken(token) };
}

export function hashConnectToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
