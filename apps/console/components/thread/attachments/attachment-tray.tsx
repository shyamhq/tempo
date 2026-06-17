'use client';

import type { AttachmentRef } from '@tempo/contracts';
import { Loader2, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { useAttachmentUploader } from '@/hooks/use-attachment-uploader';
import { Lightbox } from './lightbox';

// Composer-side write surface, split into three composable pieces so each
// composer (Discussion / NewCommentCard / inline Reply) can lay them out
// however its visual shape demands — thumbs-above-textarea + plus-in-the-
// bottom-bar for the Discussion composer matches the Mintlify reference.
//
// The drop + paste plumbing lives in `useAttachmentSurface` so a composer
// can wrap its outer `<div>` with the returned root props and have both
// paste-into-textarea and drag-onto-the-card path land in the same
// uploader hook.

// The sub-components read only what they render. The full uploader return
// (`readyIds`, `allReady`, `hasUploading`, `reset`) belongs to the composer.
// Narrowing the alias lets the new-thread compose pass a small shim without
// having to populate fields it doesn't use.
type Uploader = Pick<ReturnType<typeof useAttachmentUploader>, 'items' | 'addFiles' | 'remove'>;

export function useAttachmentSurface(
  uploader: Uploader,
  pasteTargetRef: React.RefObject<HTMLElement | null>,
  disabled = false,
) {
  const onDrop = useCallback(
    (files: File[]) => {
      if (disabled) return;
      void uploader.addFiles(files);
    },
    [disabled, uploader],
  );

  const { getRootProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
  });

  useEffect(() => {
    const el = pasteTargetRef.current;
    if (!el || disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      if (files.length === 0) return;
      void uploader.addFiles(files);
    };
    el.addEventListener('paste', onPaste);
    return () => el.removeEventListener('paste', onPaste);
  }, [disabled, pasteTargetRef, uploader]);

  return { rootProps: getRootProps(), isDragActive };
}

export function AttachmentThumbnails({ uploader }: { uploader: Uploader }) {
  // Preview-by-click reuses the same Lightbox the read-side strip uses, with
  // the pending items projected into AttachmentRef shape — local blob URLs
  // are valid `url:` values, so no contract bending.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const previewable = uploader.items.filter((p) => p.status !== 'error');
  const refs: AttachmentRef[] = useMemo(
    () =>
      previewable.map((p) => ({
        id: p.clientId,
        mime: p.mime,
        byte_len: p.byteLen,
        url: p.localUrl,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })),
    [previewable],
  );

  if (uploader.items.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {uploader.items.map((p) => {
          const previewIdx = previewable.findIndex((q) => q.clientId === p.clientId);
          return (
            <div
              key={p.clientId}
              className="relative h-14 w-14 overflow-hidden rounded-md border border-hairline bg-surface-2"
            >
              <button
                type="button"
                onClick={() => previewIdx >= 0 && setOpenIdx(previewIdx)}
                disabled={previewIdx < 0}
                aria-label="Preview attachment"
                className="block h-full w-full"
              >
                {/* biome-ignore lint/performance/noImgElement: blob: URLs cannot route through next/image */}
                <img
                  src={p.localUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              </button>
              {p.status === 'uploading' ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-canvas/60">
                  <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
                </div>
              ) : null}
              {p.status === 'error' ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-danger/15 text-micro text-danger">
                  failed
                </div>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  uploader.remove(p.clientId);
                }}
                aria-label="Remove attachment"
                className="absolute top-0.5 right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-canvas text-ink shadow-1 ring-1 ring-hairline-strong hover:bg-surface-2"
              >
                <X className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
      {openIdx !== null ? (
        <Lightbox attachments={refs} startIndex={openIdx} onClose={() => setOpenIdx(null)} />
      ) : null}
    </>
  );
}

export function AttachmentAddButton({
  uploader,
  disabled = false,
}: {
  uploader: Uploader;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach image"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          void uploader.addFiles(files);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function AttachmentDragOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/5 text-micro text-accent-deep">
      Drop image to attach
    </div>
  );
}
