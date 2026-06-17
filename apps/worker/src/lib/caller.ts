import type { Request } from 'express';

// Resolves a Clerk user id from the authenticated caller. `browser` and `cli`
// callers both carry one; agent/hosted/internal callers don't (they act as
// the Agent), so we return null. Used as `author_user_id` / `updated_by_user_id`
// at write boundaries — null sits in the row, signalling Agent-authored.
export function callerUserId(req: Request): string | null {
  const c = req.caller;
  if (c.kind === 'browser' || c.kind === 'cli') return c.userId;
  return null;
}
