'use server';

import { randomBytes } from 'node:crypto';
import { auth as clerkAuth, clerkClient } from '@clerk/nextjs/server';
import { SignJWT } from 'jose';
import { env } from '@/env';

// Mint a short-lived OAuth code (signed JWT) for the CLI exchange flow.
// The code carries the claims Worker needs to verify in /api/cli/exchange:
//   user_id, email, challenge (PKCE S256), nonce (replay guard), exp (60 s).
//
// Returns the redirect URL the browser sends the code to — a loopback
// localhost server the CLI has started on the specified port.
export async function mintCliCode(params: {
  state: string;
  port: number;
  challenge: string;
}): Promise<{ redirectUrl: string }> {
  const { userId } = await clerkAuth();
  if (!userId) {
    // Should not happen — the page is behind Clerk middleware.
    throw new Error('unauthenticated');
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? '';

  const secret = new TextEncoder().encode(env.CLI_AUTH_SECRET);
  const nonce = randomBytes(16).toString('hex');

  const code = await new SignJWT({
    user_id: userId,
    email,
    challenge: params.challenge,
    nonce,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('60s')
    .setIssuedAt()
    .sign(secret);

  const redirectUrl = `http://127.0.0.1:${params.port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.state)}`;
  return { redirectUrl };
}
