import { createHash } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { db } from '@tempo/db/client';
import { threads, userTokens } from '@tempo/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import * as jose from 'jose';
import { customAlphabet } from 'nanoid';
import { env } from '../env';
import { hashToken } from './auth-lookup';

// Module-level Clerk client — JWKS cache is reused across requests.
const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

// base62 alphabet for sk_user_* and rt_* tokens — URL-safe, no ambiguous chars.
const base62 = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32);
// utk_ row ids — 16 chars is enough entropy for a primary key.
const rowId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 16);

// ---------------------------------------------------------------------------
// In-process nonce LRU — prevents replay of a code within its 60 s window.
// Slice 2 may replace with Redis if Worker is horizontally scaled.
// Size 1000 means at most 1000 concurrent PKCE flows before oldest is evicted.
// TTL 5 min covers the 60 s code lifetime with margin for clock drift.

const NONCE_TTL_MS = 5 * 60 * 1000;
const NONCE_MAX = 1000;

type NonceEntry = { seenAt: number };
const nonces = new Map<string, NonceEntry>();

function checkNonce(nonce: string): void {
  const entry = nonces.get(nonce);
  if (entry) {
    throw new InvalidCodeError('nonce already seen (replay)');
  }
  // Map iteration follows insertion order — first key is the oldest entry.
  // O(1) eviction at capacity; the TTL setTimeout handles normal cleanup.
  if (nonces.size >= NONCE_MAX) {
    const oldest = nonces.keys().next().value;
    if (oldest !== undefined) nonces.delete(oldest);
  }
  nonces.set(nonce, { seenAt: Date.now() });
  // Schedule TTL cleanup — fire-and-forget.
  setTimeout(() => nonces.delete(nonce), NONCE_TTL_MS).unref();
}

// ---------------------------------------------------------------------------
// Error types

export class InvalidCodeError extends Error {
  constructor(reason: string) {
    super(`invalid code: ${reason}`);
    this.name = 'InvalidCodeError';
  }
}

export class InvalidRefreshError extends Error {
  constructor(reason: string) {
    super(`invalid refresh token: ${reason}`);
    this.name = 'InvalidRefreshError';
  }
}

// ---------------------------------------------------------------------------
// PKCE helper — S256 only.
// challenge = base64url(sha256(verifier)) per RFC 7636 §4.2.

function computeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// CLI code verification + token lifecycle

// The CLI code is a signed JWT minted by Console's /cli/authorize server
// action using the shared CLI_AUTH_SECRET. Worker verifies signature, nonce,
// expiry, and PKCE challenge.
export async function verifyCliCode(
  code: string,
  codeVerifier: string,
): Promise<{ userId: string; email: string }> {
  const secret = new TextEncoder().encode(env.CLI_AUTH_SECRET);
  let payload: jose.JWTPayload & {
    user_id?: string;
    email?: string;
    nonce?: string;
    challenge?: string;
  };
  try {
    const { payload: p } = await jose.jwtVerify(code, secret);
    payload = p as typeof payload;
  } catch (_e) {
    throw new InvalidCodeError('signature invalid or token expired');
  }

  if (!payload.user_id || !payload.email || !payload.nonce || !payload.challenge) {
    throw new InvalidCodeError('missing required claims');
  }

  // PKCE: verifier must produce the same challenge the Console embedded.
  const expectedChallenge = computeChallenge(codeVerifier);
  if (expectedChallenge !== payload.challenge) {
    throw new InvalidCodeError('code_verifier does not match challenge');
  }

  // Nonce replay guard — also clocks out stale nonces via the TTL.
  checkNonce(payload.nonce);

  return { userId: payload.user_id, email: payload.email };
}

