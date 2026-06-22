'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Modal lightbox: full-viewport overlay, click-outside or Esc to close, arrow
// keys to navigate. Owns its own body-scroll-lock; that lifecycle is the reason
// it's a distinct module from <AttachmentStrip> rather than inlined.
//
// Portals to document.body so a `position: fixed` ancestor (a row running an
// enter keyframe with a non-none transform becomes the containing block for
// fixed descendants) can't shrink the `fixed inset-0` overlay to the row.

// Only what the lightbox actually renders. Narrowed from AttachmentRef so neither
// caller (tray's blob previews, strip's real refs) has to fabricate fields it
// never reads (e.g. expires_at).
type LightboxImage = { id: string; url: string; mime: string };

export function Lightbox({
  attachments,
  startIndex,
  onClose,
}: {
  attachments: LightboxImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Move focus to the close button on open so the modal traps focus and Esc /
  // Tab land somewhere sensible rather than on the page behind the overlay.
  useEffect(() => {
    if (mounted) closeRef.current?.focus();
  }, [mounted]);

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
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click closes; Esc closes via the window keydown listener
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-backdrop backdrop-blur-md"
    >
      <button
        ref={closeRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-inset text-ink hover:bg-border-strong"
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
            className="absolute left-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-inset text-ink hover:bg-border-strong disabled:opacity-30"
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
            className="absolute right-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-inset text-ink hover:bg-border-strong disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      ) : null}
      {/* biome-ignore lint/performance/noImgElement: signed URLs cannot route through next/image */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click only stops the bubble-to-close */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes via the window keydown listener */}
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
