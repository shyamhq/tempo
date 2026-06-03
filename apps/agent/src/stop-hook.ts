import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

// Stop hook entry point.
//
// Claude Code spawns this when the model decides to stop (end of turn). The
// payload (transcript path, stop_hook_active flag) is intentionally unused —
// the act of POSTing IS the signal. We MUST never return non-zero: a non-zero
// Stop hook *blocks* the turn from ending, which would freeze the Agent.
//
// Duplicates the fireAndForget helper from `hook-relay.ts` rather than sharing
// it — AGENTS.md rule 10 ("a seam becomes real only when two or more adapters
// satisfy it") is not yet satisfied at the moment this file is created; the
// second caller is being introduced in this same change. Filed under
// "Spotted but not fixed" for consolidation once both files have lived in
// tree.

export async function runStopHook(): Promise<void> {
  const sessionId = process.env.TEMPO_SESSION_ID;
  const consoleUrl = process.env.TEMPO_CONSOLE_URL;
  const token = process.env.TEMPO_CONNECT_TOKEN;

  // Missing env means we're not in a tempo-driven session; silently no-op.
  if (!sessionId || !consoleUrl || !token) return;

  // Drain stdin so the parent doesn't see a broken pipe — we don't read the
  // payload.
  for await (const _ of process.stdin) {
    // discard
  }

  fireAndForget(consoleUrl, `/api/sessions/${sessionId}/turn-ended`, token, {});
}

function fireAndForget(
  consoleUrl: string,
  pathname: string,
  token: string,
  payload: unknown,
): void {
  let url: URL;
  try {
    url = new URL(pathname, consoleUrl);
  } catch {
    return;
  }
  const body = JSON.stringify(payload);
  const lib = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const req = lib(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      method: 'POST',
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
      },
    },
    (res) => res.resume(),
  );
  req.on('error', () => {});
  req.setTimeout(200, () => req.destroy());
  req.end(body);
}
