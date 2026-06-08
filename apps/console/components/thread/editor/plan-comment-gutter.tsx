'use client';

// Notion-style comment margin: icons sit in a narrow column to the right of
// the Plan editor, vertically aligned with each anchor, and scroll with the
// document. Positions are measured relative to the shared plan wrapper (not
// the viewport), so no scroll listener is needed.

import { CommentsExtension } from '@blocknote/core/comments';
import type { Comment } from '@tempo/contracts';
import { CheckCircle2, MessageSquare, MessageSquareOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanEditorHandle } from './plan-editor';

type AnchorPos = {
  top: number;
  /** PM doc offset — tiebreak when multiple comments share one line. */
  pos: number;
};

type LiveComment = {
  comment: Comment;
  anchor: AnchorPos | null;
};

// size-7 (28px) + 2px breathing room between stacked icons
const ICON_STEP_PX = 30;
const ORPHAN_SECTION_GAP_PX = 12;
const ORPHAN_LABEL_ABOVE_PX = 16;

export function PlanCommentGutter({
  comments,
  editorHandle,
  anchorRef,
}: {
  comments: Comment[];
  editorHandle: PlanEditorHandle | null;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const railRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Map<string, AnchorPos | null> | null>(null);

  useEffect(() => {
    if (!editorHandle) return;
    const store = editorHandle.editor.getExtension(CommentsExtension)?.store;
    if (!store) return;
    setSelectedThreadId(store.state.selectedThreadId);
    return store.subscribe(() => {
      setSelectedThreadId(store.state.selectedThreadId);
    });
  }, [editorHandle]);

  const commentIds = useMemo(() => comments.map((c) => c.id).join('\0'), [comments]);

  useEffect(() => {
    if (!editorHandle) return;
    const editor = editorHandle.editor;
    const ids = comments.map((c) => c.id);

    const recompute = () => {
      const anchorEl = anchorRef.current;
      if (!anchorEl) return;
      const anchorTop = anchorEl.getBoundingClientRect().top;
      const positionsMap = walkPmDocForCommentMarks(editor);
      const next = new Map<string, AnchorPos | null>();
      for (const id of ids) {
        const pos = positionsMap.get(id);
        if (pos === undefined) {
          next.set(id, null);
          continue;
        }
        try {
          const coords = editor._tiptapEditor.view.coordsAtPos(pos);
          next.set(id, { top: coords.top - anchorTop, pos });
        } catch {
          next.set(id, null);
        }
      }
      setPositions(next);
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    };

    editor._tiptapEditor.on('update', schedule);
    editor._tiptapEditor.on('selectionUpdate', schedule);
    window.addEventListener('resize', schedule);

    const observed = new Set<Element>();
    const observe = (el: Element | null | undefined) => {
      if (!el || observed.has(el)) return;
      observed.add(el);
      observer?.observe(el);
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observe(anchorRef.current);
      observe(railRef.current);
      observe(editor._tiptapEditor.view.dom);
    }
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      editor._tiptapEditor.off('update', schedule);
      editor._tiptapEditor.off('selectionUpdate', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [editorHandle, anchorRef, commentIds, comments]);

  const focusAnchor = useCallback(
    (commentId: string) => {
      if (!editorHandle) return;
      editorHandle.editor.getExtension(CommentsExtension)?.selectThread(commentId);
    },
    [editorHandle],
  );

  const openOrphan = useCallback(
    (commentId: string, e: React.MouseEvent<HTMLButtonElement>) => {
      if (!editorHandle) return;
      const rect = e.currentTarget.getBoundingClientRect();
      editorHandle.openOrphan(commentId, { top: rect.top, right: rect.left });
    },
    [editorHandle],
  );

  const { anchored, orphaned } = useMemo(() => {
    const a: LiveComment[] = [];
    const o: LiveComment[] = [];
    if (positions === null) return { anchored: a, orphaned: o };
    for (const comment of comments) {
      if (comment.resolved_by !== null && !showResolved) continue;
      const anchor = positions.get(comment.id) ?? null;
      const entry: LiveComment = { comment, anchor };
      if (anchor === null) o.push(entry);
      else a.push(entry);
    }
    a.sort((x, y) => {
      const topDiff = (x.anchor?.top ?? 0) - (y.anchor?.top ?? 0);
      if (topDiff !== 0) return topDiff;
      return (x.anchor?.pos ?? 0) - (y.anchor?.pos ?? 0);
    });
    o.sort((x, y) => Date.parse(x.comment.created_at) - Date.parse(y.comment.created_at));
    return { anchored: a, orphaned: o };
  }, [comments, positions, showResolved]);

  const { tops: displayTops, orphanLabelTop } = useMemo(
    () => layoutGutterIcons(anchored, orphaned),
    [anchored, orphaned],
  );

  if (!editorHandle) return null;

  return (
    <div className="relative w-10 shrink-0 self-stretch select-none">
      <div className="absolute inset-0 flex flex-col pt-1">
        <label className="flex items-center gap-1 text-caption text-ink-subtle cursor-pointer mb-2">
          <input
            type="checkbox"
            className="accent-accent"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
        </label>

        <div ref={railRef} className="relative flex-1 min-h-full">
          {orphanLabelTop !== null ? (
            <span
              className="absolute right-0 text-micro-uppercase uppercase font-semibold text-ink-tertiary pointer-events-none"
              style={{ top: orphanLabelTop }}
            >
              Orphaned
            </span>
          ) : null}
          {anchored.map(({ comment }) => (
            <GutterIcon
              key={comment.id}
              resolved={comment.resolved_by !== null}
              selected={selectedThreadId === comment.id}
              style={{
                position: 'absolute',
                top: `${displayTops.get(comment.id) ?? 0}px`,
                right: 0,
              }}
              onClick={() => focusAnchor(comment.id)}
            />
          ))}
          {orphaned.map(({ comment }) => (
            <GutterIcon
              key={comment.id}
              resolved={comment.resolved_by !== null}
              selected={selectedThreadId === comment.id}
              orphaned
              style={{
                position: 'absolute',
                top: `${displayTops.get(comment.id) ?? 0}px`,
                right: 0,
              }}
              onClick={(e) => openOrphan(comment.id, e)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GutterIcon({
  resolved,
  selected,
  style,
  orphaned,
  onClick,
}: {
  resolved: boolean;
  selected?: boolean;
  style?: React.CSSProperties;
  orphaned?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = orphaned ? MessageSquareOff : resolved ? CheckCircle2 : MessageSquare;
  const titleParts = [resolved ? 'Resolved' : 'Open', orphaned ? '(orphaned)' : null].filter(
    Boolean,
  );
  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      disabled={onClick === undefined}
      aria-pressed={selected ?? false}
      title={titleParts.join(' ')}
      className={`size-7 inline-flex items-center justify-center rounded-md transition-colors ${
        selected
          ? 'bg-accent/10 text-accent-deep ring-2 ring-accent'
          : 'text-ink-subtle hover:text-ink hover:bg-surface-2'
      } ${resolved && !selected ? 'opacity-50' : ''} ${
        orphaned ? 'border border-dashed border-hairline' : ''
      } ${onClick === undefined ? 'cursor-default' : ''}`}
    >
      <Icon className="size-icon-sm" aria-hidden />
    </button>
  );
}

type LayoutEntry = { id: string; preferred: number };

/** One pass for anchored, then orphans below; final spread avoids all overlap. */
function layoutGutterIcons(
  anchored: LiveComment[],
  orphaned: LiveComment[],
): { tops: Map<string, number>; orphanLabelTop: number | null } {
  const anchoredTops = spreadAnchoredIcons(anchored);
  let anchoredBottom = -Infinity;
  for (const top of anchoredTops.values()) {
    anchoredBottom = Math.max(anchoredBottom, top + ICON_STEP_PX);
  }

  const entries: LayoutEntry[] = [];
  for (const { comment } of anchored) {
    const preferred = anchoredTops.get(comment.id);
    if (preferred === undefined) continue;
    entries.push({ id: comment.id, preferred });
  }

  const orphanBase = orphaned.length > 0 ? Math.max(0, anchoredBottom + ORPHAN_SECTION_GAP_PX) : 0;
  for (let i = 0; i < orphaned.length; i++) {
    const orphan = orphaned[i];
    if (!orphan) continue;
    entries.push({ id: orphan.comment.id, preferred: orphanBase + i * ICON_STEP_PX });
  }

  entries.sort((a, b) => a.preferred - b.preferred);
  const tops = new Map<string, number>();
  let lastBottom = -Infinity;
  for (const { id, preferred } of entries) {
    const top = Math.max(preferred, lastBottom);
    tops.set(id, top);
    lastBottom = top + ICON_STEP_PX;
  }

  const firstOrphan = orphaned[0];
  const firstOrphanTop = firstOrphan ? tops.get(firstOrphan.comment.id) : undefined;
  const orphanLabelTop =
    firstOrphanTop !== undefined
      ? Math.max(
          anchoredBottom === -Infinity ? 0 : anchoredBottom + 2,
          firstOrphanTop - ORPHAN_LABEL_ABOVE_PX,
        )
      : null;

  return { tops, orphanLabelTop };
}

function spreadAnchoredIcons(anchored: LiveComment[]): Map<string, number> {
  const out = new Map<string, number>();
  let lastBottom = -Infinity;
  for (const { comment, anchor } of anchored) {
    if (!anchor) continue;
    const top = Math.max(anchor.top, lastBottom);
    out.set(comment.id, top);
    lastBottom = top + ICON_STEP_PX;
  }
  return out;
}

function walkPmDocForCommentMarks(editor: PlanEditorHandle['editor']): Map<string, number> {
  const out = new Map<string, number>();
  // biome-ignore lint/suspicious/noExplicitAny: ProseMirror node callback is untyped in our graph
  editor._tiptapEditor.state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment') continue;
      const threadId = mark.attrs.threadId as string | undefined;
      if (typeof threadId !== 'string' || threadId.length === 0) continue;
      if (!out.has(threadId)) out.set(threadId, pos);
    }
  });
  return out;
}
