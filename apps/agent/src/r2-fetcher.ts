import type { AttachmentRef } from '@tempo/contracts';
import { env } from './env';

// Fetch an attachment's bytes via the freshly signed GET URL the Console
// embeds in the ref. The Agent never reaches the S3 dialect directly —
// the Console signs, the Agent just runs an authenticated-by-URL HTTP GET.
// Returns base64 for the MCP image content block; raw bytes are never
// useful to the caller (`mcp-server.ts` emits them as-is to Claude).

const FETCH_TIMEOUT_MS = 10_000;

export async function fetchAttachmentAsImageBlock(
  ref: AttachmentRef,
): Promise<{ type: 'image'; data: string; mimeType: AttachmentRef['mime'] } | null> {
  // SSRF guard: only fetch URLs whose origin matches the configured
  // attachment store. The signed URL's origin is the R2 / MinIO endpoint;
  // anything else is a tampered or replayed payload from a compromised
  // Console.
  try {
    const allowed = new URL(env.TEMPO_ATTACHMENT_ORIGIN).origin;
    const target = new URL(ref.url).origin;
    if (target !== allowed) return null;
  } catch {
    return null;
  }
  try {
    const res = await fetch(ref.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return { type: 'image', data: Buffer.from(buf).toString('base64'), mimeType: ref.mime };
  } catch {
    return null;
  }
}