// Mints a fresh sk_user_* + rt_* pair, hashes both, and persists a
// user_tokens row. Access token expires in 30 days; refresh token is
// single-use and has no expiry column — revocation is done by updating
// the row's refresh_token_hash on rotate.
export async function issueUserToken(
  userId: string,
  email: string,
): Promise<{
  token: string;
  refresh_token: string;
  expires_at: Date;
  user_id: string;
  email: string;
}> {
  const plainToken = `sk_user_${base62()}`;
  const plainRefresh = `rt_${base62()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await db.insert(userTokens).values({
    id: `utk_${rowId()}`,
    user_id: userId,
    token_hash: hashToken(plainToken),
    refresh_token_hash: hashToken(plainRefresh),
    expires_at: expiresAt,
  });

  return {
    token: plainToken,
    refresh_token: plainRefresh,
    expires_at: expiresAt,
    user_id: userId,
    email,
  };
}

// Rotate-on-use: verifies the refresh token, atomically revokes the old row
// and inserts the new pair in a single transaction so a crash between revoke
// and insert can't destroy the token pair, and a concurrent double-refresh
// can't issue two valid pairs from the same parent. Throws InvalidRefreshError
// if the token is already revoked or not found.
export async function refreshUserToken(refreshTokenPlaintext: string): Promise<{
  token: string;
  refresh_token: string;
  expires_at: Date;
  user_id: string;
  email: string;
}> {
  const hash = hashToken(refreshTokenPlaintext);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: userTokens.id, user_id: userTokens.user_id })
      .from(userTokens)
      .where(and(eq(userTokens.refresh_token_hash, hash), isNull(userTokens.revoked_at)))
      .limit(1);

    if (!row) throw new InvalidRefreshError('not found or already revoked');

    // Atomically revoke and issue. The matching test for double-refresh is
    // (a) the partial unique index on token_hash + (b) this transaction.
    await tx.update(userTokens).set({ revoked_at: new Date() }).where(eq(userTokens.id, row.id));

    const plainToken = `sk_user_${base62()}`;
    const plainRefresh = `rt_${base62()}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await tx.insert(userTokens).values({
      id: `utk_${rowId()}`,
      user_id: row.user_id,
      token_hash: hashToken(plainToken),
      refresh_token_hash: hashToken(plainRefresh),
      expires_at: expiresAt,
    });

    return { userId: row.user_id, token: plainToken, refresh: plainRefresh, expiresAt };
  });

  // Re-fetch the user's email outside the transaction — Clerk lookup is
  // external I/O and shouldn't hold a DB lock.
  const clerkUser = await clerk.users.getUser(result.userId);
  const email =
    clerkUser.emailAddresses.find(
      (e: { id: string; emailAddress: string }) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? '';

  return {
    token: result.token,
    refresh_token: result.refresh,
    expires_at: result.expiresAt,
    user_id: result.userId,
    email,
  };
}

// ---------------------------------------------------------------------------
// Hosted Session tokens — stateless HS256 JWT, no DB row, no in-memory map.
// Worker mints one at VM-provision time (Task 2.5) and the Sandbox carries it
// as Bearer for every MCP call. ~2-hour expiry covers the longest reasonable
// single Turn; the VM is reaped at ~10 min idle (Task 2.6), so practical
// token lifetime ceiling is one Turn's wall clock — not session length.

const HOSTED_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export async function issueHostedToken(threadId: string): Promise<{
  token: string;
  session_id: string;
  expires_at: Date;
}> {
  const [thread] = await db
    .select({ workspace_id: threads.workspace_id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) throw new Error(`issueHostedToken: thread ${threadId} not found`);

  const sessionId = `hst_${rowId()}`;
  const expiresAt = new Date(Date.now() + HOSTED_TOKEN_TTL_MS);
  const secret = new TextEncoder().encode(env.HOSTED_AUTH_SECRET);
  const jwt = await new jose.SignJWT({
    kind: 'hosted',
    thread_id: threadId,
    workspace_id: thread.workspace_id,
    session_id: sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
  return { token: `sk_hosted_${jwt}`, session_id: sessionId, expires_at: expiresAt };
}
