// The ONLY place raw fetch lives. Two request primitives:
//   - request()        Console-side reads: session-cookie auth, server-relative
//                       paths into apps/console-redo/app/api/** (hydration GETs).
//   - workerRequest()   Worker-side writes: Bearer Clerk JWT, absolute Worker URL
//                       (comment/reply create — those routes live on the Worker,
//                       not Console, mirroring apps/console's workerApi()).
// Feature api.ts files wrap these with their contract schemas; components never
// import this module directly.

import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}: ${bodyText.slice(0, 200)}`);
  }
}

// Single source for the Worker base URL + SSE events URL (moved here from
// event-gateway.ts so there's one place the Worker origin is configured). No
// cursor param — Last-Event-ID drives the SSE resume.
export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:3001';

export function workerEventsUrl(threadId: string): string {
  return `${WORKER_URL}/api/threads/${threadId}/events`;
}

// ---------------------------------------------------------------------------
// Console-side request (session cookie auth, server-relative paths)
// ---------------------------------------------------------------------------

export async function request<T>(
  method: string,
  path: string,
  body: unknown,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText, path);
  }
  const json = await res.json();
  return responseSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Worker-side request (Bearer Clerk JWT, absolute Worker URL). The token getter
// is passed per-call so callers supply useAuth().getToken — a fresh JWT every
// time, never cached.
// ---------------------------------------------------------------------------

export async function workerRequest<T>(
  method: string,
  path: string,
  body: unknown,
  responseSchema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getToken();
  if (!token) throw new ApiError(401, 'no_clerk_token', path);
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText, path);
  }
  const json = await res.json();
  return responseSchema.parse(json);
}
