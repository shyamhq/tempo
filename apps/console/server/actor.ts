import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '../db';
import { sessions, threads } from '../db/schema';
import { hashConnectToken } from './tokens';

// Derive the calling Actor and (when agent) the connected Thread/Session id.
// Auth contract:
//  - Bearer <connect_token> -> agent. We hash the token and look up the Thread.
//  - X-Tempo-Dev: 1 header  -> dev. (Console is single-user in MVP.)
// Anything else returns null (caller decides whether 401 is appropriate).
export type AuthContext =
  | { actor: 'agent'; thread_id: string; session_id: string | null }
  | { actor: 'dev' }
  | null;

export async function authFromRequest(req: NextRequest): Promise<AuthContext> {
  const bearer = readBearer(req);
  if (bearer) {
    const hash = hashConnectToken(bearer);
    const [t] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.connect_token_hash, hash))
      .limit(1);
    if (!t) return null;
    const [s] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.thread_id, t.id))
      .limit(1);
    return { actor: 'agent', thread_id: t.id, session_id: s?.id ?? null };
  }
  if (req.headers.get('x-tempo-dev') === '1') return { actor: 'dev' };
  return null;
}

function readBearer(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(\S+)$/.exec(auth);
  return m ? m[1]! : null;
}
