import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

// PreToolUse hook entry point.
//
// Claude Code spawns this on every tool call and pipes a JSON payload to stdin
// before our spawned `claude` may proceed. We MUST exit fast (<200ms typical)
// or the Agent stalls. So: parse the payload defensively, summarize the tool
// input to one short line, send the POST without awaiting the response, exit 0.
//
// Losing one event is acceptable; blocking the Agent is not. Errors here go to
// stderr at debug-only verbosity (TEMPO_HOOK_DEBUG=1) so the relay is silent
// inside `claude`'s rendered output by default.

const SUMMARY_MAX = 200;

type HookPayload = {
  tool_name?: unknown;
  tool_input?: unknown;
};

export async function runHookRelay(): Promise<void> {
  const sessionId = process.env.TEMPO_SESSION_ID;
  const consoleUrl = process.env.TEMPO_CONSOLE_URL;
  const token = process.env.TEMPO_CONNECT_TOKEN;

  // Missing env means we're not in a tempo-driven session; silently no-op.
  // Returning non-zero would block the parent Agent for no reason.
  if (!sessionId || !consoleUrl || !token) return;

  const payload = await readJsonStdin();
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : 'unknown';
  const summary = summarizeToolInput(payload?.tool_input);

  // Fire-and-forget: schedule the request, don't await it. The parent process
  // will keep the event loop alive long enough for the request to flush
  // because we end the request body inline before returning. On localhost this
  // is sub-10ms; over the internet we accept the risk of losing an event if
  // the process exits before the socket flushes.
  postToolUse(consoleUrl, sessionId, token, tool, summary);
}

async function readJsonStdin(): Promise<HookPayload | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return null;
  }
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  // Per Claude Code's built-in tools: pick the field most useful to a human
  // glancing at "what is the Agent doing right now".
  const candidate =
    pick(i, 'file_path') ??
    pick(i, 'path') ??
    pick(i, 'command') ??
    pick(i, 'pattern') ??
    pick(i, 'query') ??
    pick(i, 'url') ??
    pick(i, 'description') ??
    '';
  return clip(candidate, SUMMARY_MAX);
}

function pick(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function postToolUse(
  consoleUrl: string,
  sessionId: string,
  token: string,
  tool: string,
  summary: string,
): void {
  let url: URL;
  try {
    url = new URL(`/api/sessions/${sessionId}/tool-use`, consoleUrl);
  } catch {
    return;
  }
  const body = JSON.stringify({ tool, summary });
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
