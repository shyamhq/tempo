import { CreateSessionRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { err, ok, parseBody } from '../../../server/http';
import { createSessionFromToken } from '../../../server/sessions';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const m = auth ? /^Bearer\s+(\S+)$/.exec(auth) : null;
  if (!m) return err('unauthorized', 401, 'missing bearer token');
  const parsed = await parseBody(req, CreateSessionRequest);
  if (!parsed.ok) return parsed.response;
  const result = await createSessionFromToken(m[1]!, {
    repo_remote: parsed.data.repo_remote ?? null,
    repo_path: parsed.data.repo_path ?? null,
  });
  if (!result.ok) return err('invalid_token', 401);
  return ok({ session_id: result.session_id, thread_id: result.thread_id });
}
