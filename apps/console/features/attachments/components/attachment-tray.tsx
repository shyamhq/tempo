'use client';

import { Loader2, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { useAttachmentUploader } from '../use-attachment-uploader';
import { Lightbox } from './lightbox';

// Composer-side write surface, split into composable pieces so each composer
// (discussion / new-thread compose) lays them out as its shape demands.
//
// Drop + paste plumbing lives in useAttachmentSurface so a composer can spread
// the returned rootProps onto its outer div and have both paste-into-textarea
// and drag-onto-the-card land in the same uploader hook. apps/console used
// react-dropzone here; console isn't carrying that dependency, so the drag
// surface is the few native HTML5 drag events it would have wrapped anyway.

type Uploader = Pick<ReturnType<typeof useAttachmentUploader>, 'items' | 'addFiles' | 'remove'>;

export function useAttachmentSurface(
  uploader: Uploader,
  pasteTargetRef: React.RefObject<HTMLElement | null>,
  disabled = false,
) {
  const [isDragActive, setIsDragActive] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length > 0) void uploader.addFiles(files);
    },
    [disabled, uploader],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      // Only react to file drags, not text/element drags within the editor.
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      setIsDragActive(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // currentTarget is the surface; relatedTarget leaving into a child keeps the
    // overlay up — only clear when the pointer leaves the surface entirely.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragActive(false);
  }, []);

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

  return { rootProps: { onDrop, onDragOver, onDragLeave }, isDragActive };
}

export function AttachmentThumbnails({ uploader }: { uploader: Uploader }) {
  // Preview-by-click reuses the read-side Lightbox with the local blob URLs as
  // `url:` values — the narrow LightboxImage shape, no AttachmentRef fabrication.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const previewable = uploader.items.filter((p) => p.status !== 'error');
  const refs = previewable.map((p) => ({ id: p.clientId, mime: p.mime, url: p.localUrl }));
  // clientId → index within `previewable`, so each thumbnail opens the lightbox
  // at the right slot without an O(n) findIndex per row.
  const previewIndex = new Map(previewable.map((p, i) => [p.clientId, i]));

  if (uploader.items.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {uploader.items.map((p) => {
          const previewIdx = previewIndex.get(p.clientId) ?? -1;
          return (
            <div
              key={p.clientId}
              className="relative h-14 w-14 overflow-hidden rounded-md border border-border bg-inset"
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
                  <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
                </div>
              ) : null}
              {p.status === 'error' ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-danger-bg text-[10px] text-danger">
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
                className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-canvas text-ink shadow-sm ring-1 ring-border-strong hover:bg-inset"
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
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-inset hover:text-ink disabled:opacity-50"
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
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary-soft/60 text-[11px] text-primary">
      Drop image to attach
    </div>
  );
}
