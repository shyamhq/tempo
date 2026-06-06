'use client';

import type { AttachmentRef } from '@tempo/contracts';
import { useState } from 'react';
import { Lightbox } from './lightbox';

// Read-side render of a message/reply's attachments: a row of square
// thumbnails. Click opens the lightbox at that index. Empty array renders
// nothing (and we don't even mount), so callers can `<AttachmentStrip
// attachments={msg.attachments} />` unconditionally.

export function AttachmentStrip({ attachments }: { attachments: AttachmentRef[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attachments.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenIdx(i)}
            className="block h-20 w-20 overflow-hidden rounded-md border border-hairline bg-surface-2 transition-[border-color] hover:border-hairline-strong"
            aria-label="Open attachment"
          >
            {/* biome-ignore lint/performance/noImgElement: signed URLs cannot route through next/image */}
            <img src={a.url} alt="" className="h-full w-full object-cover" draggable={false} />
          </button>
        ))}
      </div>
      {openIdx !== null ? (
        <Lightbox attachments={attachments} startIndex={openIdx} onClose={() => setOpenIdx(null)} />
      ) : null}
    </>
  );
}
