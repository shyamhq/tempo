'use client';

import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';

// Reads anchor y-coordinates of every CommentMark span (saved + pending) in
// the editor's DOM, normalised to a container element so the rail's canvas
// can absolutely-position cards aligned with their text. Recomputes on
// editor updates (debounced), editor-DOM resizes, and window resize. Page
// and rail scroll are not triggers: positions are container-relative and
// invariant under either scroll.
export function useAnchorPositions(
  editor: Editor | null,
  containerEl: HTMLElement | null,
): { positions: Map<string, number>; pendingY: number | null; editorHeight: number } {
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [pendingY, setPendingY] = useState<number | null>(null);
  const [editorHeight, setEditorHeight] = useState(0);

  useEffect(() => {
    if (!editor || !containerEl) return;

    let frame = 0;
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const root = editor.view.dom as HTMLElement;

    const measure = () => {
      const containerTop = containerEl.getBoundingClientRect().top;
      const next = new Map<string, number>();
      let nextPending: number | null = null;
      root.querySelectorAll<HTMLElement>('[data-comment-id]').forEach((el) => {
        const id = el.getAttribute('data-comment-id');
        if (!id) return;
        if (next.has(id)) return;
        next.set(id, el.getBoundingClientRect().top - containerTop);
      });
      const pendingEl = root.querySelector<HTMLElement>('[data-pending="true"]');
      if (pendingEl) {
        nextPending = pendingEl.getBoundingClientRect().top - containerTop;
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
    };
  }, [editor, containerEl]);

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
