'use client';

import type { AttachmentRef } from '@tempo/contracts';

// Today the AttachmentRef already carries a fresh, server-signed URL valid
// for ~30 min — the server re-signs on every read. This hook is the seam
// where TTL-aware client caching would live if/when read traffic warrants
// it (skip-re-render on the same id if the URL is still fresh). For now,
// it's a one-line passthrough so use sites don't reach into the ref's shape.

export function useSignedAttachmentUrl(ref: AttachmentRef): string {
  return ref.url;
}
