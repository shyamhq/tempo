import { isClerkAPIResponseError } from '@clerk/nextjs/errors';

// Clerk throws ClerkAPIResponseError with an `errors[]` array; the first item's
// longMessage is the human-readable cause (covers the last-admin guard on
// remove/leave/role-change). Surface it so a failed mutation never silently
// fails. Shared by the members + danger-zone sections.
export function clerkMessage(e: unknown, fallback: string): string {
  if (isClerkAPIResponseError(e)) {
    const first = e.errors[0];
    if (first) return first.longMessage ?? first.message ?? fallback;
  }
  return e instanceof Error ? e.message : fallback;
}
