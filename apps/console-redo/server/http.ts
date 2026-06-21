import { NextResponse } from 'next/server';

export function ok<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function err(error: string, status: number, message?: string): NextResponse {
  return NextResponse.json({ error, ...(message ? { message } : {}) }, { status });
}
