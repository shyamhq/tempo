'use client';

import type { AttachmentRef } from '@tempo/contracts';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Modal lightbox: full-viewport overlay, click-outside or Esc to close,
// arrow keys to navigate. Owns its own focus trap + body-scroll-lock; this
// is the reason it's a distinct module from <AttachmentStrip> rather than
// inlined — the lifecycle would otherwise leak into every strip site.
//
// The lightbox MUST portal to document.body: MessageRow runs the
// `discussion-message-enter` keyframe with animation-fill-mode `both`, which
// leaves `transform: translateY(0)` as the final style. A non-none
// `transform` on an ancestor promotes it to the containing block for every
// `position: fixed` descendant — without the portal, `fixed inset-0` would
// size against the MessageRow and leave the rest of the page uncovered.

export function Lightbox({
  attachments,
  startIndex,
  onClose,
}: {
  attachments: AttachmentRef[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, attachments.length - 1));
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachments.length, onClose]);

  const current = attachments[idx];
  if (!current || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 backdrop-blur-md"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-surface-3"
      >
        <X className="h-4 w-4" />
      </button>
      {attachments.length > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => Math.max(i - 1, 0));
            }}
            disabled={idx === 0}
            aria-label="Previous"
            className="absolute left-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-surface-3 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => Math.min(i + 1, attachments.length - 1));
            }}
            disabled={idx === attachments.length - 1}
            aria-label="Next"
            className="absolute right-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-surface-3 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      ) : null}
      {/* biome-ignore lint/performance/noImgElement: signed URLs cannot route through next/image */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click stops bubble close */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled at the dialog level */}
      <img
        src={current.url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-md object-contain"
      />
    </div>,
    document.body,
  );
}
