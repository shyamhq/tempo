'use client';

import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import { useComposerStore } from '@/lib/stores/composer-store';

// Reads anchor y-coordinates for every saved Comment plus the composer's
// pending selection, normalised to a container element so the rail can
// absolutely-position cards aligned with their text.
//
// Saved comments come from CommentMark spans in the editor DOM
// (`[data-comment-id]`). The pending composer's y comes from the canonical
// `composerRange.from` via `editor.view.coordsAtPos` — NOT from a DOM
// scan of `[data-pending="true"]`. A DOM scan was wrong whenever a
// selection crossed a block boundary (ProseMirror splits the mark per
// block, `querySelector` returned the topmost split — often near the top
// of the doc) or when a stale pending span lingered from a prior compose.
//
// Scroll-invariance assumption (load-bearing): the editor and the container
// share a single scroll context. Both rects shift by the same delta under
// page scroll, so the stored `anchor.top − container.top` is scroll-stable
// and no scroll listener is needed. Wrapping either in an `overflow: auto`
// element breaks that — re-add a listener on the new scroll ancestor.
export function useAnchorPositions(
  editor: Editor | null,
  containerEl: HTMLElement | null,
): { positions: Map<string, number>; pendingY: number | null; editorHeight: number } {
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [pendingY, setPendingY] = useState<number | null>(null);
  const [editorHeight, setEditorHeight] = useState(0);
  const composerRangeFrom = useComposerStore((s) => s.range?.from ?? null);
  const composerRangeFromRef = useRef(composerRangeFrom);
  composerRangeFromRef.current = composerRangeFrom;
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!editor || !containerEl) {
      measureRef.current = () => {};
      return;
    }

    let frame = 0;
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const root = editor.view.dom as HTMLElement;

    const measure = () => {
      const containerTop = containerEl.getBoundingClientRect().top;
      const next = new Map<string, number>();
      root.querySelectorAll<HTMLElement>('[data-comment-id]').forEach((el) => {
        const id = el.getAttribute('data-comment-id');
        if (!id || next.has(id)) return;
        next.set(id, el.getBoundingClientRect().top - containerTop);
      });
      const from = composerRangeFromRef.current;
      let nextPending: number | null = null;
      if (from !== null && from <= editor.state.doc.content.size) {
        try {
          nextPending = editor.view.coordsAtPos(from).top - containerTop;
        } catch {
          // pos out of bounds (setContent reset mid-compose) — leave null
        }
      }
      setPositions((prev) => (mapsEqual(prev, next) ? prev : next));
      setPendingY((prev) => (prev === nextPending ? prev : nextPending));
      setEditorHeight((prev) => {
        const h = root.getBoundingClientRect().height;
        return Math.abs(prev - h) < 0.5 ? prev : h;
      });
    };

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measureRef.current = schedule;

    const onEditorUpdate = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(schedule, 100);
    };

    editor.on('update', onEditorUpdate);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);
    window.addEventListener('resize', schedule, { passive: true });
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (updateTimer) clearTimeout(updateTimer);
      editor.off('update', onEditorUpdate);
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      measureRef.current = () => {};
    };
  }, [editor, containerEl]);

  // Re-measure when the composer's range changes (new compose started, or
  // compose closed). Cheaper than rebuilding the listener-heavy effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: composerRangeFrom IS the trigger; measureRef is intentionally a stable ref so adding it would force re-runs on listener-effect remounts.
  useEffect(() => {
    measureRef.current();
  }, [composerRangeFrom]);

  return { positions, pendingY, editorHeight };
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv === undefined || Math.abs(bv - v) > 0.5) return false;
  }
  return true;
}
