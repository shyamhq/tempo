import { TempoError } from '@tempo/errors';
import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

export function ok<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function err(error: string, status: number, message?: string): NextResponse {
  return NextResponse.json({ error, ...(message ? { message } : {}) }, { status });
}

// Maps any thrown value to an HTTP response. TempoError carries its own code +
// status; anything else collapses to a generic 500 (the upstream error log is
// the trace — the wire body intentionally hides server internals).
export function toResponse(e: unknown): NextResponse {
  if (e instanceof TempoError) return err(e.code, e.statusCode, e.message);
  return err('internal_error', 500);
}

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: err('invalid_json', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'invalid_input', details: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
